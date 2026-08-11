import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { hybridSearch, type RetrievedRef } from "@/lib/retrieve";
import { streamAnswer, type ChatTurn } from "@/lib/gemini";
import { missingEnv, configErrorMessage } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  message?: unknown;
  history?: unknown;
};

type SourceHit = {
  threadSlug: string;
  messageId: string;
  refLabel: string;
  title: string;
  market: string;
  content: string;
};

type Event =
  | { type: "sources"; sources: SourceHit[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const TEACH_SYSTEM_PROMPT = [
  "You are Revibe's knowledge base administration assistant. The admin is teaching",
  "you about Revibe policies by discussing where things are stated in the source",
  "material and requesting edits.",
  "",
  "You will be given reference passages retrieved from the knowledge base. Each",
  "passage has a reference label (like SRC-0448 or ALH-0033), a title, a market",
  "tag, and its full content.",
  "",
  "IMPORTANT: \"SA\" ALWAYS means Saudi Arabia (KSA), NEVER South Africa. South",
  "Africa's code is \"ZA\".",
  "",
  "When the admin asks where something is stated:",
  "1. Search through the provided passages and cite the EXACT reference label",
  "   (e.g., ALH-0033) and quote the relevant section verbatim.",
  "2. If multiple sources mention the topic, list them all with their ref labels.",
  "3. Be specific about which passage says what — don't summarize loosely.",
  "",
  "When the admin asks you to change or update something:",
  "1. Identify the exact reference(s) that need to change.",
  "2. Quote the current text and show the proposed new text clearly.",
  "3. Tell the admin to click the edit button next to the source to apply the",
  "   change. The source references are shown above your response with edit links.",
  "",
  "Rules:",
  "- Always cite reference labels (SRC-XXXX, ALH-XXXX) when referencing material.",
  "- Quote passages exactly — do not paraphrase when discussing what a source says.",
  "- If no passage covers the topic, say so clearly.",
  "- Be concise and direct. The admin is a Revibe staff member, not a customer.",
].join("\n");

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history as ChatTurn[] : [];

  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  if (message.length > 4000) return Response.json({ error: "message is too long (4000 char limit)" }, { status: 400 });

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

  // ---- Retrieve relevant source material ------------------------------------
  let refs: RetrievedRef[] = [];
  try {
    // Search across all markets in SRC+ALH mode to find relevant source material
    refs = await hybridSearch(message, [], "SRC+ALH", 10);
  } catch (error) {
    console.error("Teaching search failed:", error);
  }

  // Build source hits with message IDs for the edit buttons
  const sourceHits: SourceHit[] = [];
  for (const ref of refs) {
    // Look up the thread slug and message ID for each retrieved reference
    const { data: thread } = await supabase
      .from("threads")
      .select("slug, messages(id, content)")
      .eq("id", ref.threadId)
      .maybeSingle();

    if (thread) {
      const assistantMsg = (thread.messages as any[])?.find((m: any) => m.content === ref.content);
      const refLabel = ref.refNumber !== null
        ? `${ref.sourceTag}-${String(ref.refNumber).padStart(4, "0")}`
        : ref.sourceTag;

      sourceHits.push({
        threadSlug: thread.slug as string,
        messageId: assistantMsg?.id ?? "",
        refLabel,
        title: ref.title,
        market: ref.market,
        content: ref.content.slice(0, 500),
      });
    }
  }

  // Build the reference context for the model
  const refContext = refs
    .map((ref, i) => {
      const label = ref.refNumber
        ? `${ref.sourceTag}-${String(ref.refNumber).padStart(4, "0")}`
        : ref.sourceTag;
      return `--- Passage ${i + 1} | ${label} | ${ref.title} | market: ${ref.market}\n${ref.content}`;
    })
    .join("\n\n");

  const userMessage = [
    `Admin question: ${message}`,
    "",
    "Reference passages:",
    "",
    refContext || "(No matching passages found in the knowledge base.)",
  ].join("\n");

  // Build conversation turns
  const turns: ChatTurn[] = [
    ...history.slice(-6),
    { role: "user" as const, content: userMessage },
  ];

  // ---- Stream the response --------------------------------------------------
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Event) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }

      // Send source hits first so the UI can render edit buttons
      send({ type: "sources", sources: sourceHits });

      try {
        let fullAnswer = "";
        for await (const delta of streamAnswer({ system: TEACH_SYSTEM_PROMPT, turns })) {
          fullAnswer += delta;
          send({ type: "delta", text: delta });
        }
        send({ type: "done" });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Stream failed" });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
