/**
 * Retrieval regression harness. Reports hit-rate@k over evals/questions.md.
 *
 *   npm run eval
 *   npm run eval -- --k 3
 *   RERANK=1 npm run eval
 *
 * Run this after any change to chunking, embedding, or the retrieval SQL. A
 * chunking tweak that helps one question often quietly breaks three others, and
 * this is the only thing that catches that.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFile } from "node:fs/promises";
import { hybridSearch } from "../lib/retrieve";
import { isMarket, type Market } from "../lib/markets";
import { db } from "../lib/supabase";

type Case = { market: Market; question: string; expect: string };

async function loadCases(path: string): Promise<Case[]> {
  const raw = await readFile(path, "utf8");
  const cases: Case[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("    ")) continue;

    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length !== 3) continue;

    const [market, question, expect] = parts;
    if (!isMarket(market) || !question || !expect) continue;

    cases.push({ market, question, expect });
  }

  return cases;
}

async function main() {
  const argv = process.argv.slice(2);
  let k = 6;
  let file = "evals/questions.md";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--k") k = Number(argv[++i]) || k;
    else if (argv[i] === "--file") file = argv[++i] ?? file;
  }

  const cases = await loadCases(file);
  if (cases.length === 0) {
    console.error(`No valid cases found in ${file}.`);
    process.exit(1);
  }

  console.log(`\nCases:  ${cases.length}`);
  console.log(`k:      ${k}`);
  console.log(`Rerank: ${process.env.RERANK === "1" ? "on" : "off"}\n`);

  let hits = 0;
  const misses: { c: Case; got: string[] }[] = [];

  for (const testCase of cases) {
    let results;
    try {
      // Eval runs across all tiers so any correctly-tagged reference
      // qualifies as a hit. The test case's declared market is passed as a
      // filter directly instead of relying on auto-detection — that way the
      // regression harness tests retrieval even when a question doesn't name
      // its country, which is common in short prompts.
      results = await hybridSearch(testCase.question, [testCase.market], k);
    } catch (error) {
      console.error(`\nRetrieval threw on "${testCase.question}":`);
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }

    // Fetch original document source paths for the retrieved messages
    const messageIds = results.map((r) => r.messageId);
    let sourcePaths: string[] = [];
    if (messageIds.length > 0) {
      const { data: sourceRows } = await db()
        .from("message_sources")
        .select(`
          chunk:chunks (
            document:documents (
              source_path
            )
          )
        `)
        .in("message_id", messageIds);

      sourcePaths = (sourceRows ?? [])
        .map((row: any) => row.chunk?.document?.source_path as string)
        .filter(Boolean);
    }

    const needle = testCase.expect.toLowerCase();
    // A hit matches if the expected substring is found in the thread title,
    // or if it matches the original document's source path.
    const hit =
      results.some((result) => result.title.toLowerCase().includes(needle)) ||
      sourcePaths.some((path) => path.toLowerCase().includes(needle));

    if (hit) {
      hits++;
      console.log(`  ✓ [${testCase.market}] ${testCase.question}`);
    } else {
      const got = results.slice(0, 3).map((result) => result.title);
      misses.push({ c: testCase, got });
      console.log(`  ✗ [${testCase.market}] ${testCase.question}`);
    }
  }

  const rate = ((hits / cases.length) * 100).toFixed(1);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`hit-rate@${k}: ${hits}/${cases.length}  (${rate}%)`);

  if (misses.length > 0) {
    console.log(`\nMisses:`);
    for (const miss of misses) {
      console.log(`\n  [${miss.c.market}] ${miss.c.question}`);
      console.log(`    expected a source containing: ${miss.c.expect}`);
      console.log(`    top 3 were:`);
      for (const path of miss.got) console.log(`      - ${path}`);
    }
    console.log();
  } else {
    console.log("\nAll cases passed.\n");
  }
}

main().catch((error) => {
  console.error("\nEval failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
