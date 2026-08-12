import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function FeedbackReviewPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.role !== "admin" && user.role !== "owner") {
    redirect("/ask");
  }

  redirect("/admin?tab=feedback");
}
