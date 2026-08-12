import { NextRequest, NextResponse } from "next/server";

/**
 * Route protection.
 *
 * The session cookie is httpOnly, so the middleware only checks for its
 * presence — the actual verification happens in each route via
 * `currentUser()`. Presence alone is enough to send an unauthenticated user
 * back to /sign-in instead of showing a broken page.
 *
 * Middleware runs on the Edge Runtime by default. That runtime does NOT have
 * `firebase-admin` (it uses Node crypto features Edge doesn't expose), so we
 * deliberately do NOT verify the cookie here. Trust the presence check for
 * routing, defer real verification to the Node-runtime route handlers.
 */

const SESSION_COOKIE = "revibe_session";

// Paths that ARE the sign-in flow itself — never bounce them.
const PUBLIC_PATHS = ["/sign-in", "/api/auth/session"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  // Next internals + static assets.
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/api/health")) return true;
  if (pathname === "/icon.png" || pathname === "/apple-icon.png") return true;
  if (pathname === "/favicon.ico" || pathname === "/revibe-logo.svg") return true;
  return false;
}

// Next 16 renamed `middleware` → `proxy`. The exported function name and
// filename must both be `proxy`. Same runtime semantics as before.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    // For API routes return JSON, for pages redirect.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({ error: "Not signed in" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except the static file exceptions handled inside isPublic.
    "/((?!_next/static|_next/image).*)",
  ],
};
