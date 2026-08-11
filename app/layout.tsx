import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { Suspense } from "react";
import { Chrome } from "@/components/Chrome";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={montserrat.className}>
      <body>
        <Suspense fallback={null}>
          <Chrome>{children}</Chrome>
        </Suspense>
      </body>
    </html>
  );
}
