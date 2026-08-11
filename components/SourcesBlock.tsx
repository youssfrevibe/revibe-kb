import Link from "next/link";
import { MARKETS } from "@/lib/markets";

export type Source = {
  n: number;
  threadSlug: string;
  refNumber: number | null;
  sourceTag: string;
  title: string;
  market: string;
};

function refLabel(source: Source): string {
  if (source.refNumber === null) return source.sourceTag;
  return `${source.sourceTag}-${String(source.refNumber).padStart(4, "0")}`;
}

// Seed script prepends "TAG-#### · " to the stored thread title so the
// Threads archive list shows the reference number. That prefix is now
// redundant next to the REF badge, so strip it for display.
function stripRefPrefix(title: string): string {
  return title.replace(/^(?:SRC|ALH|MSTR)-\d+ · /, "");
}

/**
 * Sources listed under the answer, deliberately quiet.
 *
 * The answer is the deliverable; sources are the audit trail. Each one is a
 * link to the underlying editable reference thread — click the REF label and
 * you land on `/t/[slug]` where you can correct the wording that produced this
 * answer.
 */
export function SourcesBlock({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-4 border-t pt-2.5" style={{ borderColor: "var(--revibe-border)" }}>
      <p className="revibe-label mb-1 text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
        Sources · {sources.length}
      </p>
      <ol className="flex flex-col gap-0.5">
        {sources.map((source) => (
          <li
            key={`${source.n}-${source.threadSlug}`}
            className="flex items-baseline gap-2 text-[11px] leading-5"
            style={{ color: "var(--revibe-ink-muted)" }}
          >
            <span className="w-3 shrink-0 tabular-nums text-right" style={{ color: "var(--revibe-ink-faint)" }}>
              {source.n}
            </span>
            <Link
              href={`/t/${source.threadSlug}`}
              className="revibe-focus shrink-0 rounded px-1 font-mono tabular-nums text-[10px]"
              style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink)" }}
            >
              {refLabel(source)}
            </Link>
            <span className="min-w-0 flex-1 truncate">
              <span style={{ color: "var(--revibe-ink)" }}>{stripRefPrefix(source.title)}</span>
            </span>
            <span
              className="shrink-0 rounded px-1 text-[9px] uppercase tracking-wider"
              style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-faint)" }}
            >
              {source.market in MARKETS ? MARKETS[source.market as keyof typeof MARKETS].short : source.market}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
