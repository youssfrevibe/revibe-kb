/**
 * Retrieval harness. This is the gate before any UI work: if the right passage
 * isn't in the top few here, no amount of prompt or interface work will fix the
 * answer.
 *
 *   npm run query -- "how long is the shipping SLA for Saudi Arabia"
 *   npm run query -- --mode SRC "restocking fee in UAE"
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { hybridSearch } from "../lib/retrieve";
import { isSourceMode, type SourceMode } from "../lib/source-tags";
import { detectMarkets, marketFilterFor, describeRoute } from "../lib/market-detect";

async function main() {
  const argv = process.argv.slice(2);
  let k = 6;
  let mode: SourceMode = "SRC+ALH";
  const words: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--k") k = Number(argv[++i]) || k;
    else if (argv[i] === "--mode") {
      const value = argv[++i];
      if (isSourceMode(value)) mode = value;
    } else words.push(argv[i]);
  }

  const query = words.join(" ").trim();

  if (!query) {
    console.error('Usage: npm run query -- --mode SRC "your question"');
    console.error(`Modes: SRC, SRC+ALH`);
    process.exit(1);
  }

  const detected = detectMarkets(query);
  const filter = marketFilterFor(detected);

  console.log(`\nQuery:  ${query}`);
  console.log(`Route:  ${describeRoute(detected)}`);
  console.log(`Mode:   ${mode}`);
  console.log(`Rerank: ${process.env.RERANK === "1" ? "on" : "off"}\n`);

  const started = Date.now();
  const results = await hybridSearch(query, filter, mode, k);
  const elapsed = Date.now() - started;

  if (results.length === 0) {
    console.log("No results.\n");
    console.log("If this is unexpected, confirm seed:references was run.\n");
    return;
  }

  results.forEach((result, i) => {
    const label = result.refNumber
      ? `${result.sourceTag}-${String(result.refNumber).padStart(4, "0")}`
      : result.sourceTag;
    console.log(`${String(i + 1).padStart(2)}. [${result.score.toFixed(5)}] ${label} · ${result.title} [${result.market}]`);
    console.log(`    /t/${result.threadSlug}`);
    console.log(`    ${result.content.replace(/\s+/g, " ").slice(0, 220)}…`);
    console.log();
  });

  console.log(`${results.length} results in ${elapsed}ms\n`);
}

main().catch((error) => {
  console.error("\nQuery failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
