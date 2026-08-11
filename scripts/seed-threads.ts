/**
 * Seed the Threads archive with realistic support questions.
 *
 * Every question below maps to something that's actually in the indexed material —
 * a per-market guideline (G01..G36), a training-deck topic, or a master-template
 * question. Each becomes a saved thread with its own /t/[slug] URL and its own
 * Sources block, so the archive is populated the day it launches.
 *
 * Sequential, with concurrency of 3. That's plenty on a paid Gemini key without
 * risking rate-limit noise, and it keeps the log readable.
 *
 * Re-runs are idempotent: threads are keyed on (market, title), so re-running
 * skips anything already seeded rather than duplicating it. Use --force to
 * re-seed anyway (creates duplicates — you probably want to DELETE first).
 *
 *   npm run seed:threads
 *   npm run seed:threads -- --limit 20        stop early
 *   npm run seed:threads -- --only uae        one market
 *   npm run seed:threads -- --base http://localhost:3000
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createClient } from "@supabase/supabase-js";
import { ANSWERING_MARKETS, MARKETS, type Market } from "../lib/markets";
import { titleFromQuestion } from "../lib/slug";

type Job = { market: Market; question: string };

// ---------------------------------------------------------------------------
// The question bank
// ---------------------------------------------------------------------------

/**
 * Universal support scenarios. Each will be asked once per answering market so
 * the archive shows how the same question resolves differently in each market's
 * policy. This is the point of the archive existing — market comparison at a
 * glance.
 */
const PER_MARKET_QUESTIONS: string[] = [
  // Shipping & delivery
  "Customer is asking when their order will arrive. What do I check first?",
  "Order is still within the standard shipping SLA — how do I respond?",
  "Order is past the shipping SLA. What should I say?",
  "Customer wants a specific delivery time. What can I promise?",
  "Customer wants to update the delivery address on an existing order.",
  "How long is the standard shipping window in this market?",

  // Order lookup & problems
  "Customer gave me an order number but the API returns no order found.",
  "Order number starts with a foreign prefix (SA-, PH-, HK-, TH-, ZA-). What now?",
  "Customer has asked twice and can't give me a valid order number.",
  "How do I check the status of an order?",

  // Cancellation & fees
  "Customer wants to cancel their order — is there a fee?",
  "Customer is asking about order cancellation fees.",
  "Change of mind return — what's the restocking fee?",

  // Claims
  "Customer says their claim hasn't shipped back yet. What are the SLAs?",
  "How do I look up the status of an existing claim?",
  "I've tried twice and still can't find the claim in the system.",

  // Devices & warranty
  "Customer wants to know if their device is still under warranty.",
  "Customer asking about the cosmetic grades (Premium, Excellent, Very Good).",
  "Customer wants clarification on what 'new device' means at Revibe.",
  "Device arrived with a cracked screen within 24 hours of delivery.",

  // Payments
  "Customer's installment payment was rejected. What do I tell them?",
  "Customer is asking about paying in installments.",

  // Discounts & credit
  "Customer is asking for a promo code or discount.",
  "Customer wants to know their cashback or store credit balance.",

  // Selling & exchange
  "Customer wants to exchange their old device or sell it to Revibe.",
  "How does the buyback flow work for the customer?",

  // Documents
  "Customer needs an invoice or receipt for a completed order.",

  // Escalation
  "When exactly should I transfer this to a human agent?",
  "Customer explicitly asked for a human. What do I do on the website channel?",
  "Customer references a human agent's name in a new email thread.",
  "Support hours — when can a human agent reach out?",
];

/** Global training material (the PDFs) — one archive per topic. */
const GLOBAL_QUESTIONS: string[] = [
  "How should an inbound agent open a customer call?",
  "What's the full end-to-end claim lifecycle at Revibe?",
  "What SLAs apply to each stage of the claim process?",
  "How do we handle high courier charges for remote delivery areas?",
  "How does a buyback request move from creation to completion?",
  "How do social media tickets get triaged and routed?",
  "What's the escalation matrix for the tickets team?",
  "How does the inbound team handle an angry customer?",
  "What does the operations team check before releasing an order?",
  "What are the quality standards for a device before it's shipped?",
  "How is a returned device inspected and re-graded?",
  "How do we verify a customer's identity before making changes to an order?",
];

/**
 * Master template — internal policy design questions only. These are
 * deliberately few because master content shouldn't be quoted to customers
 * (uninterpolated tokens would leak), so the archive doesn't need much of it.
 */
