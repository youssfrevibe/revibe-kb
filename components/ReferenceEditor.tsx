"use client";

import { useState } from "react";
import { MARKETS } from "@/lib/markets";
import type { SourceTag } from "@/lib/source-tags";

type Props = {
  threadSlug: string;
  messageId: string;
  initialContent: string;
  title: string;
  sourceTag: SourceTag;
  refNumber: number | null;
  market: string;
  editedAt: string | null;
  /** Whether to render the Edit button. Server route also enforces this. */
  canEdit: boolean;
};

/**
 * The editable reference card.
 *
 * Click "Edit" → the body becomes a textarea. Save → PATCH the message, which
 * re-embeds it server-side. The next retrieval that hits this reference sees
 * the updated wording — that's the whole point of the pivot.
 *
 * Only rendered on threads with a source_tag (SRC/ALH/MSTR). Q&A threads use
 * the regular <Chat> component; editing a past conversation is nonsense.
 */
export function ReferenceEditor({
  threadSlug,
  messageId,
  initialContent,
  title,
  sourceTag,
  refNumber,
  market,
  editedAt,
  canEdit,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [draft, setDraft] = useState(initialContent);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(editedAt);

  const refLabel = refNumber === null ? sourceTag : `${sourceTag}-${String(refNumber).padStart(4, "0")}`;
  const marketShort = market in MARKETS ? MARKETS[market as keyof typeof MARKETS].short : market;

  async function save() {
    const next = draft.trim();
    if (!next) {
      setError("Content cannot be empty");
      return;
    }
    if (next === content) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/threads/${threadSlug}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Save failed");

      setContent(next);
      setSavedAt(payload.editedAt as string);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(content);
    setError(null);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className="revibe-label rounded px-2 py-0.5 font-mono text-[10px] tabular-nums"
          style={{ background: "var(--revibe-ink)", color: "#fff" }}
        >
          {refLabel}
        </span>
        <h1 className="text-[15px] font-semibold" style={{ color: "var(--revibe-ink)" }}>
          {title.replace(/^(?:SRC|ALH|MSTR)-\d+ · /, "")}
        </h1>
        <span
          className="revibe-label rounded px-1.5 py-0.5 text-[10px]"
          style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-muted)" }}
        >
          {marketShort}
        </span>
        {savedAt ? (
          <span className="ml-auto text-[10px]" style={{ color: "var(--revibe-ink-faint)" }} suppressHydrationWarning>
            Edited {new Date(savedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {/* Reference body — the same accent-rail card the chat answer uses, but
          swappable into an editable textarea when Edit is clicked. */}
      <div
        className="relative overflow-hidden rounded-[var(--revibe-radius)] border p-5 pl-6"
        style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: "var(--revibe-accent)" }}
        />

        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={Math.max(6, Math.min(30, draft.split("\n").length + 2))}
              maxLength={20_000}
              aria-label="Reference content"
              className="revibe-focus w-full resize-y rounded-[var(--revibe-radius)] border p-3 font-mono text-[13px] leading-6 outline-none"
              style={{
                borderColor: "var(--revibe-border-input)",
                background: "var(--revibe-canvas)",
                color: "var(--revibe-ink)",
              }}
            />
            <p className="mt-2 text-[11px]" style={{ color: "var(--revibe-ink-faint)" }}>
              Saving re-embeds the reference. The next question that retrieves it will see the new wording.
            </p>
          </>
        ) : (
          <div
            className="answer text-[15px] leading-7"
            style={{ color: "var(--revibe-ink)" }}
          >
            {content}
          </div>
        )}
      </div>

      {error ? (
        <div
          className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
          style={{
            borderColor: "var(--revibe-error)",
            background: "var(--revibe-error-bg)",
            color: "var(--revibe-error)",
          }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-4 py-2 text-[12px] transition-opacity disabled:opacity-40"
              style={{ background: "var(--revibe-ink)", color: "#fff" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-4 py-2 text-[12px]"
              style={{
                background: "var(--revibe-surface)",
                borderColor: "var(--revibe-border)",
                color: "var(--revibe-ink)",
              }}
            >
              Cancel
            </button>
          </>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-4 py-2 text-[12px]"
            style={{
              background: "var(--revibe-surface)",
              borderColor: "var(--revibe-border)",
              color: "var(--revibe-ink)",
            }}
          >
            Edit
          </button>
        ) : (
          <span className="revibe-label text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
            Only admins can edit references.
          </span>
        )}
      </div>
    </div>
  );
}
