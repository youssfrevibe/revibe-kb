"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ANSWERING_MARKETS, MARKETS, type Market } from "@/lib/markets";

type Entry = {
  id: string;
  slug: string;
  title: string;
  market: string;
  ref_number: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * The "What's new" panel inside the Admin Dashboard.
 *
 * Shows recently added NEWP-tagged references so admins can see the
 * policy changes they have added. Also carries a small form to add
 * a new entry — title, market, content. On submit, POST to
 * /api/admin/new-source which embeds and inserts a NEWP-tagged ref
 * that becomes retrievable immediately.
 */
export function NewSourcePanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form.
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [market, setMarket] = useState<Market>("global");
  const [saving, setSaving] = useState(false);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/new-source");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to load NEW entries");
      setEntries(payload.entries as Entry[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError("Title and content are required");
      return;
    }
    setSaving(true);
    setError(null);
    setOkMessage(null);
    try {
      const response = await fetch("/api/admin/new-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), market }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Add failed");
      setOkMessage(
        `Added NEWP-${String(payload.refNumber).padStart(4, "0")} — the AI can reference it now.`,
      );
      setTitle("");
      setContent("");
      void load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Add form */}
      <form
        onSubmit={submit}
        className="rounded-[var(--revibe-radius)] border p-4"
        style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
      >
        <p className="revibe-label mb-1 text-[11px]">Add a new process or policy</p>
        <p className="mb-3 text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
          The AI will use this as a high-priority reference on the next matching question, in every
          source mode. Visible below and searchable in Previous Chats / Sources.
        </p>

        <label className="revibe-label mb-1 block text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          placeholder='e.g. "KSA — new 14-day return window from 2026-09"'
          className="revibe-focus mb-3 w-full rounded-[var(--revibe-radius)] border px-3 py-2 text-[13px] outline-none"
          style={{ borderColor: "var(--revibe-border-input)", background: "var(--revibe-surface)", color: "var(--revibe-ink)" }}
        />

        <label className="revibe-label mb-1 block text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
          Market
        </label>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ANSWERING_MARKETS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setMarket(code)}
              aria-pressed={market === code}
              className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-2.5 py-1 text-[11px] transition-colors"
              style={{
                background: market === code ? "var(--revibe-ink)" : "var(--revibe-surface)",
                color: market === code ? "#fff" : "var(--revibe-ink)",
                borderColor: market === code ? "var(--revibe-ink)" : "var(--revibe-border)",
              }}
            >
              {MARKETS[code].short}
            </button>
          ))}
        </div>

        <label className="revibe-label mb-1 block text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
          Policy content
        </label>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={6}
          maxLength={10_000}
          placeholder="Full details of the new policy or process. Anything you'd want the AI to quote."
          className="revibe-focus w-full resize-y rounded-[var(--revibe-radius)] border px-3 py-2 text-[13px] outline-none"
          style={{ borderColor: "var(--revibe-border-input)", background: "var(--revibe-surface)", color: "var(--revibe-ink)" }}
        />

        {error ? (
          <div
            className="mt-3 rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
            style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {okMessage ? (
          <div
            className="mt-3 rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
            style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-info-bg)", color: "var(--revibe-ink)" }}
          >
            {okMessage}
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !title.trim() || !content.trim()}
            className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] transition-opacity disabled:opacity-40"
            style={{ background: "var(--revibe-ink)", color: "#fff" }}
          >
            {saving ? "Adding…" : "Add NEW policy"}
          </button>
          <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
            Retrieval boost applies immediately after save.
          </span>
        </div>
      </form>

      {/* Recent entries */}
      <div>
        <p className="revibe-label mb-2 text-[11px]">Recently added ({entries.length})</p>
        {loading ? (
          <p className="text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
            Loading…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
            No NEW entries yet. Add the first above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => {
              const label = entry.ref_number
                ? `NEWP-${String(entry.ref_number).padStart(4, "0")}`
                : "NEWP";
              const marketShort =
                entry.market in MARKETS
                  ? MARKETS[entry.market as keyof typeof MARKETS].short
                  : entry.market;
              return (
                <li key={entry.id}>
                  <Link
                    href={`/t/${entry.slug}`}
                    className="revibe-focus block rounded-[var(--revibe-radius)] border p-3 hover:border-[var(--revibe-ink)]"
                    style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="revibe-label rounded px-1.5 py-0.5 font-mono text-[10px]"
                        style={{ background: "var(--revibe-accent)", color: "#fff" }}
                      >
                        {label}
                      </span>
                      <span className="flex-1 text-[12px] font-semibold">
                        {entry.title.replace(/^NEWP? · [A-Z]+ · /, "")}
                      </span>
                      <span
                        className="revibe-label rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-faint)" }}
                      >
                        {marketShort}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }} suppressHydrationWarning>
                        {new Date(entry.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
