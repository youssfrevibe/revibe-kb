/**
 * Server-side user model, backed by Firestore.
 *
 * Firestore holds the authoritative user record. This module wraps it so API
 * routes can call `currentUser(request)` and get back { uid, email, role, team }
 * without every route needing to know the collection shape.
 *
 * On first sign-in the owner (youssf.rehem@revibe.me) is auto-promoted to
 * role='owner'. Everyone else defaults to role='member' until an owner
 * promotes them.
 */
import "server-only";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminFirestore, verifyRevibeToken } from "./firebase-admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Enums live in auth-shared.ts so client components can import them without
// pulling in firebase-admin.
export { TEAMS, TEAM_LABEL, ROLES, type Team, type Role } from "./auth-shared";
import type { Team, Role } from "./auth-shared";

export type UserRecord = {
  uid: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  team: Team | null;
  role: Role;
  createdAt: string | null;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
};

// ---------------------------------------------------------------------------
// Firestore access
// ---------------------------------------------------------------------------

const OWNER_EMAIL = "youssf.rehem@revibe.me";

function usersCollection() {
  return adminFirestore().collection("users");
}

function toRecord(uid: string, data: FirebaseFirestore.DocumentData): UserRecord {
  return {
    uid,
    email: (data.email as string) ?? "",
    displayName: (data.displayName as string | undefined) ?? null,
    photoUrl: (data.photoUrl as string | undefined) ?? null,
    team: (data.team as Team | undefined) ?? null,
    role: (data.role as Role | undefined) ?? "member",
    createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
    lastSignInAt: data.lastSignInAt?.toDate?.().toISOString?.() ?? null,
    lastActiveAt: data.lastActiveAt?.toDate?.().toISOString?.() ?? null,
  };
}

export async function getUser(uid: string): Promise<UserRecord | null> {
  const snap = await usersCollection().doc(uid).get();
  if (!snap.exists) return null;
  return toRecord(uid, snap.data()!);
}

/**
 * Upsert the user record on sign-in.
 *
 * - Creates the doc on first sign-in.
 * - youssf.rehem@revibe.me is auto-promoted to owner if their role isn't set.
 * - Never demotes an existing owner or admin — role changes are for the
 *   promote/demote endpoints.
 * - Never overwrites `team` — that's set once during the onboarding MCQ.
 */
export async function upsertOnSignIn(args: {
  uid: string;
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
}): Promise<UserRecord> {
  const ref = usersCollection().doc(args.uid);
  const snap = await ref.get();

  const isOwnerEmail = args.email.toLowerCase() === OWNER_EMAIL;

  if (!snap.exists) {
    // First sign-in.
    await ref.set({
      email: args.email,
      displayName: args.displayName ?? null,
      photoUrl: args.photoUrl ?? null,
      role: isOwnerEmail ? "owner" : "member",
      team: null,
      createdAt: FieldValue.serverTimestamp(),
      lastSignInAt: FieldValue.serverTimestamp(),
      lastActiveAt: FieldValue.serverTimestamp(),
    });
  } else {
    const data = snap.data()!;
    const updates: Record<string, unknown> = {
      lastSignInAt: FieldValue.serverTimestamp(),
    };
    // Auto-promote the owner if their role was somehow set to something else.
    // This means the Owner can never be locked out — a fresh sign-in restores
    // their privileges.
    if (isOwnerEmail && data.role !== "owner") {
      updates.role = "owner";
    }
    // Keep the profile fresh — some display names change (Google can revise
    // their user's displayName, users can update it).
    if (args.displayName && args.displayName !== data.displayName) updates.displayName = args.displayName;
    if (args.photoUrl && args.photoUrl !== data.photoUrl) updates.photoUrl = args.photoUrl;
    await ref.update(updates);
  }

  const fresh = await ref.get();
  return toRecord(args.uid, fresh.data()!);
}

export async function setTeam(uid: string, team: Team): Promise<void> {
  await usersCollection().doc(uid).update({ team });
}

/**
 * Change a user's role. Owner can promote/demote members ↔ admins.
 * The Owner can never be demoted; enforced here so callers can't do it by
 * mistake even if they route around the UI.
 */
export async function setRole(actor: UserRecord, targetUid: string, role: Role): Promise<void> {
  if (actor.role !== "owner") {
    throw new Error("Only the Owner can change roles.");
  }
  if (role === "owner") {
    throw new Error("The Owner role is not transferable through this endpoint.");
  }
  const target = await getUser(targetUid);
  if (!target) throw new Error("User not found.");
  if (target.role === "owner") {
    throw new Error("The Owner cannot be demoted.");
  }
  if (target.email.toLowerCase() === OWNER_EMAIL) {
    throw new Error("The Owner cannot be demoted.");
  }
  await usersCollection().doc(targetUid).update({ role });
}

export async function listUsers(): Promise<UserRecord[]> {
  const snap = await usersCollection().orderBy("email").get();
  return snap.docs.map((doc) => toRecord(doc.id, doc.data()));
}

// ---------------------------------------------------------------------------
// Request auth
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "revibe_session";
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

/**
 * Read the current signed-in user from the request cookie.
 * Returns null when there's no session (unauthenticated) — routes decide
 * whether that's an error or a redirect.
 */
export async function currentUser(request?: NextRequest): Promise<UserRecord | null> {
  const cookieValue = request
    ? request.cookies.get(SESSION_COOKIE)?.value
    : (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookieValue) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(cookieValue, true);
    if (!decoded.email || !/^[^\s@]+@revibe\.me$/i.test(decoded.email)) return null;
    const user = await getUser(decoded.uid);
    if (user) {
      const now = new Date();
      const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt) : null;
      if (!lastActive || now.getTime() - lastActive.getTime() > 2 * 60 * 1000) {
        usersCollection().doc(decoded.uid).update({
          lastActiveAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
        user.lastActiveAt = now.toISOString();
      }
    }
    return user;
  } catch {
    return null;
  }
}

/** Mint a session cookie from a Firebase ID token. Called by /api/auth/session. */
export async function createSession(idToken: string): Promise<{ cookie: string; maxAge: number }> {
  // verifyRevibeToken enforces the @revibe.me gate BEFORE the session is minted.
  const decoded = await verifyRevibeToken(idToken);
  await upsertOnSignIn({
    uid: decoded.uid,
    email: decoded.email!,
    displayName: (decoded.name as string | undefined) ?? null,
    photoUrl: (decoded.picture as string | undefined) ?? null,
  });
  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
  return { cookie, maxAge: SESSION_MAX_AGE_MS / 1000 };
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

/** Set-Cookie value for clearing the session (used on sign-out). */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
