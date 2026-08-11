/**
 * Single source of truth for market codes.
 *
 * The compiled guideline files are near-identical apart from interpolated values
 * (shipping SLA, support phone, restocking fee, domain), so `market` is a hard
 * filter on every retrieval rather than something similarity search is asked to
 * figure out. Ingest, the chat API, and the UI all read from here.
 */

export const MARKETS = {
  uae: { label: "United Arab Emirates", short: "UAE", answering: true },
  ksa: { label: "Saudi Arabia", short: "KSA", answering: true },
  ph: { label: "Philippines", short: "PH", answering: true },
  hk: { label: "Hong Kong", short: "HK", answering: true },
  th: { label: "Thailand", short: "TH", answering: true },
  za: { label: "South Africa", short: "ZA", answering: true },
  global: { label: "Global training material", short: "Global", answering: true },
  // guidelines.md still contains {{PLACEHOLDER}} tokens. Answering from it would
  // leak "{{SHIPPING_SLA}}" into replies, so it is opt-in only and clearly
  // labelled as internal.
  master: { label: "Master template (internal)", short: "Master", answering: false },
} as const;

export type Market = keyof typeof MARKETS;

export const MARKET_CODES = Object.keys(MARKETS) as Market[];

/** Markets a user may pick when asking a question. */
export const ANSWERING_MARKETS = MARKET_CODES.filter((m) => MARKETS[m].answering);

export function isMarket(value: string): value is Market {
  return value in MARKETS;
}

export function marketLabel(value: string): string {
  return isMarket(value) ? MARKETS[value].label : value;
}

/**
 * Infer the market from a source filename, e.g. `uae_guidelines.md` -> `uae`.
 * `guidelines.md` (no prefix) is the master template. Anything else defaults to
 * `global`, which is where the training PDFs land unless a filename says otherwise.
 */
export function marketFromFilename(filename: string): Market {
  const base = filename.toLowerCase().replace(/\\/g, "/").split("/").pop() ?? "";

  if (base === "guidelines.md") return "master";

  const prefix = base.split(/[_\-. ]/)[0];
  if (isMarket(prefix) && prefix !== "master" && prefix !== "global") return prefix;

  return "global";
}
