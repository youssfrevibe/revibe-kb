import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { Suspense } from "react";
import { Chrome } from "@/components/Chrome";
import { currentUser } from "@/lib/auth";
import "./globals.css";

// Montserrat is Revibe's brand face. next/font self-hosts it at build time, so
// there's no runtime request to Google and no CSP exception needed.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Revibe Knowledge Base",
  description: "Ask questions about Revibe's operations, policies, and support guidelines.",
  robots: { index: false, follow: false }, // internal tool
};

// The layout reads the current user from the session cookie and passes it to
// Chrome, so it MUST render per-request. Marking dynamic here also stops Next
// from trying to statically prerender pages that would otherwise crash the
// build worker while firebase-admin's native modules initialise inside the
// SSG process.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the current user server-side so the header renders with role +
  // display name on the first paint, no client flicker. When there is no
  // session (unauthenticated visit to /sign-in), null is fine — Chrome hides
  // the user block.
  let user = null;
  try {
    const record = await currentUser();
    if (record) {
      user = { email: record.email, displayName: record.displayName, role: record.role };
    }
  } catch {
    // Config missing (Firebase env vars not filled yet) — still render the
    // shell so /sign-in works.
  }

  return (
    <html lang="en" className={montserrat.className}>
      <body>
        <Suspense fallback={null}>
          <Chrome user={user}>{children}</Chrome>
        </Suspense>
      </body>
    </html>
  );
}
