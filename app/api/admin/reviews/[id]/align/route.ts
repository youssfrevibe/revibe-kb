import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { hybridSearch, type RetrievedRef } from "@/lib/retrieve";
import { generateText, embedDocuments } from "@/lib/gemini";
import type { Market } from "@/lib/markets";
import { isMarket } from "@/lib/markets";

export const runtime = "nodejs";
export const maxDuration = 60;

// The alignment tool sits behind Approve/Correct in the feedback review flow.
// Once a reviewed correction is live as a new ALH ref, the OTHER references
// that still hold the stale wording show up here so the admin can rewrite
// them in one go instead of the KB carrying two conflicting truths on the
// same topic.

const CANDIDATE_LIMIT = 10;

// ---------------------------------------------------------------------------
// GET /api/admin/reviews/[id]/align
// Returns candidate sources with proposed revisions (or "no update needed").
// ---------------------------------------------------------------------------

type CandidateOut = {
  messageId: string;
  threadSlug: string;
  refNumber: number | null;
  sourceTag: string;
  title: string;
  market: string;
  before: string;
  needsUpdate: boolean;
  revised: string | null;
  reason: string;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();

  // 1. Load the review. Must be already resolved (approved/corrected) — you
  //    can't align against something that hasn't been decided yet.
  const { data: review, error: lookupError } = await supabase
    .from("feedback_reviews")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!review) return Response.json({ error: "Review not found" }, { status: 404 });
  if (review.status !== "approved" && review.status !== "corrected") {
    return Response.json({ error: `Review must be approved or corrected before alignment (currently ${review.status})` }, { status: 409 });
  }

  // 2. Decide what the "correct" policy text is — the admin's rewrite if they
  //    chose Correct, otherwise the agent's submitted correction.
  const correction =
    review.status === "corrected" && review.admin_correction
      ? (review.admin_correction as string)
      : (review.submitted_correction as string);
  const market = (review.market as string) || "global";
  if (!isMarket(market)) {
    return Response.json({ error: `Review market ${market} is not a known market` }, { status: 400 });
  }

  // 3. Find candidate sources semantically close to the corrected policy,
  //    then union in the sources originally cited by the wrong answer. Both
  //    sets are in-scope: the semantic set finds refs that talk about the
  //    same topic anywhere; the cited set catches refs the model was
  //    actually reading when it produced the wrong answer.
  const marketFilter: string[] = [market];
  const semanticResults = await hybridSearch(correction, marketFilter, "SRC+ALH", CANDIDATE_LIMIT);

  type CitedSource = { threadSlug: string };
  const citedSourceSlugs = new Set<string>(
    ((review.cited_sources as CitedSource[]) ?? []).map((source) => source.threadSlug),
  );

  const candidates: RetrievedRef[] = [...semanticResults];

  // Add cited sources that aren't already in the semantic top-k.
  if (citedSourceSlugs.size > 0) {
    const missingSlugs = [...citedSourceSlugs].filter(
      (slug) => !candidates.some((candidate) => candidate.threadSlug === slug),
    );
    if (missingSlugs.length > 0) {
      const { data: citedRows } = await supabase
        .from("threads")
        .select("id, slug, title, market, source_tag, ref_number, messages!inner(id, content, role)")
        .in("slug", missingSlugs)
        .eq("messages.role", "assistant");

      type CitedRow = {
        id: string;
        slug: string;
        title: string;
        market: string;
        source_tag: string;
        ref_number: number | null;
        messages: { id: string; content: string; role: string }[];
      };
      for (const row of (citedRows ?? []) as unknown as CitedRow[]) {
        const message = row.messages[0];
        if (!message) continue;
        candidates.push({
          messageId: message.id,
          threadId: row.id,
          threadSlug: row.slug,
          refNumber: row.ref_number,
          sourceTag: row.source_tag as "SRC" | "ALH" | "MSTR",
          title: row.title,
          market: row.market,
          content: message.content,
          score: 0,
        });
      }
    }
  }

  // 4. Drop the newly-created review ALH ref itself so we don't propose
  //    aligning it against itself.
  const createdRefId = review.created_ref_thread_id as string | null;
  const filtered = createdRefId
    ? candidates.filter((candidate) => candidate.threadId !== createdRefId)
    : candidates;

  if (filtered.length === 0) {
    return Response.json({ candidates: [] });
  }

  // 5. Ask Gemini to propose a revision per candidate. Sequential rather
  //    than parallel — the admin is waiting on the UI, and sequential keeps
  //    the log readable and avoids rate-limit spikes.
  const out: CandidateOut[] = [];
  for (const candidate of filtered) {
    let needsUpdate = false;
    let revised: string | null = null;
    let reason = "";

    try {
      const raw = await generateText({
        prompt: [
          "You are aligning a reference source with a corrected policy.",
          "",
          "Corrected policy (authoritative):",
          correction,
          "",
          "Existing source content:",
          candidate.content,
          "",
          "If the source content states policy that CONFLICTS with the correction, propose a rewritten version",
          "of the source that incorporates the correction while preserving all unrelated content and structure.",
          "If the source doesn't conflict (it's about a different topic, or already agrees), return needsUpdate=false.",
          "",
          "Return ONLY a JSON object with this exact shape, no other text, no code fences:",
          `{"needsUpdate": boolean, "revised": string | null, "reason": string}`,
          "",
          "Rules:",
          "- Only set needsUpdate=true when there is a real conflict to fix. Being on the same topic is not enough.",
          "- When needsUpdate=true, `revised` MUST be the full new source content (not a diff, not a snippet).",
          "- Keep formatting, headings, and the leading REF label untouched.",
          "- Do not invent facts. Only apply the correction above; leave everything else as-is.",
          "- `reason` is one short sentence explaining the decision.",
        ].join("\n"),
        maxOutputTokens: 2048,
      });
      const cleaned = raw.replace(/^```(?:json)?/g, "").replace(/```$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.needsUpdate === "boolean") {
        needsUpdate = parsed.needsUpdate;
        revised = typeof parsed.revised === "string" ? parsed.revised : null;
        reason = typeof parsed.reason === "string" ? parsed.reason : "";
        // Defensive: if the model claims needsUpdate but didn't provide new
        // content, treat as not-needing-update. The admin can still edit the
        // source manually via ReferenceEditor.
        if (needsUpdate && !revised) needsUpdate = false;
      }
    } catch (error) {
      reason = `Could not parse model response: ${error instanceof Error ? error.message : String(error)}`;
      needsUpdate = false;
    }

    out.push({
      messageId: candidate.messageId,
      threadSlug: candidate.threadSlug,
      refNumber: candidate.refNumber,
      sourceTag: candidate.sourceTag,
      title: candidate.title,
      market: candidate.market,
      before: candidate.content,
      needsUpdate,
      revised,
      reason,
    });
  }

  return Response.json({
    correction,
    candidates: out,
  });
}

