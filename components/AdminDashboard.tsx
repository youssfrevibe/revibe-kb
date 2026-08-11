"use client";

import { useState } from "react";
import Link from "next/link";
import { marketLabel } from "@/lib/markets";

type DocumentRow = {
  title: string;
  sourcePath: string;
  sourceType: string;
  market: string;
  updatedAt: string;
  chunkCount: number;
};

type FeedbackRow = {
  id: string;
  content: string;
  feedbackRating: "good" | "bad";
  feedbackCorrection: string | null;
  createdAt: string;
  question: string;
  market: string;
  threadSlug: string;
};

type ThreadRow = {
  id: string;
  title: string;
  market: string;
  tags: string[];
  updatedAt: string;
  slug: string;
};

type Props = {
  documents: DocumentRow[];
  feedbackLogs: FeedbackRow[];
  threads: ThreadRow[];
  totalVotes: { good: number; bad: number };
};

export function AdminDashboard({ documents, feedbackLogs, threads, totalVotes }: Props) {
  const [activeTab, setActiveTab] = useState<"catalog" | "learning" | "requests">("catalog");

  // Calculate tag counts
  const tagCounts: Record<string, number> = {};
  threads.forEach((t) => {
    t.tags?.forEach((tag) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const totalVotesCount = totalVotes.good + totalVotes.bad;
  const accuracyRate = totalVotesCount > 0 ? Math.round((totalVotes.good / totalVotesCount) * 100) : 100;

  return (
    <div className="flex flex-col gap-6">
      {/* Overview Stats Bar */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div
          className="rounded-[var(--revibe-radius)] border p-4"
          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
        >
          <span className="revibe-label text-[9px]" style={{ color: "var(--revibe-ink-muted)" }}>
            Total Catalog Chunks
          </span>
          <div className="text-2xl font-bold mt-1 text-[var(--revibe-ink)]">
            {documents.reduce((sum, doc) => sum + doc.chunkCount, 0)}
          </div>
          <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
            Across {documents.length} source files
          </span>
        </div>

        <div
          className="rounded-[var(--revibe-radius)] border p-4"
          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
        >
          <span className="revibe-label text-[9px]" style={{ color: "var(--revibe-ink-muted)" }}>
            Support Accuracy
          </span>
          <div className="text-2xl font-bold mt-1 flex items-baseline gap-1" style={{ color: "var(--revibe-ink)" }}>
            {accuracyRate}%
            <span className="text-[10px] font-normal text-emerald-600">
              ({totalVotes.good} / {totalVotesCount} votes)
            </span>
          </div>
          <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
            Derived from user feedback rating
          </span>
        </div>

        <div
          className="rounded-[var(--revibe-radius)] border p-4"
          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
        >
          <span className="revibe-label text-[9px]" style={{ color: "var(--revibe-ink-muted)" }}>
            AI Corrections Registered
          </span>
          <div className="text-2xl font-bold mt-1 text-[var(--revibe-ink)]">
            {feedbackLogs.filter((l) => l.feedbackCorrection).length}
          </div>
          <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
            Active self-learned patches
          </span>
        </div>

        <div
          className="rounded-[var(--revibe-radius)] border p-4"
          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
        >
          <span className="revibe-label text-[9px]" style={{ color: "var(--revibe-ink-muted)" }}>
            Tagged Conversations
          </span>
          <div className="text-2xl font-bold mt-1 text-[var(--revibe-ink)]">
            {threads.filter((t) => t.tags && t.tags.length > 0).length}
          </div>
          <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
            Categorized for analytics
          </span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center justify-between border-b" style={{ borderColor: "var(--revibe-border)" }}>
        <div className="flex">
          <button
            onClick={() => setActiveTab("catalog")}
            className={`revibe-label px-4 py-2.5 text-[12px] border-b-2 transition-colors ${
              activeTab === "catalog"
                ? "border-[var(--revibe-ink)] font-semibold text-[var(--revibe-ink)]"
                : "border-transparent text-[var(--revibe-ink-muted)] hover:text-[var(--revibe-ink)]"
            }`}
          >
            Source Catalog ({documents.length})
          </button>
          <button
            onClick={() => setActiveTab("learning")}
            className={`revibe-label px-4 py-2.5 text-[12px] border-b-2 transition-colors ${
              activeTab === "learning"
                ? "border-[var(--revibe-ink)] font-semibold text-[var(--revibe-ink)]"
                : "border-transparent text-[var(--revibe-ink-muted)] hover:text-[var(--revibe-ink)]"
            }`}
          >
            AI Learning Log ({feedbackLogs.length})
          </button>
          <button
            onClick={() => setActiveTab("requests")}
            className={`revibe-label px-4 py-2.5 text-[12px] border-b-2 transition-colors ${
              activeTab === "requests"
                ? "border-[var(--revibe-ink)] font-semibold text-[var(--revibe-ink)]"
                : "border-transparent text-[var(--revibe-ink-muted)] hover:text-[var(--revibe-ink)]"
            }`}
          >
            Request Analysis ({threads.length})
          </button>
        </div>

        <Link
          href="/admin/teach"
          className="revibe-label revibe-focus mb-1.5 rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] font-semibold transition-colors"
          style={{ background: "var(--revibe-ink)", color: "#fff" }}
        >
          Teach the AI &rarr;
        </Link>
      </div>

      {/* Tab Contents */}
      {activeTab === "catalog" && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="revibe-label text-[12px]">Indexed material</h2>
            <p className="mt-1 text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
              All currently embedded training documents and guidelines. Ingestion remains locally run via CLI.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr className="revibe-label text-left text-[10px]" style={{ color: "var(--revibe-ink-muted)" }}>
                  <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Market</th>
                  <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Title</th>
                  <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Type</th>
                  <th className="border-b py-2 pr-3 text-right" style={{ borderColor: "var(--revibe-border)" }}>Chunks</th>
                  <th className="border-b py-2 text-right" style={{ borderColor: "var(--revibe-border)" }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.sourcePath}>
                    <td className="border-b py-2 pr-3 align-top" style={{ borderColor: "var(--revibe-border)" }}>
                      <span className="revibe-label text-[10px]">{doc.market}</span>
                      <span className="block text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                        {marketLabel(doc.market)}
                      </span>
                    </td>
                    <td className="border-b py-2 pr-3 align-top" style={{ borderColor: "var(--revibe-border)" }}>
                      <span className="font-semibold">{doc.title}</span>
                      <span className="block text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                        {doc.sourcePath}
                      </span>
                    </td>
                    <td className="border-b py-2 pr-3 align-top uppercase" style={{ borderColor: "var(--revibe-border)" }}>
                      {doc.sourceType}
                    </td>
                    <td className="border-b py-2 pr-3 text-right align-top tabular-nums" style={{ borderColor: "var(--revibe-border)" }}>
                      {doc.chunkCount}
                    </td>
                    <td className="border-b py-2 text-right align-top" style={{ borderColor: "var(--revibe-border)" }}>
                      {new Date(doc.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "learning" && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="revibe-label text-[12px]">AI Self-Learning & Corrections Log</h2>
            <p className="mt-1 text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
              Corrections submitted by staff when flagging bad answers. The AI dynamically incorporates these corrections in future RAG queries.
            </p>
          </div>

          {feedbackLogs.length === 0 ? (
            <div
              className="rounded-[var(--revibe-radius)] border p-8 text-center text-[13px]"
              style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
            >
              <span className="text-muted-foreground block mb-1">No feedback received yet.</span>
              <span className="text-[11px]" style={{ color: "var(--revibe-ink-faint)" }}>
                When support staff rate answers using checkmarks/crosses in the Q&A thread, they will populate here.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {feedbackLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-[var(--revibe-radius)] border p-4 flex flex-col gap-3 relative overflow-hidden"
                  style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
                >
                  {/* Accent rail left for classification */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1.5"
                    style={{ background: log.feedbackRating === "good" ? "#10b981" : "#f43f5e" }}
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 pl-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="revibe-label rounded px-1.5 py-0.5 text-[9px] font-bold"
                        style={{
                          background: log.feedbackRating === "good" ? "#d1fae5" : "#ffe4e6",
                          color: log.feedbackRating === "good" ? "#065f46" : "#9f1239",
                        }}
                      >
                        {log.feedbackRating === "good" ? "HELPFUL" : "CORRECTED"}
                      </span>
                      <span className="text-[11px] font-semibold" style={{ color: "var(--revibe-ink-muted)" }}>
                        Market: {log.market.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                      {new Date(log.createdAt).toLocaleString()} ·{" "}
                      <a href={`/t/${log.threadSlug}`} className="underline font-medium hover:text-[var(--revibe-accent)]">
                        View Thread
                      </a>
                    </span>
                  </div>

                  <div className="pl-2">
                    <span className="font-semibold block text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--revibe-ink-faint)" }}>
                      User Question
                    </span>
                    <p className="text-[13px] italic" style={{ color: "var(--revibe-ink)" }}>
                      &ldquo;{log.question}&rdquo;
                    </p>
                  </div>

                  {log.feedbackRating === "bad" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-2 pt-2 border-t" style={{ borderColor: "var(--revibe-border)" }}>
                      <div>
                        <span className="font-semibold block text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "#9f1239" }}>
                          AI Flagged Answer
                        </span>
                        <p className="text-[12px] bg-rose-50 p-2.5 rounded border border-rose-100 text-rose-800 whitespace-pre-wrap leading-5 max-h-48 overflow-y-auto">
                          {log.content}
                        </p>
                      </div>
                      <div>
                        <span className="font-semibold block text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "#065f46" }}>
                          Staff Corrected Policy
                        </span>
                        <p className="text-[12px] bg-emerald-50 p-2.5 rounded border border-emerald-100 text-emerald-800 whitespace-pre-wrap leading-5 max-h-48 overflow-y-auto">
                          {log.feedbackCorrection}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "requests" && (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="revibe-label text-[12px]">Request Analysis</h2>
            <p className="mt-1 text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
              Overview of the most popular topics requested by support agents. Categorized automatically via AI tagging.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Tag Frequencies List */}
            <div
              className="rounded-[var(--revibe-radius)] border p-4 md:col-span-1"
              style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
            >
              <h3 className="revibe-label text-[11px] mb-3 border-b pb-2" style={{ borderColor: "var(--revibe-border)" }}>
                Top Agent Topics
              </h3>
              {sortedTags.length === 0 ? (
                <p className="text-[11px]" style={{ color: "var(--revibe-ink-faint)" }}>
                  No tagged conversations analyzed yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {sortedTags.map(([tag, count]) => {
                    const percentage = Math.round((count / threads.length) * 100);
                    return (
                      <div key={tag} className="flex flex-col gap-1">
                        <div className="flex justify-between text-[12px]">
                          <span className="font-semibold">#{tag}</span>
                          <span style={{ color: "var(--revibe-ink-muted)" }}>
                            {count} requests ({percentage}%)
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full"
                            style={{ background: "var(--revibe-accent)", width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Conversations List */}
            <div
              className="rounded-[var(--revibe-radius)] border p-4 md:col-span-2"
              style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
            >
              <h3 className="revibe-label text-[11px] mb-3 border-b pb-2" style={{ borderColor: "var(--revibe-border)" }}>
                Recent Conversations & Tags
              </h3>
              {threads.length === 0 ? (
                <p className="text-[11px]" style={{ color: "var(--revibe-ink-faint)" }}>
                  No support conversations in archive.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="revibe-label text-left text-[10px]" style={{ color: "var(--revibe-ink-muted)" }}>
                        <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Thread</th>
                        <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Market</th>
                        <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Tags</th>
                        <th className="border-b py-2 text-right" style={{ borderColor: "var(--revibe-border)" }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {threads.slice(0, 10).map((t) => (
                        <tr key={t.id}>
                          <td className="border-b py-2 pr-3 align-middle font-medium">
                            <a href={`/t/${t.slug}`} className="hover:text-[var(--revibe-accent)] transition-colors">
                              {t.title || "Untitled Thread"}
                            </a>
                          </td>
                          <td className="border-b py-2 pr-3 align-middle uppercase text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
                            {t.market}
                          </td>
                          <td className="border-b py-2 pr-3 align-middle">
                            <div className="flex flex-wrap gap-1">
                              {t.tags && t.tags.length > 0 ? (
                                t.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded px-1.5 py-0.5 text-[10px]"
                                    style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-muted)" }}
                                  >
                                    #{tag}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                                  no tags
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="border-b py-2 text-right align-middle" style={{ color: "var(--revibe-ink-faint)" }}>
                            {new Date(t.updatedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
