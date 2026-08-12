import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { embedDocuments } from "@/lib/gemini";
import { newSlug } from "@/lib/slug";
import { currentUser } from "@/lib/auth";
import { missingEnv, configErrorMessage } from "@/lib/config";

export const runtime = "nodejs";

/**
 * Act on a pending review: approve / correct / invalid.
 *
 * POST /api/admin/reviews/[id]
 * body:
 *   { action: 'approve' }              → uses the submitted correction verbatim
 *   { action: 'correct', text: '...' } → uses the admin's rewritten text instead
 *   { action: 'invalid', notes?: '' }  → no ALH ref created, row stays for audit
 *
 * On approve/correct, this is where the ALH reference thread gets created —
 * the move from the auto-teach flow. On invalid, nothing gets taught.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { action?: unknown; text?: unknown; notes?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; text?: unknown; notes?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!["approve", "correct", "invalid"].includes(action)) {
    return Response.json({ error: "action must be approve | correct | invalid" }, { status: 400 });
  }
  if (action === "correct" && !text) {
    return Response.json({ error: "'correct' requires a text field" }, { status: 400 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();

  // 1. Load the review; must be pending.
  const { data: review, error: lookupError } = await supabase
    .from("feedback_reviews")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!review) return Response.json({ error: "Review not found" }, { status: 404 });
  if (review.status !== "pending") {
    return Response.json({ error: `Review is already ${review.status}` }, { status: 409 });
  }

  const now = new Date().toISOString();

  // 2. Invalid path: mark and return, no ALH ref.
  if (action === "invalid") {
    const { error: updateError } = await supabase
      .from("feedback_reviews")
      .update({
        status: "invalid",
        reviewed_by: user.uid,
        reviewed_at: now,
        admin_notes: notes || null,
      })
      .eq("id", id);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
    return Response.json({ ok: true, status: "invalid" });
  }

  // 3. Approve/correct: mint the ALH reference thread. This is the code path
  //    that used to fire automatically inside the feedback route.
  const finalCorrection = action === "correct" ? text : (review.submitted_correction as string);
  const market = (review.market as string) || "global";
  const question = review.question as string;

  const refSlug = newSlug();
  const cleanQuestion = question.split("\n")[0].trim().slice(0, 60);
  const refTitle = `Reviewed Correction · ${market.toUpperCase()} · ${cleanQuestion}${cleanQuestion.length >= 60 ? "…" : ""}`;

  // Structured body — the reviewer's decision, the source question, and the
  // corrected policy — so retrieval sees a rich, self-contained ALH passage.
  const refBody = [
    `**REVIEWED CORRECTION** · ${market.toUpperCase()} · reviewed by ${user.email}`,
    `Original question: ${question}`,
    "",
    `Correct policy:`,
    finalCorrection,
  ].join("\n");

  let embedding: number[];
  try {
    [embedding] = await embedDocuments([refBody]);
  } catch (embedErr) {
    const detail = embedErr instanceof Error ? embedErr.message : String(embedErr);
    return Response.json({ error: `Embedding failed: ${detail}` }, { status: 502 });
  }

  // Next ALH ref number. Same race caveat as the earlier auto-teach code —
  // rare in practice but noted.
  const { data: maxRows } = await supabase
    .from("threads")
    .select("ref_number")
    .eq("source_tag", "ALH")
    .order("ref_number", { ascending: false })
    .limit(1);
  const nextRefNumber = ((maxRows?.[0]?.ref_number as number) ?? 0) + 1;

  const { data: newThread, error: threadError } = await supabase
    .from("threads")
    .insert({
      slug: refSlug,
      title: refTitle,
      market,
      source_tag: "ALH",
      ref_number: nextRefNumber,
    })
    .select("id")
    .single();
  if (threadError) return Response.json({ error: threadError.message }, { status: 500 });

  const { error: messageError } = await supabase
    .from("messages")
    .insert({
      thread_id: newThread.id,
      role: "assistant",
      content: refBody,
      embedding,
      embedded_at: now,
    });
  if (messageError) return Response.json({ error: messageError.message }, { status: 500 });

  // 4. Update the review row: status, reviewer, timestamp, link to the new ref.
  const status = action === "approve" ? "approved" : "corrected";
  const { error: reviewUpdateError } = await supabase
    .from("feedback_reviews")
    .update({
      status,
      reviewed_by: user.uid,
      reviewed_at: now,
      admin_correction: action === "correct" ? text : null,
      admin_notes: notes || null,
      created_ref_thread_id: newThread.id,
    })
    .eq("id", id);
  if (reviewUpdateError) return Response.json({ error: reviewUpdateError.message }, { status: 500 });

  return Response.json({
    ok: true,
    status,
    refThreadSlug: refSlug,
    refNumber: nextRefNumber,
  });
}
