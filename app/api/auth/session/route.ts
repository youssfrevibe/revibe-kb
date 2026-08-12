import { NextRequest } from "next/server";
import { createSession, getUser, sessionCookieName, clearSessionCookieHeader } from "@/lib/auth";
import { verifyRevibeToken } from "@/lib/firebase-admin";

export const runtime = "nodejs";

/**
 * Exchange a fresh Firebase ID token for an httpOnly session cookie.
 *
 * The client signs in with Firebase (Google or email/password), gets an ID
 * token, then calls this endpoint. The server verifies the token, enforces
 * @revibe.me, upserts the user record in Firestore, and mints a session
 * cookie so subsequent requests are cheap (verifySessionCookie is much
 * faster than round-tripping to Firebase for every ID-token check).
 */
export async function POST(request: NextRequest) {
  let body: { idToken?: unknown };
  try {
    body = (await request.json()) as { idToken?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) return Response.json({ error: "idToken is required" }, { status: 400 });

  try {
    const { cookie, maxAge } = await createSession(idToken);
    // Peek at the fresh Firestore record so the client can route to
    // /onboarding directly if this is the user's first sign-in.
    const decoded = await verifyRevibeToken(idToken);
    const user = await getUser(decoded.uid);
    const needsOnboarding = !user?.team;

    const setCookie = [
      `${sessionCookieName()}=${cookie}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${maxAge}`,
    ].join("; ");
    return new Response(JSON.stringify({ ok: true, needsOnboarding }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": setCookie },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // 403 (not 401) because the failure is "you're authenticated by Firebase
    // but not authorized for Revibe" — @revibe.me gate.
    return Response.json({ error: detail }, { status: 403 });
  }
}

/** Sign-out: clear the cookie. Firebase client also calls signOut() locally. */
export async function DELETE() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookieHeader() },
  });
}
