import { NextRequest } from "next/server";
import { currentUser, listUsers } from "@/lib/auth";

export const runtime = "nodejs";

/** List every user. Admin + Owner. */
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const users = await listUsers();
    return Response.json({ users });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ error: detail }, { status: 500 });
  }
}
