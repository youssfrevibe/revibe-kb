import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { hybridSearch, type RetrievedRef } from "@/lib/retrieve";
import { streamAnswer, generateText, type ChatTurn } from "@/lib/gemini";
import { systemPrompt, buildUserMessage, rewritePrompt } from "@/lib/prompt";
import { detectMarkets, marketFilterFor, describeRoute } from "@/lib/market-detect";
import { isSourceMode, SOURCE_MODE_LABEL, type SourceMode } from "@/lib/source-tags";
import { newSlug, titleFromQuestion } from "@/lib/slug";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { currentUser } from "@/lib/auth";
import type { Market } from "@/lib/markets";

export const runtime = "nodejs";
export const maxDuration = 60;

const HISTORY_TURNS = 6;

type Body = {
  message?: unknown;
  mode?: unknown;
  threadSlug?: unknown;
  clientDate?: unknown;
};

type Event =
  | { type: "meta"; threadSlug: string; title: string; sources: SourceOut[]; detectedMarkets: Market[] }
  | { type: "delta"; text: string }
  | { type: "done"; messageId?: string }
  | { type: "error"; message: string };

type SourceOut = {
  n: number;
  threadSlug: string;
  refNumber: number | null;
  sourceTag: string;
  title: string;
  market: string;
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const mode: SourceMode = isSourceMode(body.mode) ? body.mode : "SRC+ALH";
  const threadSlug = typeof body.threadSlug === "string" ? body.threadSlug : null;
  const clientDate = typeof body.clientDate === "string" ? body.clientDate.trim() : "";

  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  if (message.length > 4000) return Response.json({ error: "message is too long (4000 char limit)" }, { status: 400 });

  // Identity — the middleware only checks cookie presence, so the real
  // verify-and-lookup happens here. Every chat turn is attributed to a user.
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  let supabase;
  try {
    supabase = db();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Database client unavailable" },
      { status: 503 },
    );
  }

  // ---- Thread: load or open ------------------------------------------------
  let threadId: string;
  let slug: string;
  let title: string;
  let history: ChatTurn[] = [];

  if (threadSlug) {
    const { data: thread, error } = await supabase
      .from("threads")
      .select("id, slug, title")
      .eq("slug", threadSlug)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!thread) return Response.json({ error: "Thread not found" }, { status: 404 });

    threadId = thread.id as string;
    slug = thread.slug as string;
    title = (thread.title as string | null) ?? titleFromQuestion(message);

    const { data: prior } = await supabase
      .from("messages")
      .select("role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(40);

    history = ((prior ?? []) as { role: "user" | "assistant"; content: string }[]).slice(-HISTORY_TURNS);
  } else {
    slug = newSlug();
    title = titleFromQuestion(message);
    // No market column stored: every turn re-detects from its own text plus
    // the rewritten follow-up context. user_uid attributes the chat so the
    // audit log and Previous Chats list know who owned it.
    const { data: created, error } = await supabase
      .from("threads")
      .insert({ slug, title, market: "global", user_uid: user.uid })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    threadId = created.id as string;
  }

  // ---- Search query --------------------------------------------------------
  // Rewrite follow-ups so short questions like "and for KSA?" carry the market
  // detection they need.
  let searchQuery = message;
  if (history.length > 0) {
    try {
      const rewritten = await generateText({ prompt: rewritePrompt(history, message), maxOutputTokens: 128 });
      if (rewritten && rewritten.length < 400) searchQuery = rewritten;
    } catch {}
  }

  // Detect market(s) from the rewritten query — it carries prior turn context
  // that the raw message doesn't. This is what replaces the removed Market pill.
  const detectedMarkets = detectMarkets(searchQuery);
  const marketFilter = marketFilterFor(detectedMarkets);
  console.log(`[chat] ${describeRoute(detectedMarkets)}`);

  // ---- Retrieval -----------------------------------------------------------
  let refs: RetrievedRef[] = [];
  try {
    refs = await hybridSearch(searchQuery, marketFilter, mode, 6);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `Retrieval failed: ${detail}` }, { status: 500 });
  }

  const sources: SourceOut[] = refs.map((ref, i) => ({
    n: i + 1,
    threadSlug: ref.threadSlug,
    refNumber: ref.refNumber,
    sourceTag: ref.sourceTag,
    title: ref.title,
    market: ref.market,
  }));

  await supabase.from("messages").insert({ thread_id: threadId, role: "user", content: message });

  // ---- Stream --------------------------------------------------------------
  const turns: ChatTurn[] = [...history, { role: "user", content: buildUserMessage(message, refs) }];

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, event: Event) =>
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      let answer = "";
      try {
        send(controller, { type: "meta", threadSlug: slug, title, sources, detectedMarkets });

        for await (const delta of streamAnswer({ system: systemPrompt(detectedMarkets, clientDate), turns })) {
          answer += delta;
          send(controller, { type: "delta", text: delta });
        }

        if (!answer.trim()) {
          answer = "I couldn't generate an answer for that. Try rephrasing the question.";
          send(controller, { type: "delta", text: answer });
        }

        const { data: saved, error: saveError } = await supabase
          .from("messages")
          .insert({ thread_id: threadId, role: "assistant", content: answer })
          .select("id")
          .single();

        if (saveError) {
          console.error("failed to persist answer:", saveError.message);
        } else if (refs.length > 0) {
          const { error: sourceError } = await supabase.from("message_sources").insert(
            refs.map((ref, i) => ({
              message_id: saved.id as string,
              source_message_id: ref.messageId,
              rank: i + 1,
              score: ref.score,
            })),
          );
          if (sourceError) console.error("failed to persist sources:", sourceError.message);
        }

        await supabase
          .from("threads")
          .update({ updated_at: new Date().toISOString(), title })
          .eq("id", threadId);

        send(controller, { type: "done", messageId: saved?.id });

        // Generate tags for analysis in the background
        void generateAndSaveTags(threadId, message, answer);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("chat stream failed:", detail);
        send(controller, { type: "error", message: detail });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Detected-Markets": detectedMarkets.join(",") || "none",
      "X-Source-Mode": SOURCE_MODE_LABEL[mode],
    },
  });
}

/**
 * Runs asynchronously after the chat response is streamed to tag the thread topic.
 */
async function generateAndSaveTags(threadId: string, question: string, answer: string) {
  try {
    const prompt = [
      "Analyze the support query and answer. Output 1 to 3 simple, lowercase tags describing the topic.",
      "Examples: shipping, claims, warranty, grading, refund, payments, contact, cashback, invoice.",
      "Do NOT include country names or market codes (e.g. uae, ksa, za). Only output a valid JSON array of strings. No other text.",
      "",
      `Question: ${question}`,
      `Answer: ${answer.slice(0, 500)}`,
      "",
      "JSON Array:"
    ].join("\n");

    const response = await generateText({ prompt, maxOutputTokens: 64 });
    const match = response.match(/\[.*\]/s);
    if (match) {
      const tags = JSON.parse(match[0]) as string[];
      if (Array.isArray(tags)) {
        const supabase = db();
        await supabase
          .from("threads")
          .update({ tags })
          .eq("id", threadId);
      }
    }
  } catch (err) {
    console.error("Failed to generate tags for thread:", err);
  }
}
