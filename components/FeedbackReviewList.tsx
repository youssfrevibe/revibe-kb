"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MARKETS } from "@/lib/markets";
import { AlignmentPicker } from "./AlignmentPicker";

type CitedSource = {
  rank: number;
  threadSlug: string;
  title: string;
  market: string;
  sourceTag: string;
  refNumber: number | null;
};

type Review = {
  id: string;
  message_id: string;
  submitted_by: string | null;
  question: string;
  wrong_answer: string;
  cited_sources: CitedSource[];
  market: string | null;
  submitted_correction: string;
  status: "pending" | "approved" | "corrected" | "invalid";
  created_at: string;
};

type ReviewAction = "approve" | "correct" | "invalid";

/**
 * The feedback review queue.
 *
 * Displays pending reviews with the wrong answer, the sources it cited, and
 * the agent's proposed correction. Admins choose: Approve (use the agent's
 * text), Correct (write your own), or Invalid (reject).
 */
export function FeedbackReviewList() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ id: string; action: ReviewAction } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [notes, setNotes] = useState("");
  // When an approve/correct succeeds, the row stays visible and switches into
  // an "align other sources?" panel. Cleared when the admin skips or finishes.
  const [aligningReviewId, setAligningReviewId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/reviews?status=pending");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to load reviews");
      setReviews(payload.reviews as Review[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function apply(review: Review, action: ReviewAction) {
    setBusyId(review.id);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "correct") body.text = correctionText.trim();
      if (action === "invalid" && notes.trim()) body.notes = notes.trim();

      const response = await fetch(`/api/admin/reviews/${review.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Action failed");

      setPendingAction(null);
      setCorrectionText("");
      setNotes("");

      if (action === "approve" || action === "correct") {
        // Keep the row visible but flipped into the alignment step. Reload
        // happens once the admin finishes or skips alignment — that way
        // fresh reviews landing in the queue don't yank this row away
        // mid-alignment.
        setAligningReviewId(review.id);
      } else {
        // Invalid: gone from the queue entirely.
        setReviews((prev) => prev.filter((review_) => review_.id !== review.id));
        void load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
        Loading reviews…
      </p>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
        style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
      >
        {error}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: "var(--revibe-ink-muted)" }}>
        Nothing pending. Corrections submitted by agents will appear here for review.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {reviews.map((review) => {
        const expanded = expandedId === review.id;
        const pending = pendingAction?.id === review.id ? pendingAction.action : null;
        const aligning = aligningReviewId === review.id;
        const marketShort =
          review.market && review.market in MARKETS
            ? MARKETS[review.market as keyof typeof MARKETS].short
            : review.market ?? "—";
        return (
          <li
            key={review.id}
            className="rounded-[var(--revibe-radius)] border p-4"
            style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
          >
            {aligning ? (
              <AlignmentPicker
                reviewId={review.id}
                onDone={() => {
                  setAligningReviewId(null);
                  setReviews((prev) => prev.filter((r) => r.id !== review.id));
                  void load();
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="revibe-label rounded px-1.5 py-0.5 text-[9px]"
                    style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-muted)" }}
                  >
                    {marketShort}
                  </span>
                  <span className="flex-1 text-[13px] font-semibold">{review.question}</span>
                  <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }} suppressHydrationWarning>
                    {new Date(review.created_at).toLocaleString()}
                  </span>
                </div>

                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="revibe-label mb-1 text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
                      Wrong answer
                    </p>
                    <p
                      className="whitespace-pre-wrap text-[12px] leading-5"
                      style={{ color: "var(--revibe-ink-muted)" }}
                    >
                      {expanded || review.wrong_answer.length < 400
                        ? review.wrong_answer
                        : review.wrong_answer.slice(0, 400) + "…"}
                    </p>
                    {review.wrong_answer.length >= 400 && !expanded ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(review.id)}
                        className="revibe-focus mt-1 text-[10px] underline"
                        style={{ color: "var(--revibe-ink-faint)" }}
                      >
                        Show full answer
                      </button>
                    ) : null}
                  </div>
                  <div>
                    <p className="revibe-label mb-1 text-[9px]" style={{ color: "var(--revibe-accent)" }}>
                      Agent&apos;s correction
                    </p>
                    <p className="whitespace-pre-wrap text-[12px] leading-5">{review.submitted_correction}</p>
                  </div>
                </div>

                {review.cited_sources.length > 0 ? (
                  <div className="mt-3">
                    <p className="revibe-label mb-1 text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
                      Sources cited
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {review.cited_sources.map((source) => {
                        const label = source.refNumber
                          ? `${source.sourceTag}-${String(source.refNumber).padStart(4, "0")}`
                          : source.sourceTag;
                        return (
                          <Link
                            key={source.threadSlug}
                            href={`/t/${source.threadSlug}`}
                            target="_blank"
                            className="revibe-focus rounded px-1.5 py-0.5 font-mono text-[10px]"
                            style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink)" }}
                          >
                            {label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {pending === "correct" ? (
                  <div className="mt-3">
                    <p className="revibe-label mb-1 text-[9px]">Your correction (replaces agent&apos;s)</p>
                    <textarea
                      value={correctionText}
                      onChange={(event) => setCorrectionText(event.target.value)}
                      rows={4}
                      maxLength={5000}
                      className="revibe-focus w-full rounded-[var(--revibe-radius)] border p-2 text-[12px] outline-none"
                      style={{ borderColor: "var(--revibe-border-input)", background: "var(--revibe-canvas)" }}
                    />
                  </div>
                ) : null}

                {pending === "invalid" ? (
                  <div className="mt-3">
                    <p className="revibe-label mb-1 text-[9px]">Notes (optional)</p>
                    <input
                      type="text"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Why is this correction wrong? (Not shown to agent.)"
                      className="revibe-focus w-full rounded-[var(--revibe-radius)] border px-2 py-1.5 text-[12px] outline-none"
                      style={{ borderColor: "var(--revibe-border-input)" }}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {pending ? (
                    <>
                      <button
                        type="button"
                        onClick={() => apply(review, pending)}
                        disabled={busyId === review.id || (pending === "correct" && !correctionText.trim())}
                        className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] transition-opacity disabled:opacity-40"
                        style={{ background: "var(--revibe-ink)", color: "#fff" }}
                      >
                        {busyId === review.id ? "…" : `Confirm ${pending}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingAction(null);
                          setCorrectionText("");
                          setNotes("");
                        }}
                        disabled={busyId === review.id}
                        className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-3 py-1.5 text-[11px]"
                        style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => apply(review, "approve")}
                        disabled={busyId === review.id}
                        className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] transition-opacity disabled:opacity-40"
                        style={{ background: "var(--revibe-ink)", color: "#fff" }}
                        title="Use the agent's correction verbatim as a new NEWL reference"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingAction({ id: review.id, action: "correct" });
                          setCorrectionText(review.submitted_correction);
                        }}
                        disabled={busyId === review.id}
                        className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-3 py-1.5 text-[11px]"
                        style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
                        title="Rewrite the correction before teaching it"
                      >
                        Correct
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction({ id: review.id, action: "invalid" })}
                        disabled={busyId === review.id}
                        className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-3 py-1.5 text-[11px]"
                        style={{ borderColor: "var(--revibe-error)", color: "var(--revibe-error)" }}
                        title="Reject the correction; nothing gets taught"
                      >
                        Invalid
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
