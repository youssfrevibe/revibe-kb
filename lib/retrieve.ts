// Retrieval over reference threads.
//
// Every meaningful unit of source material is stored as a reference thread
// with an embedded assistant message. This module hides that shape behind one
// function: hybridSearch(query, markets, mode) → RetrievedRef[]. The caller
// doesn't care whether the search hit an SRC (help center + PDF training) or
// ALH (customer-bot guideline) reference; it just gets ranked references back.
//
// Server-side only. The CLI scripts import this directly, so it doesn't use
// the `server-only` guard package — see the note in lib/supabase.ts.

import { db } from "./supabase";
import { embedQuery, generateText, UTILITY_MODEL } from "./gemini";
import type { SourceTag, SourceMode } from "./source-tags";
import { tagsForMode } from "./source-tags";
import type { MarketFilter } from "./market-detect";

export type RetrievedRef = {
  messageId: string;
  threadId: string;
  threadSlug: string;
  refNumber: number | null;
  sourceTag: SourceTag;
  title: string;
  market: string;
  content: string;
  score: number;
};

type MatchRow = {
  message_id: string;
  thread_id: string;
  thread_slug: string;
  ref_number: number | null;
  source_tag: SourceTag;
  title: string;
  market: string;
  content: string;
  score: number;
};

const CANDIDATE_COUNT = 30;

/**
 * The single retrieval entry point.
 *
 * Embeds the question, calls match_threads (vector + BM25 fused with RRF), and
 * optionally reranks.
 *
 * `markets` semantics (see lib/market-detect.ts):
 *   - `['global']`   → global only, safe fallback when no country is named
 *   - `['uae']` etc. → that market + global
 *   - `null`         → no filter (all markets + global), for comparison
 *                      questions that name multiple countries
 */
export async function hybridSearch(
  query: string,
  markets: MarketFilter,
  mode: SourceMode,
  k = 6,
): Promise<RetrievedRef[]> {
  const embedding = await embedQuery(query);

  const { data, error } = await db().rpc("match_threads", {
    query_embedding: embedding,
    query_text: query,
    filter_markets: markets,
    filter_source_tags: tagsForMode(mode),
    match_count: process.env.RERANK === "1" ? CANDIDATE_COUNT : k,
    candidate_count: CANDIDATE_COUNT,
  });

  if (error) throw new Error(`match_threads failed: ${error.message}`);

  const refs: RetrievedRef[] = ((data ?? []) as MatchRow[]).map((row) => ({
    messageId: row.message_id,
    threadId: row.thread_id,
    threadSlug: row.thread_slug,
    refNumber: row.ref_number,
    sourceTag: row.source_tag,
    title: row.title,
    market: row.market,
    content: row.content,
    score: row.score,
  }));

  if (process.env.RERANK !== "1" || refs.length <= k) return refs.slice(0, k);
  return rerank(query, refs, k);
}

/**
 * Optional LLM rerank of the fused top 30 down to k.
 *
 * Sits behind RERANK=1 — measure hit-rate both ways with `npm run eval` before
 * turning it on. RRF alone is often enough and this adds a round-trip.
 * Falls back to fusion order on any parsing trouble: a degraded ranking is
 * strictly better than a failed request.
 */
async function rerank(query: string, refs: RetrievedRef[], k: number): Promise<RetrievedRef[]> {
  const listing = refs
    .map((ref, i) => `[${i}] ${ref.title}\n${ref.content.slice(0, 700)}`)
    .join("\n\n");

  try {
    const raw = await generateText({
      model: UTILITY_MODEL,
      system:
        "You rank retrieved passages by how directly they answer a question. " +
        "Reply with only the passage numbers, most relevant first, comma-separated. No prose.",
      prompt: `Question: ${query}\n\nPassages:\n${listing}\n\nThe ${k} most relevant passage numbers:`,
      maxOutputTokens: 64,
    });

    const order = [...raw.matchAll(/\d+/g)]
      .map((match) => Number(match[0]))
      .filter((index) => index >= 0 && index < refs.length);

    const seen = new Set<number>();
    const ranked: RetrievedRef[] = [];
    for (const index of order) {
      if (seen.has(index)) continue;
      seen.add(index);
      ranked.push(refs[index]);
      if (ranked.length === k) break;
    }
    if (ranked.length === 0) return refs.slice(0, k);
    for (const ref of refs) {
      if (ranked.length === k) break;
      if (!ranked.includes(ref)) ranked.push(ref);
    }
    return ranked;
  } catch (error) {
    console.warn("rerank failed, falling back to fusion order:", error);
    return refs.slice(0, k);
  }
}
