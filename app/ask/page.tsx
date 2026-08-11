import { Chat } from "@/components/Chat";

export const metadata = { title: "Ask · Revibe Knowledge Base" };

export default function AskPage() {
  // A new conversation. The first answer creates the thread and swaps the URL to
  // /t/[slug] without a navigation, so the page is shareable straight away.
  return <Chat />;
}
