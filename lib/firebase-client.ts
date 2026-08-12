"use client";

/**
 * Client-side Firebase Auth + Firestore access.
 *
 * The values below are safe to bundle into the browser — they identify the
 * Firebase project so the SDK can call Google's OAuth flow. They do NOT grant
 * server access; that's what the Admin SDK on the server is for.
 *
 * Two sign-in methods are enabled:
 *  - Google (with an hd hint pointing at revibe.me)
 *  - Email + password (must be an @revibe.me address)
 *
 * Domain restriction to @revibe.me is enforced on the SERVER
 * (lib/firebase-admin.ts) because Firebase itself doesn't restrict email
 * domains — anyone with a Google account can complete the OAuth dance; we
 * reject non-@revibe.me tokens after verification.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onIdTokenChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

let app: FirebaseApp | null = null;

function firebaseApp(): FirebaseApp {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0];
    return app;
  }
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId || !cfg.appId) {
    throw new Error(
      "Firebase client env vars missing. Copy .env.local.example → .env.local and fill NEXT_PUBLIC_FIREBASE_* values.",
    );
  }
  app = initializeApp(cfg);
  return app;
}

export function auth() {
  return getAuth(firebaseApp());
}

export function firestore(): Firestore {
  return getFirestore(firebaseApp());
}

// Lazy-init the Google provider. Instantiating it at module top-level made
// SSR of any layout that imports this file crash with a 500 on Vercel — the
// Firebase Web SDK isn't intended to construct providers in a Node runtime,
// even though the "use client" annotation says the module is client-only.
// Next still evaluates the module during SSR for initial HTML, so any
// eager side effect here runs on the server.
let googleProvider: GoogleAuthProvider | null = null;
function getGoogleProvider(): GoogleAuthProvider {
  if (googleProvider) return googleProvider;
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ hd: "revibe.me", prompt: "select_account" });
  googleProvider = p;
  return p;
}

/** Every email sign-in / sign-up is checked here before hitting Firebase. */
function assertRevibeEmail(email: string): void {
  if (!/^[^\s@]+@revibe\.me$/i.test(email)) {
    throw new Error("Only @revibe.me email addresses can sign in.");
  }
}

/** Google sign-in. Returns the Firebase user + a fresh ID token. */
export async function signInWithGoogle(): Promise<{ user: FirebaseUser; idToken: string }> {
  const result = await signInWithPopup(auth(), getGoogleProvider());
  if (!result.user.email || !/^[^\s@]+@revibe\.me$/i.test(result.user.email)) {
    // Sign them straight back out — the server would reject the token anyway.
    await fbSignOut(auth());
    throw new Error("Only @revibe.me accounts can sign in. Please pick a different Google account.");
  }
  const idToken = await result.user.getIdToken(true);
  return { user: result.user, idToken };
}

/** Email/password sign-in. */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ user: FirebaseUser; idToken: string }> {
  assertRevibeEmail(email);
  const result = await signInWithEmailAndPassword(auth(), email, password);
  const idToken = await result.user.getIdToken(true);
  return { user: result.user, idToken };
}

/** Email/password sign-up. Sets the display name if provided. */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ user: FirebaseUser; idToken: string }> {
  assertRevibeEmail(email);
  const result = await createUserWithEmailAndPassword(auth(), email, password);
  if (displayName) {
    await updateProfile(result.user, { displayName });
  }
  const idToken = await result.user.getIdToken(true);
  return { user: result.user, idToken };
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth());
}

export function watchAuth(callback: (user: FirebaseUser | null) => void): () => void {
  return onIdTokenChanged(auth(), callback);
}

export type { FirebaseUser };
