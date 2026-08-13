import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { Chat, type ChatMessage } from "@/components/Chat";
import { ReferenceEditor } from "@/components/ReferenceEditor";
import type { Source } from "@/components/SourcesBlock";
import { missingEnv, configErrorMessage } from "@/lib/config";
import type { SourceTag } from "@/lib/source-tags";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * A saved thread — either a Q&A conversation or an editable reference (TR1 /
 * TR2 / NEWP / NEWL / MSTR). The route decides which component to render based
 * on the thread's source_tag.
 */
export default async function ThreadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const missing = missingEnv();
  if (missing.length > 0) {
    return (
      <div
        className="rounded-[var(--revibe-radius)] border px-3 py-2.5 text-[12px]"
        style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-info-bg)" }}
      >
        {configErrorMessage(missing)}
      </div>
    );
  }

  const supabase = db();

  const { data: thread } = await supabase
    .from("threads")
    .select("id, slug, title, market, source_tag, ref_number")
    .eq("slug", slug)
    .maybeSingle();

  if (!thread) notFound();

  // ---- Reference thread: render the editor -------------------------------
  if (thread.source_tag) {
    const { data: refMessage } = await supabase
      .from("messages")
      .select("id, content, edited_at")
      .eq("thread_id", thread.id as string)
      .eq("role", "assistant")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!refMessage) notFound();

    // Server-side viewer role — client hides Edit for members, server rejects.
    const viewer = await currentUser();
    const canEdit = viewer?.role === "admin" || viewer?.role === "owner";

    return (
      <ReferenceEditor
        threadSlug={thread.slug as string}
        messageId={refMessage.id as string}
        initialContent={refMessage.content as string}
        title={(thread.title as string | null) ?? "Reference"}
        sourceTag={thread.source_tag as SourceTag}
        refNumber={thread.ref_number as number | null}
        market={thread.market as string}
        editedAt={refMessage.edited_at as string | null}
        canEdit={canEdit}
      />
    );
  }

  // ---- Q&A thread: render the chat with history --------------------------
  const { data: rows } = await supabase
    .from("messages")
    .select("id, role, content, feedback_rating, feedback_correction")
    .eq("thread_id", thread.id as string)
    .order("created_at", { ascending: true });

  const messageRows = (rows ?? []) as {
    id: string;
    role: "user" | "assistant";
    content: string;
    feedback_rating?: "good" | "bad" | null;
    feedback_correction?: string | null;
  }[];
  const assistantIds = messageRows.filter((row) => row.role === "assistant").map((row) => row.id);

  const sourcesByMessage = new Map<string, Source[]>();
  if (assistantIds.length > 0) {
    // Sources now point at the source_message row (the editable reference).
    // The join hop is messages → threads to pull the REF slug + number.
    const { data: sourceRows } = await supabase
      .from("message_sources")
      .select(
        `message_id, rank,
         source_message:messages!source_message_id (
           content,
           threads:thread_id (slug, title, market, source_tag, ref_number)
         )`,
      )
      .in("message_id", assistantIds)
      .not("source_message_id", "is", null)
      .order("rank", { ascending: true });

    type SourceRow = {
      message_id: string;
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

    for (const row of (sourceRows ?? []) as unknown as SourceRow[]) {
      const t = row.source_message?.threads;
      if (!t) continue;
      const list = sourcesByMessage.get(row.message_id) ?? [];
      list.push({
        n: row.rank,
        threadSlug: t.slug,
        refNumber: t.ref_number,
        sourceTag: t.source_tag,
        title: t.title,
        market: t.market,
      });
      sourcesByMessage.set(row.message_id, list);
    }
  }

  const messages: ChatMessage[] = messageRows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    sources: row.role === "assistant" ? sourcesByMessage.get(row.id) : undefined,
    feedbackRating: row.feedback_rating ?? undefined,
    feedbackCorrection: row.feedback_correction ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="revibe-label text-[13px]">{(thread.title as string | null) ?? "Thread"}</h1>
      <Chat initialMessages={messages} initialSlug={thread.slug as string} />
    </div>
  );
}
