"use client";

import { useState } from "react";
import Link from "next/link";
import { MARKETS } from "@/lib/markets";

type Source = {
  slug: string;
  title: string;
  refLabel: string;
  sourceTag: string;
  market: string;
  updatedAt: string;
  snippet: string;
};

export function SourcesBrowser({ sources }: { sources: Source[] }) {
  const [query, setQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  const markets = Array.from(new Set(sources.map((s) => s.market))).sort();
  const tags = Array.from(new Set(sources.map((s) => s.sourceTag))).sort();

  const filtered = sources.filter((s) => {
    const q = query.toLowerCase();
    const matchesQuery =
      !q ||
      s.title.toLowerCase().includes(q) ||
      s.refLabel.toLowerCase().includes(q) ||
      s.snippet.toLowerCase().includes(q);
    const matchesMarket = marketFilter === "all" || s.market === marketFilter;
    const matchesTag = tagFilter === "all" || s.sourceTag === tagFilter;
    return matchesQuery && matchesMarket && matchesTag;
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="revibe-label text-[13px]">Sources</h1>
        <p className="mt-1 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
          All indexed knowledge base material (TR1, TR2, NEWP &amp; NEWL). Click any source to view or edit its content.
        </p>
      </div>

      {/* Search and filter controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sources by title or content…"
          aria-label="Search sources"
          className="revibe-focus flex-1 rounded-[var(--revibe-radius)] border px-3 py-2.5 text-[13px] outline-none"
          style={{
            borderColor: "var(--revibe-border-input)",
            background: "var(--revibe-surface)",
            color: "var(--revibe-ink)",
            minWidth: "200px",
          }}
        />

        <select
          value={marketFilter}
          onChange={(e) => setMarketFilter(e.target.value)}
          className="revibe-focus rounded-[var(--revibe-radius)] border px-2 py-2.5 text-[12px] outline-none"
          style={{
            borderColor: "var(--revibe-border-input)",
            background: "var(--revibe-surface)",
            color: "var(--revibe-ink)",
          }}
        >
          <option value="all">All Markets</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {m in MARKETS ? MARKETS[m as keyof typeof MARKETS].short : m}
            </option>
          ))}
        </select>

        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="revibe-focus rounded-[var(--revibe-radius)] border px-2 py-2.5 text-[12px] outline-none"
          style={{
            borderColor: "var(--revibe-border-input)",
            background: "var(--revibe-surface)",
            color: "var(--revibe-ink)",
          }}
        >
          <option value="all">All Types</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Count badge */}
      <p className="text-[11px]" style={{ color: "var(--revibe-ink-faint)" }}>
        {filtered.length} source{filtered.length === 1 ? "" : "s"}{" "}
        {query || marketFilter !== "all" || tagFilter !== "all" ? `(filtered from ${sources.length} total)` : "total"}
      </p>

      {/* Source list */}
      {filtered.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--revibe-ink-muted)" }}>
          {query ? `No sources match "${query}".` : "No source material has been indexed yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((source) => (
            <li key={source.slug}>
              <Link
                href={`/t/${source.slug}`}
                className="revibe-focus block rounded-[var(--revibe-radius)] border p-3.5 transition-colors hover:border-[var(--revibe-ink)]"
                style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="revibe-label shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums"
                    style={{ background: "var(--revibe-ink)", color: "#fff" }}
                  >
                    {source.refLabel}
                  </span>
                  <span className="flex-1 text-[13px] font-semibold leading-6">
                    {source.title.replace(/^(?:TR1|TR2|NEWP|NEWL|MSTR)-\d+ · /, "")}
                  </span>
                  <span
                    className="revibe-label shrink-0 rounded px-1.5 py-px text-[10px]"
                    style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-faint)" }}
                  >
                    {source.market in MARKETS
                      ? MARKETS[source.market as keyof typeof MARKETS].short
                      : source.market}
                  </span>
                </div>

                {source.snippet ? (
                  <p
                    className="mt-1 line-clamp-2 text-[12px] leading-5"
                    style={{ color: "var(--revibe-ink-muted)" }}
                  >
                    {source.snippet}
                  </p>
                ) : null}

                <p className="mt-1.5 text-[11px]" style={{ color: "var(--revibe-ink-faint)" }} suppressHydrationWarning>
                  {new Date(source.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
