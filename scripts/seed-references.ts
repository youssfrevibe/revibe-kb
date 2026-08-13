/**
 * Turn every source section into a reference thread — and embed it.
 *
 * Threads are the retrieval layer now (see migration 0002). Each source section
 * becomes one thread with:
 *   - source_tag: TR1 (policy index) | TR2 (training/FAQ) | NEWP | NEWL | MSTR
 *   - ref_number: stable per-tag counter (TR1-0001..N, TR2-0001..N, etc.)
 *   - one assistant message: the section body, with a vector embedding
 *
 * Answers cite REF-#### links to the thread, and staff can edit that thread's
 * body to correct policy in-place. Next question that retrieves this reference
 * sees the updated wording, no re-ingest needed.
 *
 *   npm run seed:references                    # incremental (skips existing)
 *   npm run seed:references -- --clean         # wipe all ref threads + reseed
 *   npm run seed:references -- --limit 20      # smoke test
 *   npm run seed:references -- --only uae      # one market
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
type DB = SupabaseClient;
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { newSlug } from "../lib/slug";
import { MARKETS, MARKET_CODES, type Market, isMarket } from "../lib/markets";
import { sourceTagFor, type SourceTag } from "../lib/source-tags";
import { embedDocuments } from "../lib/gemini";

// ---------------------------------------------------------------------------

type ChunkRow = {
  id: string;
  document_id: string;
  ord: number;
  heading_path: string | null;
  market: string;
  content: string;
  documents: { title: string; source_type: string; source_path: string } | null;
};

type Section = {
  documentId: string;
  documentTitle: string;
  sourceType: string;
  sourcePath: string;
  sourceTag: SourceTag;
  market: Market;
  headingPath: string;
  chunks: ChunkRow[];
  content: string;
};

type Args = { only: Market | null; limit: number | null; clean: boolean };

const REF_TITLE_MAX = 90;

// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  const args: Args = { only: null, limit: null, clean: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      const value = argv[++i];
      if (value && isMarket(value)) args.only = value;
    } else if (arg === "--limit") args.limit = Number(argv[++i]) || null;
    else if (arg === "--clean") args.clean = true;
  }
  return args;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n${name} is not set. Copy .env.local.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} (yes/no) `)).trim().toLowerCase();
    return answer === "yes" || answer === "y";
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Load and group source chunks into sections
// ---------------------------------------------------------------------------

async function loadSections(
  supabase: DB,
  only: Market | null,
): Promise<Section[]> {
  const chunks: ChunkRow[] = [];
  const page = 1000;
  let from = 0;
  while (true) {
    let query = supabase
      .from("chunks")
      .select("id, document_id, ord, heading_path, market, content, documents(title, source_type, source_path)")
      .order("market", { ascending: true })
      .order("document_id", { ascending: true })
      .order("ord", { ascending: true })
      .range(from, from + page - 1);
    if (only) query = query.eq("market", only);

    const { data, error } = await query;
    if (error) throw new Error(`chunks lookup failed: ${error.message}`);
    if (!data || data.length === 0) break;
    chunks.push(...(data as unknown as ChunkRow[]));
    if (data.length < page) break;
    from += page;
  }

  const groups = new Map<string, Section>();
  for (const chunk of chunks) {
    if (!chunk.documents) continue;
    if (!isMarket(chunk.market)) continue;

    const tag = sourceTagFor(chunk.documents.source_path);
    if (!tag) continue;

    const key = `${chunk.document_id}::${chunk.heading_path ?? ""}`;
    let section = groups.get(key);
    if (!section) {
      section = {
        documentId: chunk.document_id,
        documentTitle: chunk.documents.title,
        sourceType: chunk.documents.source_type,
        sourcePath: chunk.documents.source_path,
        sourceTag: tag,
        market: chunk.market,
        headingPath: chunk.heading_path ?? "",
        chunks: [],
        content: "",
      };
      groups.set(key, section);
    }
    section.chunks.push(chunk);
  }

  const marketOrder = new Map(MARKET_CODES.map((code, i) => [code, i] as const));
  const tagOrder = new Map<SourceTag, number>([["TR1", 0], ["TR2", 1], ["NEWP", 2], ["NEWL", 3], ["MSTR", 4]]);

  const sections = [...groups.values()];
  sections.sort((a, b) => {
    // Tag first so the ref_number counter within each pool is stable and dense.
    const tagDiff = (tagOrder.get(a.sourceTag) ?? 9) - (tagOrder.get(b.sourceTag) ?? 9);
    if (tagDiff !== 0) return tagDiff;
    const marketDiff = (marketOrder.get(a.market) ?? 99) - (marketOrder.get(b.market) ?? 99);
    if (marketDiff !== 0) return marketDiff;
    const titleDiff = a.documentTitle.localeCompare(b.documentTitle);
    if (titleDiff !== 0) return titleDiff;
    return a.chunks[0].ord - b.chunks[0].ord;
  });

  for (const section of sections) {
    section.chunks.sort((a, b) => a.ord - b.ord);
    section.content = joinChunks(section);
  }

  return sections;
}

/**
 * Concatenate a section's chunks back into one body.
 *
 * Every chunk carries the heading path prepended (that's how retrieval sees
 * them in isolation). Strip the repeated heading from chunks 2..N so the
 * reference reads naturally instead of "Shipping SLA Check … Shipping SLA
 * Check … Shipping SLA Check".
 */
