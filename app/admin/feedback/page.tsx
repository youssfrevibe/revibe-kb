import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { FeedbackReviewList } from "@/components/FeedbackReviewList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback review · Revibe Knowledge Base" };

export default async function FeedbackReviewPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.role !== "admin" && user.role !== "owner") {
    // Non-admin roles land here from a stale link — bounce them somewhere
    // useful rather than showing a 403 page.
    redirect("/ask");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="revibe-label text-[13px]">Feedback review queue</h1>
        <p className="mt-1 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
          Corrections submitted by agents. Approve to teach the agent&apos;s version, Correct to rewrite
          it first, Invalid to reject. Approve or Correct creates a new ALH reference thread that
          affects future answers immediately.
        </p>
      </div>
      <FeedbackReviewList />
    </div>
  );
}
