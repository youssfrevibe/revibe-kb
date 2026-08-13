"use client";

import { useEffect, useState } from "react";

/**
 * Admin ▸ KB AI Brain — live editor for the tunable body of the master system
 * prompt. Owner edits and saves; the change is picked up by the chat route
 * within ~30s (cache TTL) with no redeploy.
 *
 * What this edits is only the middle of the prompt. The fixed persona, the
 * dynamic market/date context, and the non-negotiable guardrails are wrapped
 * around it in code (lib/prompt.ts) and cannot be removed here.
 */

type VersionRow = {
  id: number;
  body: string;
  updated_by: string | null;
  note: string | null;
  created_at: string;
};

type LoadState = {
  body: string;
  isCustom: boolean;
  default: string;
  updatedBy: string | null;
  updatedAt: string | null;
  canEdit: boolean;
  versions: VersionRow[];
};

const GUARDRAILS = [
  "Never invents or alters values (SLAs, fees, warranty windows, phone/email/URL)",
  "\"SA\" = Saudi Arabia, never South Africa (ZA); no market bleed",
  "No backend/tool talk — the assistant has no tools to call",
  "No customer-support contact steps; no auto sources list",
];

export function AiBrainPanel() {
  const [state, setState] = useState<LoadState | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-prompt");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to load");
      setState(payload as LoadState);
      setDraft((payload as LoadState).body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!state?.canEdit) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/ai-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Save failed");
      setOk("Saved. Live for new questions within ~30 seconds.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  const dirty = state ? draft !== state.body : false;
  const isDefaultInEditor = state ? draft.trim() === state.default.trim() : false;

  if (loading) {
    return (
      <p className="text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
        Loading the master prompt…
      </p>
    );
  }

  if (error && !state) {
    return (
      <div
        className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
        style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="revibe-label text-[12px]">KB AI Brain — Master Prompt</h2>
          <p className="mt-1 max-w-[640px] text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
            The editable core of the assistant&apos;s instructions. Saves apply to new
            questions within ~30 seconds — no redeploy. The persona, per-market
            context, and the guardrails below are enforced in code and wrap this
            text automatically.
          </p>
        </div>
        <span
          className="revibe-label rounded px-2 py-1 text-[10px]"
          style={{
            background: state?.isCustom ? "var(--revibe-accent)" : "var(--revibe-surface)",
            color: state?.isCustom ? "#fff" : "var(--revibe-ink-muted)",
            border: state?.isCustom ? "none" : "1px solid var(--revibe-border)",
          }}
        >
          {state?.isCustom ? "Custom" : "Code default"}
        </span>
      </div>

      {/* Locked guardrails note */}
      <div
        className="rounded-[var(--revibe-radius)] border px-3 py-2.5 text-[11px]"
        style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
      >
        <span className="revibe-label text-[10px]" style={{ color: "var(--revibe-ink-muted)" }}>
          🔒 Always enforced (not editable here)
        </span>
        <ul className="mt-1.5 flex flex-col gap-1" style={{ color: "var(--revibe-ink)" }}>
          {GUARDRAILS.map((g) => (
            <li key={g} className="flex gap-1.5">
              <span style={{ color: "var(--revibe-ink-faint)" }}>·</span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
      </div>

      {!state?.canEdit ? (
        <div
          className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-info-bg)", color: "var(--revibe-ink)" }}
        >
          View only — the master prompt can be edited by the Owner.
        </div>
      ) : null}

      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOk(null);
        }}
        readOnly={!state?.canEdit}
        spellCheck={false}
        rows={22}
        className="w-full rounded-[var(--revibe-radius)] border p-3 font-mono text-[12px] leading-relaxed"
        style={{
          borderColor: dirty ? "var(--revibe-accent)" : "var(--revibe-border)",
          background: "var(--revibe-bg)",
          color: "var(--revibe-ink)",
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {state?.canEdit ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] font-semibold transition-opacity disabled:opacity-40"
              style={{ background: "var(--revibe-ink)", color: "#fff" }}
            >
              {saving ? "Saving…" : "Save prompt"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (state) setDraft(state.default);
                setOk(null);
              }}
              disabled={isDefaultInEditor}
              title="Load the built-in default into the editor (review, then Save to apply)"
              className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-gray-50 disabled:opacity-40"
              style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
            >
              Restore default
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={() => {
                  if (state) setDraft(state.body);
                  setOk(null);
                }}
                className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] transition-colors hover:underline"
                style={{ color: "var(--revibe-ink-muted)" }}
              >
                Discard changes
              </button>
            ) : null}
          </>
        ) : null}

        {state && state.versions.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowVersions((v) => !v)}
            className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] transition-colors hover:underline"
            style={{ color: "var(--revibe-ink-muted)" }}
          >
            {showVersions ? "Hide history" : `History (${state.versions.length})`}
          </button>
        ) : null}

        <span className="ml-auto text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
          {state?.updatedAt
            ? `Last saved ${new Date(state.updatedAt).toLocaleString()}${state.updatedBy ? ` · ${state.updatedBy}` : ""}`
            : "No custom version saved yet"}
        </span>
      </div>

      {ok ? (
        <div
          className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-info-bg)", color: "var(--revibe-ink)" }}
          role="status"
        >
          {ok}
        </div>
      ) : null}
      {error && state ? (
        <div
          className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {showVersions && state ? (
        <div className="flex flex-col gap-2">
          {state.versions.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--revibe-radius)] border px-3 py-2 text-[11px]"
              style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
            >
              <span style={{ color: "var(--revibe-ink)" }}>
                {new Date(v.created_at).toLocaleString()}
                {v.updated_by ? ` · ${v.updated_by}` : ""}
                {v.note ? ` · ${v.note}` : ""}
              </span>
              {state.canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(v.body);
                    setShowVersions(false);
                    setOk(null);
                  }}
                  title="Load this version into the editor (review, then Save to apply)"
                  className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-gray-50"
                  style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
                >
                  Load into editor
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
