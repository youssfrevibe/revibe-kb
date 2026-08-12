"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MARKETS } from "@/lib/markets";

type Candidate = {
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

type Props = {
  reviewId: string;
  onDone: () => void;
};

/**
 * Universal source alignment picker.
 *
 * After an Admin approves or corrects a feedback review, this component
 * fetches candidate sources semantically close to the corrected policy
 * (plus the sources originally cited by the wrong answer) and asks Gemini
 * for a proposed rewrite of each.
 *
 * The admin sees the before/after per candidate, ticks the ones to apply,
 * confirms — each ticked source is edited + re-embedded server-side.
 * Sources not ticked stay untouched.
 */
export function AlignmentPicker({ reviewId, onDone }: Props) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<{ appliedCount: number; failures: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/admin/reviews/${reviewId}/align`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? "Failed to load candidates");
        setCandidates(payload.candidates as Candidate[]);
        // Pre-select only the candidates the model actually flagged. Admin
        // can uncheck any they don't want, and can tick "no update needed"
        // ones manually if they disagree with the model.
        const pre = new Set<string>(
          (payload.candidates as Candidate[])
            .filter((candidate) => candidate.needsUpdate && candidate.revised)
            .map((candidate) => candidate.messageId),
        );
        setSelected(pre);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  function toggle(messageId: string, revisedAvailable: boolean) {
    if (!revisedAvailable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  async function apply() {
    if (!candidates) return;
    const edits = candidates
      .filter((candidate) => selected.has(candidate.messageId) && candidate.revised)
      .map((candidate) => ({ messageId: candidate.messageId, revised: candidate.revised! }));
    if (edits.length === 0) {
      onDone();
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reviews/${reviewId}/align`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Apply failed");
      setSummary({
        appliedCount: payload.appliedCount as number,
        failures: (payload.failures?.length as number) ?? 0,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-3 rounded-[var(--revibe-radius)] border p-3 text-[12px]" style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-canvas)" }}>
        <span style={{ color: "var(--revibe-ink-muted)" }}>
          Checking other sources for the same policy…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-[var(--revibe-radius)] border p-3 text-[12px]" style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }} role="alert">
        {error}
        <button type="button" onClick={onDone} className="ml-3 underline">
          Skip alignment
        </button>
      </div>
    );
  }

  if (summary) {
    return (
      <div className="mt-3 rounded-[var(--revibe-radius)] border p-3 text-[12px]" style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-canvas)" }}>
        <p style={{ color: "var(--revibe-ink)" }}>
          Aligned <strong>{summary.appliedCount}</strong> source{summary.appliedCount === 1 ? "" : "s"}.
          {summary.failures > 0 ? <> {summary.failures} failed.</> : null}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="revibe-label revibe-focus mt-2 rounded-[var(--revibe-radius)] border px-3 py-1 text-[10px]"
          style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
        >
          Done
        </button>
      </div>
    );
  }

  if (!candidates || candidates.length === 0) {
    return (
      <div className="mt-3 rounded-[var(--revibe-radius)] border p-3 text-[12px]" style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-canvas)" }}>
        <p style={{ color: "var(--revibe-ink-muted)" }}>
          No other sources overlap with this correction.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="revibe-label revibe-focus mt-2 rounded-[var(--revibe-radius)] border px-3 py-1 text-[10px]"
          style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
        >
          Done
        </button>
      </div>
    );
  }

  const flagged = candidates.filter((candidate) => candidate.needsUpdate).length;

  return (
    <div className="mt-3 rounded-[var(--revibe-radius)] border p-3" style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-canvas)" }}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <p className="revibe-label text-[10px]" style={{ color: "var(--revibe-accent)" }}>
            Align other sources
          </p>
          <p className="text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
            {flagged} of {candidates.length} candidate{candidates.length === 1 ? "" : "s"} look like they hold conflicting wording. Review each before applying.
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="revibe-focus text-[10px] underline"
          style={{ color: "var(--revibe-ink-faint)" }}
        >
          Skip
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {candidates.map((candidate) => {
          const label = candidate.refNumber
            ? `${candidate.sourceTag}-${String(candidate.refNumber).padStart(4, "0")}`
            : candidate.sourceTag;
          const marketShort =
            candidate.market in MARKETS
              ? MARKETS[candidate.market as keyof typeof MARKETS].short
              : candidate.market;
          const canSelect = candidate.needsUpdate && Boolean(candidate.revised);
          const isSelected = selected.has(candidate.messageId);
          const isExpanded = expandedId === candidate.messageId;
          return (
            <li
              key={candidate.messageId}
              className="rounded-[var(--revibe-radius)] border p-2.5"
              style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!canSelect || applying}
                  onChange={() => toggle(candidate.messageId, canSelect)}
                  aria-label={`Apply revision to ${label}`}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <Link
                      href={`/t/${candidate.threadSlug}`}
                      target="_blank"
                      className="revibe-focus rounded px-1 font-mono text-[10px]"
                      style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink)" }}
                    >
                      {label}
                    </Link>
                    <span className="flex-1 text-[12px] font-semibold">
                      {candidate.title.replace(/^(?:SRC|ALH|MSTR)-\d+ · /, "")}
                    </span>
                    <span
                      className="rounded px-1 text-[9px] uppercase tracking-wider"
                      style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-faint)" }}
                    >
                      {marketShort}
                    </span>
                    <span
                      className="revibe-label text-[9px]"
                      style={{ color: canSelect ? "var(--revibe-accent)" : "var(--revibe-ink-faint)" }}
                    >
                      {canSelect ? "conflicts" : "no update"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5" style={{ color: "var(--revibe-ink-muted)" }}>
                    {candidate.reason || (canSelect ? "Model proposed a revised version." : "Model did not flag a conflict.")}
                  </p>

                  {canSelect ? (
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : candidate.messageId)}
                      className="revibe-focus mt-1 text-[10px] underline"
                      style={{ color: "var(--revibe-ink-faint)" }}
                    >
                      {isExpanded ? "Hide diff" : "Show before / after"}
                    </button>
                  ) : null}

                  {isExpanded && canSelect ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="revibe-label mb-1 text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
                          Before
                        </p>
                        <pre
                          className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[var(--revibe-radius)] border p-2 text-[11px] leading-5"
                          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-canvas)", fontFamily: "inherit" }}
                        >
                          {candidate.before}
                        </pre>
                      </div>
                      <div>
                        <p className="revibe-label mb-1 text-[9px]" style={{ color: "var(--revibe-accent)" }}>
                          After
                        </p>
                        <pre
                          className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[var(--revibe-radius)] border p-2 text-[11px] leading-5"
                          style={{ borderColor: "var(--revibe-accent)", background: "var(--revibe-surface)", fontFamily: "inherit" }}
                        >
                          {candidate.revised ?? ""}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={applying || selected.size === 0}
          className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] transition-opacity disabled:opacity-40"
          style={{ background: "var(--revibe-ink)", color: "#fff" }}
        >
          {applying ? "Applying…" : `Apply ${selected.size} edit${selected.size === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={applying}
          className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-3 py-1.5 text-[11px]"
          style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
        >
          Skip alignment
        </button>
        <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
          Edits take effect immediately and re-embed each source.
        </span>
      </div>
    </div>
  );
}
