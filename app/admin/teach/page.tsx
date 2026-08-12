import { redirect } from "next/navigation";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { TeachChat } from "@/components/TeachChat";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teach the AI · Revibe Knowledge Base" };

export default async function TeachPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.role !== "admin" && user.role !== "owner") redirect("/ask");

  const missing = missingEnv();
  if (missing.length > 0) {
    return (
      <div
        className="rounded-[var(--revibe-radius)] border px-3 py-2.5 text-[12px]"
        style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-info-bg)" }}
      >
        {configErrorMessage(missing)}
      </div>
    );
  }

  return <TeachChat />;
}
