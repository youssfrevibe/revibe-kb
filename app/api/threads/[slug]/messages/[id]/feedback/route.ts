import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { embedDocuments } from "@/lib/gemini";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { newSlug } from "@/lib/slug";

export const runtime = "nodejs";

/**
 * Handle feedback (good/bad rating) and correction submissions for a message.
 *
 * POST /api/threads/[slug]/messages/[id]/feedback
 * body: { rating: 'good' | 'bad', correction?: string }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await context.params;

  let body: { rating?: unknown; correction?: unknown };
  try {
    body = (await request.json()) as { rating?: unknown; correction?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rating = typeof body.rating === "string" ? body.rating.trim() : "";
  const correction = typeof body.correction === "string" ? body.correction.trim() : "";

  if (rating !== "good" && rating !== "bad") {
    return Response.json({ error: "rating must be 'good' or 'bad'" }, { status: 400 });
  }

  if (rating === "bad" && !correction) {
    return Response.json({ error: "correction is mandatory for bad answers" }, { status: 400 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();

  // 1. Verify that the message exists and belongs to the thread
  const { data: originalMessage, error: lookupError } = await supabase
    .from("messages")
    .select("id, role, thread_id, content, created_at, threads!inner(slug, market)")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!originalMessage) return Response.json({ error: "Message not found" }, { status: 404 });

  const thread = originalMessage.threads as unknown as { slug: string; market: string } | null;
  if (!thread || thread.slug !== slug) {
    return Response.json({ error: "Message does not belong to this thread" }, { status: 404 });
  }

  // 2. Fetch the user's question asked immediately before this assistant message
  const { data: priorMessages, error: priorError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("thread_id", originalMessage.thread_id)
    .lt("created_at", originalMessage.created_at || new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (priorError) return Response.json({ error: priorError.message }, { status: 500 });
  const questionMessage = priorMessages?.[0];
  const questionText = questionMessage?.role === "user" ? questionMessage.content : "User Question";

  // 3. Update the feedback columns on the original assistant message
  const { error: updateError } = await supabase
    .from("messages")
    .update({
      feedback_rating: rating,
      feedback_correction: rating === "bad" ? correction : null,
    })
    .eq("id", id);

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  // 4. If rating is bad with a correction, create a new reference thread to "teach" the AI
  if (rating === "bad" && correction) {
    const refSlug = newSlug();
    const cleanQuestion = questionText.split("\n")[0].trim().slice(0, 60);
    const refTitleStr = `Feedback Correction · ${thread.market.toUpperCase()} · ${cleanQuestion}...`;

    // Format the reference thread content clearly so it acts as high-quality RAG content
    const refBodyContent = [
      `**FEEDBACK CORRECTION** · ${thread.market.toUpperCase()} · Reference ID: FEEDBACK-${refSlug}`,
      `Original Question: ${questionText}`,
      "",
      `Correct Policy/Procedure (provided by support staff):`,
      correction,
    ].join("\n");

    // Fetch next ref_number for 'ALH' source_tag to maintain unique index (source_tag, ref_number)
    const { data: maxRows } = await supabase
      .from("threads")
      .select("ref_number")
      .eq("source_tag", "ALH")
      .order("ref_number", { ascending: false })
      .limit(1);
    
    const nextRefNumber = ((maxRows?.[0]?.ref_number as number) ?? 0) + 1;

    // Generate embedding for the corrected reference message
    let embedding: number[];
    try {
      [embedding] = await embedDocuments([refBodyContent]);
    } catch (embedErr) {
      console.error("Failed to embed feedback correction:", embedErr);
      // We still succeed the request because the feedback rating itself has been recorded
      return Response.json({
        ok: true,
        rating,
        correction,
        warning: "Feedback saved, but failed to embed correction for AI training",
      });
    }

    // Insert the new reference thread
    const { data: newThread, error: newThreadErr } = await supabase
      .from("threads")
      .insert({
        slug: refSlug,
        title: refTitleStr,
        market: thread.market,
        source_tag: "ALH",
        ref_number: nextRefNumber,
      })
      .select("id")
      .single();

    if (newThreadErr) {
      console.error("Failed to create feedback correction thread:", newThreadErr.message);
    } else {
      // Insert the retrievable assistant message
      const { error: newMsgErr } = await supabase
        .from("messages")
        .insert({
          thread_id: newThread.id,
          role: "assistant",
          content: refBodyContent,
          embedding: embedding,
          embedded_at: new Date().toISOString(),
        });

      if (newMsgErr) {
        console.error("Failed to create feedback correction message:", newMsgErr.message);
      }
    }
  }

  return Response.json({ ok: true, rating, correction });
}