// ---------------------------------------------------------------------------
// POST /api/admin/reviews/[id]/align
// Applies the selected edits, re-embeds each, writes an audit entry per edit.
// ---------------------------------------------------------------------------

type ApplyBody = {
  edits?: Array<{
    messageId?: unknown;
    revised?: unknown;
  }>;
};

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

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawEdits = Array.isArray(body.edits) ? body.edits : [];
  if (rawEdits.length === 0) {
    return Response.json({ error: "edits[] is required and must not be empty" }, { status: 400 });
  }
  if (rawEdits.length > CANDIDATE_LIMIT + 5) {
    // Guard against a caller trying to align 100 things at once.
    return Response.json({ error: "Too many edits in one request" }, { status: 400 });
  }

  const edits = rawEdits.flatMap((edit) => {
    const messageId = typeof edit.messageId === "string" ? edit.messageId : "";
    const revised = typeof edit.revised === "string" ? edit.revised.trim() : "";
    if (!messageId || !revised) return [];
    return [{ messageId, revised }];
  });

  if (edits.length === 0) {
    return Response.json({ error: "No valid edits in payload" }, { status: 400 });
  }

  const supabase = db();

  // 1. Confirm the review exists and is in a state that allows alignment.
  const { data: review, error: lookupError } = await supabase
    .from("feedback_reviews")
    .select("id, status, aligned_edits")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!review) return Response.json({ error: "Review not found" }, { status: 404 });
  if (review.status !== "approved" && review.status !== "corrected") {
    return Response.json({ error: `Cannot align a ${review.status} review` }, { status: 409 });
  }

  // 2. Load current message content for each target (so we snapshot "before"
  //    at apply time — using the client's before value is untrusted).
  const messageIds = edits.map((edit) => edit.messageId);
  const { data: currentMessages, error: loadError } = await supabase
    .from("messages")
    .select("id, content, thread_id, threads!inner(slug, title, market, source_tag, ref_number)")
    .in("id", messageIds);
  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });

  type CurrentMessage = {
    id: string;
    content: string;
    thread_id: string;
    threads: {
      slug: string;
      title: string;
      market: string;
      source_tag: string | null;
      ref_number: number | null;
    } | null;
  };
  const byId = new Map<string, CurrentMessage>();
  for (const message of (currentMessages ?? []) as unknown as CurrentMessage[]) byId.set(message.id, message);

  // 3. Embed the revised bodies in one batch.
  const revisedTexts = edits.map((edit) => edit.revised);
  let embeddings: number[][];
  try {
    embeddings = await embedDocuments(revisedTexts);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `Embedding failed: ${detail}` }, { status: 502 });
  }

  // 4. Apply each edit sequentially: update the message + embedding, record
  //    audit. If one fails, previous ones stay applied — those edits are the
  //    admin's real intent and don't need to be rolled back.
  const now = new Date().toISOString();
  const applied: Array<Record<string, unknown>> = [];
  const failures: Array<{ messageId: string; error: string }> = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const before = byId.get(edit.messageId);
    if (!before || !before.threads) {
      failures.push({ messageId: edit.messageId, error: "Message not found or has no parent thread" });
      continue;
    }
    if (!before.threads.source_tag) {
      failures.push({ messageId: edit.messageId, error: "Cannot align a non-reference thread" });
      continue;
    }
    // No-op guard.
    if (before.content.trim() === edit.revised.trim()) {
      failures.push({ messageId: edit.messageId, error: "Revised text matches current — nothing to apply" });
      continue;
    }

    const { error: updateError } = await supabase
      .from("messages")
      .update({
        content: edit.revised,
        embedding: embeddings[i],
        embedded_at: now,
        edited_at: now,
      })
      .eq("id", edit.messageId);
    if (updateError) {
      failures.push({ messageId: edit.messageId, error: updateError.message });
      continue;
    }
    await supabase.from("threads").update({ updated_at: now }).eq("id", before.thread_id);

    applied.push({
      messageId: edit.messageId,
      threadSlug: before.threads.slug,
      refNumber: before.threads.ref_number,
      sourceTag: before.threads.source_tag,
      title: before.threads.title,
      market: before.threads.market,
      before: before.content,
      after: edit.revised,
      editedAt: now,
      editedBy: user.uid,
    });
  }

  // 5. Write the audit trail onto the review row.
  if (applied.length > 0) {
    const prior = Array.isArray(review.aligned_edits) ? (review.aligned_edits as unknown[]) : [];
    const { error: auditError } = await supabase
      .from("feedback_reviews")
      .update({ aligned_edits: [...prior, ...applied], updated_at: now })
      .eq("id", id);
    if (auditError) console.error("Failed to write alignment audit:", auditError.message);
  }

  return Response.json({
    ok: true,
    appliedCount: applied.length,
    applied,
    failures,
  });
}