function joinChunks(section: Section): string {
  const heading = section.headingPath.trim();
  const parts: string[] = [];
  for (const chunk of section.chunks) {
    let body = chunk.content;
    if (heading) {
      const withNewline = `${heading}\n\n`;
      if (body.startsWith(withNewline)) body = body.slice(withNewline.length);
      else if (body.startsWith(heading)) body = body.slice(heading.length).trimStart();
    }
    parts.push(body.trim());
  }
  return parts.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function refTitle(refNumber: number, section: Section): string {
  // Pull the last segment of the heading path — that's the actionable name.
  const segments = section.headingPath.split("›").map((part) => part.trim()).filter(Boolean);
  const last = segments[segments.length - 1] ?? section.documentTitle;
  const cleaned = last
    .replace(/^Guideline:\s*/i, "")
    .replace(/^Page \d+\s*[·›]?\s*/, "")
    .trim();
  const title = cleaned || section.documentTitle;

  const prefix = `${section.sourceTag}-${String(refNumber).padStart(4, "0")} · `;
  const remaining = REF_TITLE_MAX - prefix.length;
  return prefix + (title.length > remaining ? title.slice(0, remaining - 1).trimEnd() + "…" : title);
}

function refBody(refNumber: number, section: Section): string {
  const marketLabel = section.market in MARKETS ? MARKETS[section.market].label : section.market;
  const header: string[] = [
    `**${section.sourceTag}-${String(refNumber).padStart(4, "0")}** · ${marketLabel} · ${section.documentTitle}`,
  ];
  if (section.headingPath) header.push(`_${section.headingPath}_`);
  return `${header.join("\n")}\n\n${section.content}`.trim();
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanExisting(supabase: DB): Promise<number> {
  const { data, error } = await supabase.from("threads").select("id").not("source_tag", "is", null);
  if (error) throw new Error(`ref lookup failed: ${error.message}`);
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  if (ids.length === 0) return 0;

  const yes = await confirm(`Delete ${ids.length} existing reference threads (TR1/TR2/NEWP/NEWL/MSTR)?`);
  if (!yes) {
    console.log("Cancelled.");
    process.exit(0);
  }
  for (let i = 0; i < ids.length; i += 100) {
    const { error: deleteError } = await supabase.from("threads").delete().in("id", ids.slice(i, i + 100));
    if (deleteError) throw new Error(`ref delete failed: ${deleteError.message}`);
  }
  return ids.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  requireEnv("GEMINI_API_KEY");

  if (args.clean) {
    console.log("\nCleaning existing reference threads…");
    const removed = await cleanExisting(supabase);
    console.log(`Removed: ${removed}\n`);
  }

  console.log("Loading sections…");
  const sections = await loadSections(supabase, args.only);
  const byTag: Record<SourceTag, number> = { TR1: 0, TR2: 0, NEWP: 0, NEWL: 0, MSTR: 0 };
  for (const s of sections) byTag[s.sourceTag]++;;

  console.log(`Sections: ${sections.length} (TR1 ${byTag.TR1}, TR2 ${byTag.TR2}, NEWP ${byTag.NEWP}, NEWL ${byTag.NEWL}, MSTR ${byTag.MSTR})`);
  if (args.only) console.log(`Filter: ${args.only} (${MARKETS[args.only].label})`);

  // Skip whatever already exists in this pool, keyed on (source_tag, ref_number).
  // Post-migration ref_number is the stable identity.
  const { data: existingRows } = await supabase
    .from("threads")
    .select("source_tag, ref_number")
    .not("source_tag", "is", null);
  const existing = new Set(
    ((existingRows ?? []) as { source_tag: string; ref_number: number }[]).map(
      (row) => `${row.source_tag}::${row.ref_number}`,
    ),
  );

  const targets = args.limit ? sections.slice(0, args.limit) : sections;
  console.log(`Existing references to skip: ${existing.size}`);
  console.log(`Will process: ${targets.length}\n`);

  // Assign ref numbers per tag, densely 1..N. Deterministic because sections are
  // already sorted by (tag, market, doc, ord).
  const counter: Record<SourceTag, number> = { TR1: 0, TR2: 0, NEWP: 0, NEWL: 0, MSTR: 0 };
  const jobs: { section: Section; refNumber: number }[] = [];
  for (const section of targets) {
    counter[section.sourceTag]++;
    const refNumber = counter[section.sourceTag];
    if (existing.has(`${section.sourceTag}::${refNumber}`)) continue;
    jobs.push({ section, refNumber });
  }

  if (jobs.length === 0) {
    console.log("Nothing to insert.\n");
    return;
  }

  let inserted = 0;
  let failed = 0;
  const BATCH = 20;

  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const bodies = batch.map(({ section, refNumber }) => refBody(refNumber, section));

    let embeddings: number[][];
    try {
      embeddings = await embedDocuments(bodies);
    } catch (error) {
      failed += batch.length;
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ [${i + 1}..${i + batch.length}]  embed batch failed: ${detail}`);
      continue;
    }

    // Sequential inside a batch — Supabase free tier is unhappy with parallel
    // multi-table inserts under load and this is one-off seed work anyway.
    for (let j = 0; j < batch.length; j++) {
      const { section, refNumber } = batch[j];
      const title = refTitle(refNumber, section);
      const slug = newSlug();

      try {
        const { data: thread, error: threadError } = await supabase
          .from("threads")
          .insert({
            slug,
            title,
            market: section.market,
            source_tag: section.sourceTag,
            ref_number: refNumber,
          })
          .select("id")
          .single();
        if (threadError) throw new Error(threadError.message);

        const { data: message, error: messageError } = await supabase
          .from("messages")
          .insert({
            thread_id: thread.id,
            role: "assistant",
            content: bodies[j],
            embedding: embeddings[j],
            embedded_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (messageError) throw new Error(messageError.message);

        // Keep the chunk provenance so an editor can see which raw source
        // chunks this reference was originally built from. These citations
        // point at chunk rows; retrieval citations point at message rows.
        if (section.chunks.length > 0) {
          const rows = section.chunks.map((chunk, idx) => ({
            message_id: message.id,
            chunk_id: chunk.id,
            rank: idx + 1,
            score: null,
          }));
          const { error: sourceError } = await supabase.from("message_sources").insert(rows);
          if (sourceError) throw new Error(sourceError.message);
        }

        inserted++;
        if (inserted % 25 === 0 || inserted <= 5) {
          console.log(
            `  ✓ [${section.sourceTag}-${String(refNumber).padStart(4, "0")}] ${section.market.padEnd(6)} /t/${slug}  ${title.slice(11, 70)}`,
          );
        }
      } catch (error) {
        failed++;
        const detail = error instanceof Error ? error.message : String(error);
        console.log(
          `  ✗ [${section.sourceTag}-${String(refNumber).padStart(4, "0")}] ${section.market.padEnd(6)} ${detail}`,
        );
      }
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Inserted: ${inserted}   Failed: ${failed}`);
  console.log(`Browse the catalog at /threads.\n`);
}

main().catch((error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
