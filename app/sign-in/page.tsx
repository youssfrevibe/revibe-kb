"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { signInWithGoogle, signInWithEmail, signUpWithEmail, watchAuth } from "@/lib/firebase-client";

type Mode = "signin" | "signup";

function SignInInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/ask";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadySignedIn, setAlreadySignedIn] = useState(false);

  useEffect(() => {
    // If Firebase says we're already signed in, but we haven't minted the
    // server session yet, sitting on this page is useless — kick straight to
    // the destination.
    const unsub = watchAuth(async (fbUser) => {
      if (fbUser) setAlreadySignedIn(true);
    });
    return unsub;
  }, []);

  async function exchangeToken(idToken: string) {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    if (!response.ok) throw new Error(payload.error ?? "Sign-in rejected");
    // First-time users get sent to the team-picker before their destination.
    router.replace(payload.needsOnboarding ? "/onboarding" : next);
  }

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      const { idToken } = await signInWithGoogle();
      await exchangeToken(idToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { idToken } =
        mode === "signup"
          ? await signUpWithEmail(email, password, displayName || undefined)
          : await signInWithEmail(email, password);
      await exchangeToken(idToken);
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
      <p className="revibe-label mb-6 text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
        Knowledge Base
      </p>

      <div
        className="w-full rounded-[var(--revibe-radius)] border p-6"
        style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
      >
        <h1 className="revibe-label mb-1 text-[14px]">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="mb-5 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
          Restricted to <strong>@revibe.me</strong> accounts.
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="revibe-label revibe-focus mb-4 flex w-full items-center justify-center gap-2 rounded-[var(--revibe-radius)] border px-3 py-2.5 text-[12px] transition-opacity disabled:opacity-40"
          style={{
            background: "var(--revibe-surface)",
            borderColor: "var(--revibe-border)",
            color: "var(--revibe-ink)",
          }}
        >
          {/* Google G. Inline SVG so no external asset request under CSP. */}
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-2 text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
          <span className="h-px flex-1" style={{ background: "var(--revibe-border)" }} />
          OR
          <span className="h-px flex-1" style={{ background: "var(--revibe-border)" }} />
        </div>

        <form onSubmit={handleEmail} className="flex flex-col gap-2">
          {mode === "signup" ? (
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Full name"
              autoComplete="name"
              className="revibe-focus rounded-[var(--revibe-radius)] border px-3 py-2 text-[13px] outline-none"
              style={{
                borderColor: "var(--revibe-border-input)",
                background: "var(--revibe-surface)",
                color: "var(--revibe-ink)",
              }}
            />
          ) : null}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@revibe.me"
            autoComplete={mode === "signup" ? "email" : "username"}
            required
            className="revibe-focus rounded-[var(--revibe-radius)] border px-3 py-2 text-[13px] outline-none"
            style={{
              borderColor: "var(--revibe-border-input)",
              background: "var(--revibe-surface)",
              color: "var(--revibe-ink)",
            }}
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={6}
            required
            className="revibe-focus rounded-[var(--revibe-radius)] border px-3 py-2 text-[13px] outline-none"
            style={{
              borderColor: "var(--revibe-border-input)",
              background: "var(--revibe-surface)",
              color: "var(--revibe-ink)",
            }}
          />
          <button
            type="submit"
            disabled={busy}
            className="revibe-label revibe-focus mt-1 rounded-[var(--revibe-radius)] px-3 py-2.5 text-[12px] transition-opacity disabled:opacity-40"
            style={{ background: "var(--revibe-ink)", color: "#fff" }}
          >
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="revibe-focus mt-4 w-full text-[11px]"
          style={{ color: "var(--revibe-ink-muted)" }}
        >
          {mode === "signin" ? "New here? Create an account →" : "Already have an account? Sign in →"}
        </button>

        {error ? (
          <div
            className="mt-4 rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
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
      </div>

      {alreadySignedIn ? (
        <p className="mt-4 text-[11px]" style={{ color: "var(--revibe-ink-faint)" }}>
          You appear to still be signed in with Firebase — completing the session…
        </p>
      ) : null}
    </div>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
