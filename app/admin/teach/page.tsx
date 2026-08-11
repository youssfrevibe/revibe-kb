import { missingEnv, configErrorMessage } from "@/lib/config";
import { TeachChat } from "@/components/TeachChat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teach the AI · Revibe Knowledge Base" };

export default function TeachPage() {
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
