import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { missingEnv, configErrorMessage } from "@/lib/config";

export const runtime = "nodejs";

/**
 * List feedback reviews. Admin + Owner only.
 *
 * Default: pending items, newest first. Pass ?status=approved|corrected|invalid
 * to see the audit history for a particular disposition.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const status = request.nextUrl.searchParams.get("status") ?? "pending";
  const validStatuses = ["pending", "approved", "corrected", "invalid"];
  if (!validStatuses.includes(status)) {
    return Response.json({ error: `status must be one of: ${validStatuses.join(", ")}` }, { status: 400 });
  }

  const supabase = db();
  const { data, error } = await supabase
    .from("feedback_reviews")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ reviews: data ?? [] });
}
