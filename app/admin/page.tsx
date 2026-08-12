import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { AdminDashboard } from "@/components/AdminDashboard";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Indexed material · Revibe Knowledge Base" };

type DBMessage = {
  id: string;
  content: string;
  feedback_rating: "good" | "bad";
  feedback_correction: string | null;
  created_at: string;
  thread_id: string;
  threads: {
    slug: string;
    market: string;
  } | null;
};

type DBThread = {
  id: string;
  title: string | null;
  market: string;
  tags: string[] | null;
  updated_at: string;
  slug: string;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const initialTab = params.tab || "catalog";

  // Role gate: admin + owner only. Members hitting this URL (from a stale
  // link or a bookmark) get sent back to /ask rather than a raw 403.
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

  const supabase = db();

  // 1. Fetch Source Documents Catalog
  const { data: rawDocs, error: docsError } = await supabase
    .from("documents")
    .select("title, source_path, source_type, market, updated_at, chunks(count)")
    .order("market", { ascending: true })
    .order("source_path", { ascending: true });

  if (docsError) {
    return (
      <div
        className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
        style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
      >
        Failed to load catalog: {docsError.message}
      </div>
    );
  }

  const documents = (rawDocs ?? []).map((row) => {
    const counts = row.chunks as unknown as { count: number }[] | null;
    return {
      title: row.title as string,
      sourcePath: row.source_path as string,
      sourceType: row.source_type as string,
      market: row.market as string,
      updatedAt: row.updated_at as string,
      chunkCount: counts?.[0]?.count ?? 0,
    };
  });

  // 2. Fetch Feedback Logs (Good & Bad votes)
  const { data: rawMessages, error: msgError } = await supabase
    .from("messages")
    .select("id, content, feedback_rating, feedback_correction, created_at, thread_id, threads!inner(slug, market)")
    .not("feedback_rating", "is", null)
    .order("created_at", { ascending: false });

  let feedbackLogs: any[] = [];
  const totalVotes = { good: 0, bad: 0 };

  if (!msgError && rawMessages) {
    const dbMessages = rawMessages as unknown as DBMessage[];
    dbMessages.forEach((msg) => {
      if (msg.feedback_rating === "good") totalVotes.good++;
      if (msg.feedback_rating === "bad") totalVotes.bad++;
    });

    const threadIds = Array.from(new Set(dbMessages.map((m) => m.thread_id)));
    
    // Fetch all user messages in these threads to map user questions to assistant answers
    let questionsMap = new Map<string, { content: string; created_at: string }[]>();
    if (threadIds.length > 0) {
      const { data: threadMsgs } = await supabase
        .from("messages")
        .select("thread_id, role, content, created_at")
        .in("thread_id", threadIds)
        .eq("role", "user")
        .order("created_at", { ascending: true });

      (threadMsgs ?? []).forEach((m) => {
        const list = questionsMap.get(m.thread_id) ?? [];
        list.push({ content: m.content as string, created_at: m.created_at as string });
        questionsMap.set(m.thread_id, list);
      });
    }

    feedbackLogs = dbMessages.map((msg) => {
      // Find the closest user question asked prior to this assistant message
      const list = questionsMap.get(msg.thread_id) ?? [];
      const priorUserQuestion = list
        .filter((q) => q.created_at < msg.created_at)
        .pop();

      return {
        id: msg.id,
        content: msg.content,
        feedbackRating: msg.feedback_rating,
        feedbackCorrection: msg.feedback_correction,
        createdAt: msg.created_at,
        question: priorUserQuestion?.content ?? "Original Question Unavailable",
        market: msg.threads?.market ?? "global",
        threadSlug: msg.threads?.slug ?? "",
      };
    });
  }

  // 3. Fetch QA Threads with Tags
  const { data: rawThreads } = await supabase
    .from("threads")
    .select("id, title, market, tags, updated_at, slug")
    .is("source_tag", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  const threads = ((rawThreads ?? []) as unknown as DBThread[]).map((t) => ({
    id: t.id,
    title: t.title || "Untitled Chat",
    market: t.market,
    tags: t.tags || [],
    updatedAt: t.updated_at,
    slug: t.slug,
  }));

  return (
    <AdminDashboard
      documents={documents}
      feedbackLogs={feedbackLogs}
      threads={threads}
      totalVotes={totalVotes}
      currentUserRole={user.role}
      initialTab={initialTab}
    />
  );
}
