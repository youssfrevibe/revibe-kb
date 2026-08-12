"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MARKETS } from "@/lib/markets";
import type { ThreadHit } from "@/app/api/threads/search/route";

/**
 * Turn `search_threads`' sentinel-marked snippet into React nodes.
 *
 * Postgres `ts_headline` does not escape the text it highlights, so injecting it
 * as HTML would execute whatever a user had typed into a question. Instead the
 * SQL emits [[hl]]…[[/hl]] markers and we split on them here — React escapes
 * every text node, so there is no injection path at all. A literal "[[hl]]" in a
 * message shows up as stray bold, which is a fine worst case.
 */
function renderSnippet(snippet: string): React.ReactNode[] {
  return snippet.split(/\[\[hl\]\]|\[\[\/hl\]\]/).map((part, index) =>
    // Odd indices are the highlighted spans.
    index % 2 === 1 ? (
      <b key={index} style={{ background: "var(--revibe-info-bg)", fontWeight: 700 }}>
        {part}
      </b>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/**
 * The Threads archive: every past conversation, searchable.
 *
 * Empty query lists newest-first rather than showing nothing, so the tab is
 * browsable when you don't yet know the search term.
 */
export function ThreadSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ThreadHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Debounced so typing doesn't fire a query per keystroke.
    const timer = setTimeout(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/threads/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Search failed");
        setHits(payload.hits as ThreadHit[]);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search past threads…"
        aria-label="Search past threads"
        className="revibe-focus w-full rounded-[var(--revibe-radius)] border px-3 py-2.5 text-[13px] outline-none"
        style={{
          borderColor: "var(--revibe-border-input)",
          background: "var(--revibe-surface)",
          color: "var(--revibe-ink)",
        }}
      />

      {error ? (
        <div
          className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
          style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {hits === null ? (
        <p className="text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
          Loading…
        </p>
      ) : hits.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--revibe-ink-muted)" }}>
          {query
            ? `No threads match “${query}”.`
            : "No threads yet. Ask something on the Ask tab and it will appear here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.map((hit) => (
            <li key={hit.slug}>
              <Link
                href={`/t/${hit.slug}`}
                className="revibe-focus block rounded-[var(--revibe-radius)] border p-3.5 transition-colors hover:border-[var(--revibe-ink)]"
                style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 text-[13px] font-semibold leading-6">
                    {hit.title ?? "Untitled thread"}
                  </span>
                  <span
                    className="revibe-label shrink-0 rounded px-1.5 py-px text-[10px]"
                    style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-faint)" }}
                  >
                    {hit.market in MARKETS ? MARKETS[hit.market as keyof typeof MARKETS].short : hit.market}
                  </span>
                </div>

                {hit.snippet ? (
                  <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--revibe-ink-muted)" }}>
                    {renderSnippet(hit.snippet)}
                  </p>
                ) : null}

                <p className="mt-1.5 text-[11px]" style={{ color: "var(--revibe-ink-faint)" }} suppressHydrationWarning>
                  {hit.messageCount} message{hit.messageCount === 1 ? "" : "s"} ·{" "}
                  {new Date(hit.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
