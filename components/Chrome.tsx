"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { signOut as fbSignOut } from "@/lib/firebase-client";

const NAV = [
  { href: "/ask", label: "Ask" },
  { href: "/threads", label: "Previous Chats" },
  { href: "/sources", label: "Sources" },
];

// Routes that must render without the outer chrome — the sign-in and
// onboarding flows are their own full-screen experiences and would look
// silly wrapped in the app's header nav.
const CHROMELESS_PATHS = ["/sign-in", "/onboarding"];

/**
 * App shell. Reads `?embed=1` and drops the outer chrome when set, which is how
 * this mounts inside revibe.training.hub without two sets of navigation stacked
 * on top of each other.
 *
 * A layout can't read search params in the App Router, so this lives in a client
 * component wrapped in Suspense by the layout.
 */
type UserSummary = {
  email: string;
  displayName: string | null;
  role: "owner" | "admin" | "member";
};

export function Chrome({
  children,
  user,
}: {
  children: React.ReactNode;
  user: UserSummary | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const embedded = useSearchParams().get("embed") === "1";
  const [signingOut, setSigningOut] = useState(false);

  if (embedded || CHROMELESS_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"))) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-4">{children}</div>;
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      await fbSignOut();
    } finally {
      router.replace("/sign-in");
    }
  }

  const showAdminLink = user?.role === "owner" || user?.role === "admin";

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-[var(--revibe-surface)]" style={{ borderColor: "var(--revibe-border)" }}>
        <div className="mx-auto flex w-full max-w-5xl items-center gap-6 px-4 py-3">
          <Link href="/ask" className="revibe-focus flex items-center gap-3">
            <Image src="/revibe-logo.svg" alt="Revibe" width={104} height={22} priority />
            <span className="sr-only">Revibe Knowledge Base</span>
          </Link>

          <span
            className="revibe-label hidden text-[11px] sm:block"
            style={{ color: "var(--revibe-ink-muted)" }}
          >
            Knowledge Base v0.7
          </span>

          <nav className="ml-auto flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[12px] transition-colors"
                  style={{
                    background: active ? "var(--revibe-ink)" : "transparent",
                    color: active ? "#fff" : "var(--revibe-ink)",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
            {showAdminLink ? (
              <Link
                href="/admin"
                aria-current={pathname.startsWith("/admin") ? "page" : undefined}
                className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-3 py-1.5 text-[12px] transition-colors"
                style={{
                  background: pathname.startsWith("/admin") ? "var(--revibe-ink)" : "transparent",
                  color: pathname.startsWith("/admin") ? "#fff" : "var(--revibe-ink)",
                }}
              >
                Admin
              </Link>
            ) : null}
          </nav>

          {user ? (
            <div className="ml-3 flex items-center gap-2 border-l pl-3" style={{ borderColor: "var(--revibe-border)" }}>
              <div className="flex flex-col items-end leading-tight">
                <span className="text-[11px]" style={{ color: "var(--revibe-ink)" }}>
                  {user.displayName || user.email}
                </span>
                <span
                  className="revibe-label text-[9px]"
                  style={{ color: user.role === "owner" ? "var(--revibe-accent)" : "var(--revibe-ink-faint)" }}
                >
                  {user.role}
                </span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-2 py-1 text-[10px] transition-opacity disabled:opacity-40"
                style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink-muted)" }}
              >
                {signingOut ? "…" : "Sign out"}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
