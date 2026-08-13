import { db } from "@/lib/supabase";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { SourcesBrowser } from "@/components/SourcesBrowser";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources · Revibe Knowledge Base" };

export default async function SourcesPage() {
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

  // Fetch all knowledge-base reference threads with their assistant message content.
  // Everything except the master template (MSTR) and Q&A threads (null tag).
  const { data: rawThreads, error } = await supabase
    .from("threads")
    .select("slug, title, source_tag, ref_number, market, updated_at, messages(id, content, role)")
    .in("source_tag", ["TR1", "TR2", "NEWP", "NEWL"])
    .order("source_tag", { ascending: true })
    .order("ref_number", { ascending: true });

  if (error) {
    return (
      <div
        className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
        style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
      >
        Failed to load sources: {error.message}
      </div>
    );
  }

  type RawThread = {
    slug: string;
    title: string | null;
    source_tag: string;
    ref_number: number | null;
    market: string;
    updated_at: string;
    messages: { id: string; content: string; role: string }[];
  };

  const sources = ((rawThreads ?? []) as unknown as RawThread[]).map((t) => {
    const assistantMsg = t.messages.find((m) => m.role === "assistant");
    const refLabel = t.ref_number !== null
      ? `${t.source_tag}-${String(t.ref_number).padStart(4, "0")}`
      : t.source_tag;

    return {
      slug: t.slug,
      title: t.title ?? "Untitled",
      refLabel,
      sourceTag: t.source_tag,
      market: t.market,
      updatedAt: t.updated_at,
      snippet: assistantMsg?.content?.slice(0, 200) ?? "",
    };
  });

  return <SourcesBrowser sources={sources} />;
}
