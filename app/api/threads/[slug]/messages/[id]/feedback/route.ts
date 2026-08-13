import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { currentUser } from "@/lib/auth";
import { embedDocuments } from "@/lib/gemini";
import { newSlug } from "@/lib/slug";

export const runtime = "nodejs";

/**
 * Feedback submission — good/bad + mandatory correction on bad.
 *
 * BEHAVIOUR CHANGE: bad + correction no longer auto-creates a NEWL reference
 * thread. It now writes a row to `feedback_reviews` with status='pending'
 * for an Admin to review. Approve/Correct is what actually mints the NEWL
 * ref — see /api/admin/reviews/[id]/*.
 *
 * The old `messages.feedback_rating` and `messages.feedback_correction`
 * columns keep being written so the existing dashboard still sees ratings
 * flowing through.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await context.params;

  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

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
  if (correction.length > 5000) {
    return Response.json({ error: "correction is too long (5000 char limit)" }, { status: 400 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();

  // 1. Verify the message exists and belongs to the thread.
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
  if (originalMessage.role !== "assistant") {
    return Response.json({ error: "Only assistant messages take feedback" }, { status: 400 });
  }

  // 2. Fetch the user's question — the message immediately before this one.
  const { data: priorMessages } = await supabase
    .from("messages")
    .select("role, content")
    .eq("thread_id", originalMessage.thread_id)
    .lt("created_at", originalMessage.created_at || new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  const questionMessage = priorMessages?.[0];
  const questionText = questionMessage?.role === "user" ? questionMessage.content : "(question missing)";

  // 3. Snapshot the sources at feedback time so the reviewer sees exactly what
  //    the agent saw. If the underlying refs later get edited, the review still
  //    holds the historical context.
  const { data: sourceRows } = await supabase
    .from("message_sources")
    .select(
      `rank,
       source_message:messages!source_message_id (
         threads:thread_id (slug, title, market, source_tag, ref_number)
       )`,
    )
    .eq("message_id", id)
    .not("source_message_id", "is", null)
    .order("rank", { ascending: true });

  type SnapRow = {
    rank: number;
    source_message: {
      threads: {
        slug: string;
        title: string;
        market: string;
        source_tag: string;
        ref_number: number | null;
      } | null;
    } | null;
  };
  const citedSources = ((sourceRows ?? []) as unknown as SnapRow[])
    .flatMap((row) => {
      const t = row.source_message?.threads;
      if (!t) return [];
      return [{
        rank: row.rank,
        threadSlug: t.slug,
        title: t.title,
        market: t.market,
        sourceTag: t.source_tag,
        refNumber: t.ref_number,
      }];
    });

  // 4. Update the assistant message with the rating + correction (keeps the
  //    existing dashboard's data flowing) and the reviewer identity.
  const { error: updateError } = await supabase
    .from("messages")
    .update({
      feedback_rating: rating,
      feedback_correction: rating === "bad" ? correction : null,
      feedback_by: user.uid,
    })
    .eq("id", id);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  // 5. On bad ratings, enqueue for admin review. Do NOT auto-create a NEWL ref
  //    — that used to happen here but is now the admin's decision.
  if (rating === "bad" && correction) {
    const { error: queueError } = await supabase
      .from("feedback_reviews")
      .insert({
        message_id: id,
        submitted_by: user.uid,
        question: questionText,
        wrong_answer: originalMessage.content,
        cited_sources: citedSources,
        market: thread.market,
        submitted_correction: correction,
        status: "pending",
      });
    // A pending row for the same message already exists — that's fine, the
    // partial unique index prevents duplicates. Surface the resulting state,
    // don't fail the request.
    if (queueError && !/unique/i.test(queueError.message)) {
      console.error("Failed to enqueue feedback review:", queueError.message);
      return Response.json({ error: queueError.message }, { status: 500 });
    }
  }

  // 6. On good ratings, reinforce the AI by auto-minting a NEWL reference thread.
  if (rating === "good") {
    try {
      const refSlug = newSlug();
      const cleanQuestion = questionText.split("\n")[0].trim().slice(0, 60);
      const refTitle = `Reinforced Answer · ${thread.market.toUpperCase()} · ${cleanQuestion}${cleanQuestion.length >= 60 ? "…" : ""}`;

      const refBody = [
        `**REINFORCED ANSWER** · ${thread.market.toUpperCase()} · rated helpful by ${user.email}`,
        `Original question: ${questionText}`,
        "",
        `Good answer:`,
        originalMessage.content,
      ].join("\n");

      const [embedding] = await embedDocuments([refBody]);
      
      const { data: maxRows } = await supabase
        .from("threads")
        .select("ref_number")
        .eq("source_tag", "NEWL")
        .not("ref_number", "is", null)
        .order("ref_number", { ascending: false })
        .limit(1);
      const nextRefNumber = ((maxRows?.[0]?.ref_number as number) ?? 0) + 1;

      const { data: newThread, error: threadError } = await supabase
        .from("threads")
        .insert({
          slug: refSlug,
          title: refTitle,
          market: thread.market,
          source_tag: "NEWL",
          ref_number: nextRefNumber,
        })
        .select("id")
        .single();

      if (!threadError && newThread) {
        await supabase
          .from("messages")
          .insert({
            thread_id: newThread.id,
            role: "assistant",
            content: refBody,
            embedding,
            embedded_at: new Date().toISOString(),
          });
      } else {
        console.error("Failed to create reinforced thread:", threadError?.message);
      }
    } catch (err) {
      console.error("Failed to embed or save reinforced good answer:", err);
    }
  }

  return Response.json({ ok: true, rating, correction, queued: rating === "bad" });
}
