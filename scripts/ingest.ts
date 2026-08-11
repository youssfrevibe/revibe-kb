/**
 * Ingest CLI — parse, chunk, embed, and upsert source material.
 *
 *   npm run ingest -- --dry-run          parse and report, write nothing
 *   npm run ingest -- --only uae         only files whose path contains "uae"
 *   npm run ingest -- --force            re-embed even if content is unchanged
 *   npm run ingest -- --dir ./sources    override the source directory
 *
 * Runs locally rather than as an API route: parsing and embedding a corpus takes
 * minutes and would hit serverless execution limits, and there's no reason to pay
 * for compute to do a job a laptop does fine.
 */
// Next auto-loads .env.local; the CLI does not, so point dotenv at it explicitly.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parserFor } from "../lib/parsers";
import { chunkSections, hashText, estimateTokens } from "../lib/chunk";
import { embedDocuments } from "../lib/gemini";
import { marketLabel } from "../lib/markets";

type Args = {
  dryRun: boolean;
  force: boolean;
  only: string | null;
  dir: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, force: false, only: null, dir: "sources" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--only") args.only = argv[++i] ?? null;
    else if (arg === "--dir") args.dir = argv[++i] ?? "sources";
  }
  return args;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n${name} is not set. Copy .env.local.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.dir);

  const files = (await walk(root)).filter((file) => {
    if (!parserFor(relative(root, file))) return false;
    if (args.only && !file.toLowerCase().includes(args.only.toLowerCase())) return false;
    return true;
  });

  if (files.length === 0) {
    console.error(`No supported files found in ${root}.`);
    console.error("Put the guideline .md files and training .pdf files there, then re-run.");
    process.exit(1);
  }

  console.log(`\nSource directory: ${root}`);
  console.log(`Files to process: ${files.length}${args.dryRun ? "  (dry run — nothing will be written)" : ""}\n`);

  // Only touch the database when we actually intend to write.
  const supabase = args.dryRun
    ? null
    : createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
  if (!args.dryRun) requireEnv("GEMINI_API_KEY");

  let totalChunks = 0;
  let embeddedChunks = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const file of files) {
    const relativePath = relative(root, file).replace(/\\/g, "/");
    const parser = parserFor(relativePath);
    if (!parser) continue;

    let docs;
    try {
      docs = await parser.parse(file, relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${relativePath}: ${message}`);
      console.log(`✗ ${relativePath}\n    ${message}\n`);
      continue;
    }

    for (const doc of docs) {
      // One source file can yield several documents (a thread export holds many
      // conversations), so the stored path is qualified to stay unique.
      const sourcePath = docs.length > 1 ? `${relativePath}#${doc.metadata.externalId ?? doc.title}` : relativePath;

      const chunks = chunkSections(doc.sections);
      const docHash = hashText(chunks.map((chunk) => chunk.contentHash).join(""));
      totalChunks += chunks.length;

      const tokens = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0);
      const largest = chunks.reduce((max, chunk) => Math.max(max, estimateTokens(chunk.content)), 0);

      console.log(`• ${sourcePath}`);
      console.log(`    title      ${doc.title}`);
      console.log(`    market     ${doc.market} (${marketLabel(doc.market)})`);
      console.log(`    sections   ${doc.sections.length}`);
      console.log(`    chunks     ${chunks.length}  ~${tokens} tokens, largest ~${largest}`);

      if (chunks.length === 0) {
        problems.push(`${sourcePath}: produced no chunks`);
        console.log(`    ⚠ produced no chunks — check the parser output for this file\n`);
        continue;
      }

      if (args.dryRun) {
        const preview = chunks[0];
        console.log(`    first      ${preview.headingPath || "(no heading)"}`);
        console.log(`               ${preview.content.replace(/\s+/g, " ").slice(0, 160)}…\n`);
        continue;
      }

      const client = supabase!;

      const { data: existing, error: lookupError } = await client
        .from("documents")
        .select("id, content_hash")
        .eq("source_path", sourcePath)
        .maybeSingle();
      if (lookupError) throw new Error(`document lookup failed: ${lookupError.message}`);

      if (existing && existing.content_hash === docHash && !args.force) {
        skipped++;
        console.log(`    → unchanged, skipped\n`);
        continue;
      }

      const { data: upserted, error: upsertError } = await client
        .from("documents")
        .upsert(
          {
            title: doc.title,
            source_path: sourcePath,
            source_type: doc.sourceType,
            market: doc.market,
            content_hash: docHash,
            metadata: doc.metadata,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "source_path" },
        )
        .select("id")
        .single();
      if (upsertError) throw new Error(`document upsert failed: ${upsertError.message}`);

      const documentId = upserted.id as string;

      // Replace the document's chunks wholesale rather than diffing per chunk.
      // Documents here are small (tens of chunks), so reusing embeddings by hash
      // would save a trivial amount of money in exchange for reading 1536-float
      // vectors back out of Postgres and reconciling them. Not a good trade.
      const { error: deleteError } = await client.from("chunks").delete().eq("document_id", documentId);
      if (deleteError) throw new Error(`chunk delete failed: ${deleteError.message}`);

      const embeddings = await embedDocuments(chunks.map((chunk) => chunk.content));
      embeddedChunks += embeddings.length;

      const rows = chunks.map((chunk, i) => ({
        document_id: documentId,
        ord: chunk.ord,
        heading_path: chunk.headingPath || null,
        market: doc.market,
        content: chunk.content,
        content_hash: chunk.contentHash,
        embedding: embeddings[i],
      }));

      // Batch size 25: at 1536-dim vectors that's ~150KB per POST, well under any
      // proxy or Supabase Edge payload cap. Retry with backoff for transient
      // network failures (fetch failed / ECONNRESET / 503).
      for (let i = 0; i < rows.length; i += 25) {
        const batch = rows.slice(i, i + 25);
        let attempt = 0;
        while (true) {
          attempt++;
          try {
            const { error: insertError } = await client.from("chunks").insert(batch);
            if (insertError) throw new Error(insertError.message);
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const retryable = /fetch failed|ECONNRESET|ETIMEDOUT|503|504|network/i.test(message);
            if (!retryable || attempt >= 4) {
              throw new Error(`chunk insert failed at row ${i} (attempt ${attempt}): ${message}`);
            }
            const backoff = 1_000 * attempt;
            console.log(`      insert attempt ${attempt} failed (${message.slice(0, 80)}), retrying in ${backoff}ms`);
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        }
      }

      console.log(`    → indexed ${rows.length} chunks\n`);
    }
  }

  console.log("─".repeat(60));
  console.log(`Chunks produced: ${totalChunks}`);
  if (!args.dryRun) {
    console.log(`Chunks embedded: ${embeddedChunks}`);
    console.log(`Documents skipped (unchanged): ${skipped}`);
  }
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.log(`  - ${problem}`);
  }
  console.log(args.dryRun ? "\nDry run complete. Nothing was written.\n" : "\nIngest complete.\n");
}

main().catch((error) => {
  console.error("\nIngest failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
