import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { embedDocuments } from "@/lib/gemini";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Edit a reference thread's assistant message and re-embed it.
 *
 * PATCH /api/threads/[slug]/messages/[id]
 * body: { content: string }
 *
 * Only allowed on threads with a source_tag (the TR1/TR2/NEWP/NEWL/MSTR
 * reference catalog). Q&A threads are conversation history — editing them would
 * rewrite what a user actually asked, which is worse than useless.
 *
 * The moment this succeeds, future retrievals that hit this reference return
 * the updated wording. No re-ingest, no rebuild — that's the whole reason for
 * the pivot.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await context.params;

  // Reference editing is admin+owner only. Members can view TR1/TR2/NEWP/NEWL/MSTR
  // threads but the Edit UI is hidden and the API rejects them here too.
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return Response.json({ error: "content is required" }, { status: 400 });
  if (content.length > 20_000) {
    return Response.json({ error: "content is too long (20,000 char limit)" }, { status: 400 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();

  // Editable only on a reference thread. Look up the thread + confirm the
  // message belongs to it, in one round-trip.
  const { data: message, error: lookupError } = await supabase
    .from("messages")
    .select("id, role, thread_id, threads!inner(slug, source_tag)")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!message) return Response.json({ error: "Message not found" }, { status: 404 });

  const thread = message.threads as unknown as { slug: string; source_tag: string | null } | null;
  if (!thread || thread.slug !== slug) return Response.json({ error: "Message does not belong to this thread" }, { status: 404 });
  if (!thread.source_tag) return Response.json({ error: "Only reference threads (TR1/TR2/NEWP/NEWL/MSTR) can be edited" }, { status: 403 });
  if (message.role !== "assistant") return Response.json({ error: "Only the reference body is editable" }, { status: 403 });

  // Embed FIRST — if this fails, the message stays intact and searchable at
  // its old wording, which is much better than an unembedded row silently
  // dropping out of retrieval.
  let embedding: number[];
  try {
    [embedding] = await embedDocuments([content]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `Embedding failed: ${detail}` }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("messages")
    .update({ content, embedding, embedded_at: now, edited_at: now })
    .eq("id", id);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  await supabase.from("threads").update({ updated_at: now }).eq("id", message.thread_id);

  return Response.json({ ok: true, editedAt: now });
}
