/**
 * Assembles the full knowledge base to hand the model on every question.
 *
 * The whole curated corpus is ~40K tokens — a few % of the context window — so
 * instead of retrieving fragments we give the assistant everything and let it
 * reason over the complete picture. Two parts:
 *   1. Static TR1/TR2 — compiled from the repo .md files into
 *      lib/kb-content.generated.ts (see scripts/build-kb.ts).
 *   2. Live NEWP/NEWL — admin policy changes and learnt corrections, read from
 *      the DB so they take effect without a redeploy.
 *
 * Cached briefly; the static part never changes at runtime and the live part
 * is tiny, so this is cheap to call per turn.
 */
import { db } from "./supabase";
import { KB_CONTENT } from "./kb-content.generated";

const CACHE_TTL_MS = 30_000;

let cache: { block: string; at: number } | null = null;

type OverrideRow = {
  content: string;
  threads: { source_tag: string; ref_number: number | null; title: string | null } | null;
};

/** Fetch NEWP + NEWL entries and render them as an overrides block. */
async function liveOverrides(): Promise<string> {
  const { data, error } = await db()
    .from("messages")
    .select("content, threads!inner(source_tag, ref_number, title)")
    .in("threads.source_tag", ["NEWP", "NEWL"]);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as OverrideRow[];
  if (rows.length === 0) return "";

  // NEWP (policy) before NEWL (learnt), then by ref number.
  rows.sort((a, b) => {
    const ta = a.threads?.source_tag === "NEWP" ? 0 : 1;
    const tb = b.threads?.source_tag === "NEWP" ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return (a.threads?.ref_number ?? 0) - (b.threads?.ref_number ?? 0);
  });

  const blocks = rows.map((r) => {
    const t = r.threads;
    const tag = t?.source_tag ?? "NEW";
    const ref = t?.ref_number ? `${tag}-${String(t.ref_number).padStart(4, "0")}` : tag;
    return `----- ${ref} · ${t?.title ?? ""} -----\n${r.content}`;
  });

  return [
    "",
    "",
    "===== LIVE OVERRIDES =====",
    "NEWP = new policy changes. NEWL = learnt corrections. These are the most",
    "recent, authoritative guidance and WIN over the TR content above on any",
    "point they address.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

/** The complete KB block to embed in the user turn. Falls back to the static
 *  corpus alone if the live overrides can't be read. */
export async function getKbContext(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.block;
  let overrides = "";
  try {
    overrides = await liveOverrides();
  } catch {
    // DB hiccup or pre-migration — the static corpus is enough to answer.
  }
  const block = KB_CONTENT + overrides;
  cache = { block, at: Date.now() };
  return block;
}

/** Drop the cache so the next getKbContext() re-reads live overrides. */
export function clearKbContextCache(): void {
  cache = null;
}
