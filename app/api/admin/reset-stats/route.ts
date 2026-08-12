import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "owner") return Response.json({ error: "Owner only" }, { status: 403 });

  const supabase = db();

  const { error } = await supabase
    .from("messages")
    .update({ feedback_rating: null })
    .not("feedback_rating", "is", null);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
