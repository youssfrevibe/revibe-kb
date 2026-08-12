import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { generateText } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CSV export of every rated assistant message.
 *
 *   Columns: Question, Answer, Accurate, Category
 *   - Accurate: True if feedback_rating='good', False if 'bad'
 *   - Category: 'normal' or 'edge_case', inferred at export time via
 *     gemini-2.5-flash-lite in batches so we don't pay a per-row round-trip
 *
 * Admin + Owner. Owner sees Refresh Stats too (rendered on the dashboard);
 * both can export.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();

  // Pull every assistant message with a rating, plus the thread it came from
  // (for market/slug) and the user question that preceded it.
  const { data: rated, error: ratedError } = await supabase
    .from("messages")
    .select("id, content, feedback_rating, created_at, thread_id, threads!inner(slug, market, title)")
    .not("feedback_rating", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (ratedError) return Response.json({ error: ratedError.message }, { status: 500 });

  type Row = {
    id: string;
    content: string;
    feedback_rating: "good" | "bad";
    created_at: string;
    thread_id: string;
    threads: { slug: string; market: string; title: string | null } | null;
  };
  const messages = (rated ?? []) as unknown as Row[];

  if (messages.length === 0) {
    return csvResponse(["Question", "Answer", "Accurate", "Category", "Market", "Thread", "RatedAt"], []);
  }

  // For each rated message, fetch the user question that preceded it. Group by
  // thread to keep the query count manageable — one query per thread returns
  // the whole ordered conversation.
  const threadIds = [...new Set(messages.map((message) => message.thread_id))];
  const questionByAnswerId = new Map<string, string>();

  // Chunk thread lookups so a huge export doesn't blow the URL length.
  const CHUNK = 100;
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const slice = threadIds.slice(i, i + CHUNK);
    const { data: convo } = await supabase
      .from("messages")
      .select("id, role, content, created_at, thread_id")
      .in("thread_id", slice)
      .order("created_at", { ascending: true });

    type ConvoRow = { id: string; role: "user" | "assistant"; content: string; created_at: string; thread_id: string };
    const byThread = new Map<string, ConvoRow[]>();
    for (const row of (convo ?? []) as ConvoRow[]) {
      const list = byThread.get(row.thread_id) ?? [];
      list.push(row);
      byThread.set(row.thread_id, list);
    }

    // For each rated message in this batch, walk backwards from its position
    // in its thread to find the nearest user question.
    for (const message of messages) {
      if (!byThread.has(message.thread_id)) continue;
      if (questionByAnswerId.has(message.id)) continue;
      const rows = byThread.get(message.thread_id)!;
      const index = rows.findIndex((row) => row.id === message.id);
      if (index < 0) continue;
      for (let j = index - 1; j >= 0; j--) {
        if (rows[j].role === "user") {
          questionByAnswerId.set(message.id, rows[j].content);
          break;
        }
      }
    }
  }

  // Classify each question as normal vs edge_case via Gemini flash-lite in
  // batches of 20. Anything that fails to parse falls back to "normal" so a
  // classification hiccup can't block the export.
  const BATCH_SIZE = 20;
  const categoryByAnswerId = new Map<string, "normal" | "edge_case">();
  const toClassify = messages.map((message) => ({
    id: message.id,
    question: questionByAnswerId.get(message.id) ?? "",
  }));

  for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
    const batch = toClassify.slice(i, i + BATCH_SIZE);
    const numbered = batch.map((item, index) => `${index}. ${item.question.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
    try {
      const raw = await generateText({
        prompt: [
          "Classify each customer-support question below as either:",
          '- "normal": routine, everyday support inquiry (shipping status, refund policy, etc.)',
          '- "edge_case": unusual, ambiguous, multi-market comparison, hypothetical, or boundary scenario',
          "",
          "Return ONLY a JSON array with one object per question, in the SAME ORDER, no other text, no code fences.",
          'Shape: [{"index": 0, "category": "normal"}, {"index": 1, "category": "edge_case"}, ...]',
          "",
          "Questions:",
          numbered,
        ].join("\n"),
        maxOutputTokens: 512,
      });
      const cleaned = raw.replace(/^```(?:json)?/g, "").replace(/```$/g, "").trim();
      const parsed = JSON.parse(cleaned) as Array<{ index: number; category: string }>;
      for (const entry of parsed) {
        if (!Number.isInteger(entry.index)) continue;
        const target = batch[entry.index];
        if (!target) continue;
        const category = entry.category === "edge_case" ? "edge_case" : "normal";
        categoryByAnswerId.set(target.id, category);
      }
    } catch {
      // Fall through — anything not classified stays as "normal" below.
    }
  }

  // Assemble rows in the same order the messages came out of the DB.
  const rows = messages.map((message) => {
    const question = questionByAnswerId.get(message.id) ?? "";
    const accurate = message.feedback_rating === "good" ? "True" : "False";
    const category = categoryByAnswerId.get(message.id) ?? "normal";
    const market = message.threads?.market ?? "";
    const threadLink = message.threads?.slug ? `/t/${message.threads.slug}` : "";
    const ratedAt = message.created_at;
    return [question, message.content, accurate, category, market, threadLink, ratedAt];
  });

  return csvResponse(["Question", "Answer", "Accurate", "Category", "Market", "Thread", "RatedAt"], rows);
}

/** RFC 4180 CSV: fields with quotes, commas, or newlines get wrapped and doubled. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvResponse(header: string[], rows: string[][]): Response {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  // BOM so Excel opens UTF-8 CSVs correctly out of the box.
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="feedback-export.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
