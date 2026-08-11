"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";

const NAV = [
  { href: "/ask", label: "Ask" },
  { href: "/threads", label: "Threads" },
];

/**
 * App shell. Reads `?embed=1` and drops the outer chrome when set, which is how
 * this mounts inside revibe.training.hub without two sets of navigation stacked
 * on top of each other.
 *
 * A layout can't read search params in the App Router, so this lives in a client
 * component wrapped in Suspense by the layout.
 */
export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const embedded = useSearchParams().get("embed") === "1";

  if (embedded) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-4">{children}</div>;
  }

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
            Knowledge Base
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
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
