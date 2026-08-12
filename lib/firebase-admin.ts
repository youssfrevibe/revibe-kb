/**
 * Server-side Firebase: token verification and Firestore.
 *
 * Never import this from a client component. Both the Admin SDK and the
 * service-account credentials must stay server-only. Env var name is
 * FIREBASE_ADMIN_SERVICE_ACCOUNT (unprefixed), so Next never bundles it
 * into the browser.
 *
 * Accepts the service account JSON in two shapes:
 *   1. Raw JSON in a single line (works fine for FIREBASE_ADMIN_SERVICE_ACCOUNT="{...}")
 *   2. Base64-encoded JSON (useful when a hosting provider mangles newlines
 *      inside the private_key field — Vercel used to do this)
 */
import { getApps, initializeApp, cert, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | null = null;

function parseServiceAccount(raw: string): ServiceAccount {
  let trimmed = raw.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    trimmed = trimmed.slice(1, -1);
  }
  const json = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(json) as Record<string, string>;
  // Handle the classic "\n → literal \n" gotcha in copy-pasted keys.
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

function adminApp(): App {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0]!;
    return app;
  }
  const creds = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!creds) {
    throw new Error(
      "FIREBASE_ADMIN_SERVICE_ACCOUNT is not set. Generate a service-account key from Firebase Console → Project settings → Service accounts → Generate new private key, paste the JSON into .env.local.",
    );
  }
  app = initializeApp({ credential: cert(parseServiceAccount(creds)) });
  return app;
}

export function adminAuth() {
  return getAuth(adminApp());
}

export function adminFirestore(): Firestore {
  return getFirestore(adminApp());
}

/**
 * Verify a Firebase ID token and enforce the @revibe.me domain restriction.
 *
 * This is the ONLY place the domain check happens on the server. Every route
 * that needs an authenticated user goes through here (via lib/auth.ts).
 * Firebase itself has no email-domain restriction for Google OAuth, so this
 * gate is what makes the sign-up flow safe.
 */
export async function verifyRevibeToken(idToken: string): Promise<DecodedIdToken> {
  const decoded = await adminAuth().verifyIdToken(idToken, true);
  if (!decoded.email || !/^[^\s@]+@revibe\.me$/i.test(decoded.email)) {
    throw new Error("Only @revibe.me accounts can sign in.");
  }
  return decoded;
}
