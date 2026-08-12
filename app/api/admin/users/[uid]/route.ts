import { NextRequest } from "next/server";
import { currentUser, setRole } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/auth-shared";

export const runtime = "nodejs";

/**
 * Promote or demote a user.
 *
 * PATCH /api/admin/users/[uid]
 * body: { role: 'admin' | 'member' }
 *
 * Owner-only. Owner cannot be demoted (enforced in setRole). Owner role cannot
 * be granted through this endpoint — that would require code changes.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ uid: string }> },
) {
  const { uid } = await context.params;

  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }

  let body: { role?: unknown };
  try {
    body = (await request.json()) as { role?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const role = body.role as Role;
  if (!ROLES.includes(role)) {
    return Response.json({ error: `role must be one of: ${ROLES.join(", ")}` }, { status: 400 });
  }
  if (role === "owner") {
    return Response.json({ error: "Owner cannot be granted through this endpoint" }, { status: 400 });
  }

  try {
    await setRole(user, uid, role);
    return Response.json({ ok: true, uid, role });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ error: detail }, { status: 400 });
  }
}
