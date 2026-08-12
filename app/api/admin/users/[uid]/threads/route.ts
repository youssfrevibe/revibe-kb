import { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Fetch all support/Q&A threads created by a specific user.
 *
 * GET /api/admin/users/[uid]/threads
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ uid: string }> },
) {
  const { uid } = await context.params;

  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const supabase = db();
  const { data, error } = await supabase
    .from("threads")
    .select("id, title, market, tags, updated_at, slug")
    .eq("user_uid", uid)
    .is("source_tag", null)
    .order("updated_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ threads: data || [] });
}
