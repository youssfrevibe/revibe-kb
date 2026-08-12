import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { OnboardingForm } from "@/components/OnboardingForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome · Revibe Knowledge Base" };

/**
 * First-time team pick. Only reachable while signed in and without a team.
 * If a user with a team ends up here (deep link, back button), send them on
 * to /ask. If nobody is signed in, the middleware already bounced them.
 */
export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.team) redirect("/ask");

  return <OnboardingForm displayName={user.displayName || user.email.split("@")[0]} />;
}