const MASTER_QUESTIONS: string[] = [
  "Which guidelines require transfer to a human agent?",
  "What does guideline G12 (Order Status Lookup) cover?",
  "How is conversational state preserved when a customer uses numeric buttons?",
  "What's the difference between an 'answering' guideline and a 'human_transfer' guideline?",
  "Which guidelines apply when the customer's order number can't be found?",
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Args = { base: string; limit: number | null; only: Market | null; force: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { base: "http://localhost:3000", limit: null, only: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i] ?? args.base;
    else if (arg === "--limit") args.limit = Number(argv[++i]) || null;
    else if (arg === "--only") {
      const value = argv[++i];
      if (value && ANSWERING_MARKETS.includes(value as Market)) args.only = value as Market;
    } else if (arg === "--force") args.force = true;
  }
  return args;
}

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  for (const market of ANSWERING_MARKETS) {
    if (market === "global") continue;
    for (const question of PER_MARKET_QUESTIONS) jobs.push({ market, question });
  }
  for (const question of GLOBAL_QUESTIONS) jobs.push({ market: "global", question });
  for (const question of MASTER_QUESTIONS) jobs.push({ market: "master" as Market, question });
  return jobs;
}

/**
 * Fetch existing (market, title) pairs so re-runs skip anything already seeded.
 * Cheaper than one round-trip per question, and it keeps the log honest.
 */
async function existingTitles(): Promise<Set<string>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Set();

  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await client.from("threads").select("market, title");
  const set = new Set<string>();
  for (const row of (data ?? []) as { market: string; title: string | null }[]) {
    if (row.title) set.add(`${row.market}::${row.title}`);
  }
  return set;
}

type StreamResult = { ok: true; slug: string; answerLength: number } | { ok: false; error: string };

async function ask(base: string, job: Job): Promise<StreamResult> {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: job.question, market: job.market }),
  });

  if (!response.ok || !response.body) {
    let detail = response.statusText;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) detail = payload.error;
    } catch {}
    return { ok: false, error: `HTTP ${response.status}: ${detail}` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let slug = "";
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "meta") slug = event.threadSlug as string;
        else if (event.type === "delta") answer += event.text as string;
        else if (event.type === "error") return { ok: false, error: String(event.message) };
      } catch {
        // ignore unparseable lines — the stream may split mid-token
      }
    }
  }

  return { ok: true, slug, answerLength: answer.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = buildJobs();

  const filtered = all.filter((job) => (args.only ? job.market === args.only : true));

  const skipSet = args.force ? new Set<string>() : await existingTitles();
  const jobs = filtered
    .filter((job) => !skipSet.has(`${job.market}::${titleFromQuestion(job.question)}`))
    .slice(0, args.limit ?? filtered.length);

  const seededPreExisting = filtered.length - jobs.length;

  console.log(`\nSeed target: ${args.base}`);
  console.log(`Question bank: ${all.length}`);
  if (args.only) console.log(`Filter: only ${args.only} (${MARKETS[args.only].label})`);
  if (seededPreExisting > 0) console.log(`Already seeded, skipping: ${seededPreExisting}`);
  console.log(`Will submit: ${jobs.length}\n`);

  if (jobs.length === 0) {
    console.log("Nothing to do. Use --force to re-seed anyway.\n");
    return;
  }

  const concurrency = 3;
  let inFlight = 0;
  let cursor = 0;
  let ok = 0;
  let fail = 0;
  const failures: { job: Job; error: string }[] = [];

  await new Promise<void>((resolve) => {
    const tick = () => {
      while (inFlight < concurrency && cursor < jobs.length) {
        const index = cursor++;
        const job = jobs[index];
        inFlight++;
        const started = Date.now();

        void ask(args.base, job).then((result) => {
          const elapsed = ((Date.now() - started) / 1000).toFixed(1);
          const label = `[${String(index + 1).padStart(3)}/${jobs.length}] ${job.market.padEnd(6)}`;
          if (result.ok) {
            ok++;
            console.log(`  ✓ ${label} ${elapsed}s  /t/${result.slug}  ${job.question}`);
          } else {
            fail++;
            failures.push({ job, error: result.error });
            console.log(`  ✗ ${label} ${elapsed}s  ${result.error}`);
          }
          inFlight--;
          if (cursor >= jobs.length && inFlight === 0) resolve();
          else tick();
        });
      }
    };
    tick();
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Seeded: ${ok}   Failed: ${fail}`);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const failure of failures) {
      console.log(`  [${failure.job.market}] ${failure.job.question}`);
      console.log(`    ${failure.error}`);
    }
    console.log();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
