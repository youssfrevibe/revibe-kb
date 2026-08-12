"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { TEAMS, TEAM_LABEL, type Team } from "@/lib/auth-shared";

export function OnboardingForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!team) {
      setError("Pick a team to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/me/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Save failed");
      router.replace("/ask");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-3">
        <Image src="/revibe-logo.svg" alt="Revibe" width={140} height={28} priority />
      </div>

      <div
        className="w-full rounded-[var(--revibe-radius)] border p-6"
        style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
      >
        <p className="mb-1 text-[13px]" style={{ color: "var(--revibe-ink-muted)" }}>
          Welcome, {displayName}.
        </p>
        <h1 className="revibe-label mb-4 text-[14px]">Which team are you from?</h1>

        <div className="flex flex-col gap-2">
          {TEAMS.map((code) => {
            const selected = team === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => setTeam(code)}
                aria-pressed={selected}
                className="revibe-focus flex items-center justify-between rounded-[var(--revibe-radius)] border px-3 py-2.5 text-left text-[13px] transition-colors"
                style={{
                  background: selected ? "var(--revibe-ink)" : "var(--revibe-surface)",
                  borderColor: selected ? "var(--revibe-ink)" : "var(--revibe-border)",
                  color: selected ? "#fff" : "var(--revibe-ink)",
                }}
              >
                <span>{TEAM_LABEL[code]}</span>
                {selected ? (
                  <span
                    aria-hidden
                    className="revibe-label text-[9px]"
                    style={{ color: "var(--revibe-accent)" }}
                  >
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {error ? (
          <div
            className="mt-3 rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
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

        <button
          type="button"
          onClick={submit}
          disabled={busy || !team}
          className="revibe-label revibe-focus mt-5 w-full rounded-[var(--revibe-radius)] px-3 py-2.5 text-[12px] transition-opacity disabled:opacity-40"
          style={{ background: "var(--revibe-ink)", color: "#fff" }}
        >
          {busy ? "Saving…" : "Continue"}
        </button>

        <p className="mt-4 text-[11px]" style={{ color: "var(--revibe-ink-faint)" }}>
          You can only pick your team once. If it changes, the Owner can update it for you.
        </p>
      </div>
    </div>
  );
}
