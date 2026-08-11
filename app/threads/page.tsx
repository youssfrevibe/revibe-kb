import { ThreadSearch } from "@/components/ThreadSearch";

export const metadata = { title: "Previous Chats · Revibe Knowledge Base" };

export default function ThreadsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="revibe-label text-[13px]">Previous Chats</h1>
        <p className="mt-1 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
          Every past conversation, searchable. Open one to see the answer and the sources it used.
        </p>
      </div>
      <ThreadSearch />
    </div>
  );
}
