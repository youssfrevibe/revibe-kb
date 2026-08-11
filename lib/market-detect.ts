import type { Market } from "./markets";

/**
 * Detect which market(s) a question is asking about, from its text alone.
 *
 * The country picker is gone from the UI — every question runs through this
 * function to work out which market's data should filter retrieval. Design:
 *
 *  - single country mentioned → filter to that market + global material
 *  - multiple countries mentioned → search all markets + global (comparison
 *    questions; the model sees both sides and can quote each accurately)
 *  - no country mentioned → return an empty list, and the caller falls back
 *    to global-only (training PDFs + help center — the cross-market pool
 *    that never quotes a country-specific number)
 *
 * Detection is a set of hand-curated patterns for the six markets. It's
 * intentionally conservative on the two-letter codes (TH, PH) because those
 * are common English fragments; the codes only count when they look like an
 * order prefix (e.g. `SA-42`, `TH-1023`) or appear in ALL CAPS in a way that
 * suggests a market abbreviation.
 */

type Pattern = { market: Market; regex: RegExp };

// Regex uses `\b` word boundaries throughout so mid-word matches don't fire.
// Note the `i` flag on all — patterns match case-insensitively.
const PATTERNS: Pattern[] = [
  // United Arab Emirates
  { market: "uae", regex: /\b(united arab emirates|emirates|u\.?a\.?e\.?|dubai|abu dhabi|sharjah|ajman|fujairah)\b/i },

  // Saudi Arabia — accept the country name, KSA code, city names, and the
  // "SA-" order prefix. Naked "saudi" is enough on its own.
  { market: "ksa", regex: /\b(saudi arabia|saudi|k\.?s\.?a\.?|riyadh|jeddah|dammam|mecca|makkah|madinah)\b/i },
  { market: "ksa", regex: /\bSA\b/ }, // case-sensitive naked code

  // Philippines — "PH" as an all-caps code only (avoids "pH" chemistry
  // false-positives, which are unlikely in this domain but cheap to guard
  // against).
  { market: "ph", regex: /\b(philippines|philippine|filipino|manila|cebu|davao|quezon|PH)\b/ },

  // Hong Kong — including the naked "HK" code, which is unambiguous in a
  // support context (no common English word is "HK").
  { market: "hk", regex: /\b(hong kong|hk sar|kowloon|hk)\b/i },

  // Thailand — accept "TH" only as an all-caps code so it doesn't fire on
  // things like "th" fragments in the middle of a sentence.
  { market: "th", regex: /\b(thailand|thai|bangkok|phuket|chiang mai|pattaya|TH)\b/ },

  // South Africa — "South Africa" plus the ZA code and major cities.
  {
    market: "za",
    regex: /\b(south africa|south african|cape town|johannesburg|joburg|durban|pretoria|z\.?a\.?)\b/i,
  },
  { market: "za", regex: /\bZA\b/ }, // case-sensitive naked code
];

// Order-number prefixes documented in the Alhena guidelines (SA-, PH-, HK-,
// TH-, ZA-). "SA-" belongs to KSA, not South Africa. Anchoring on a digit
// after the dash rules out real words like "SA-something-random".
// Optional hyphen is allowed to match prefixes with or without hyphen (e.g. SA12345 or SA-12345).
const ORDER_PREFIXES: Pattern[] = [
  { market: "ksa", regex: /\bSA-?\d/i },
  { market: "ph", regex: /\bPH-?\d/i },
  { market: "hk", regex: /\bHK-?\d/i },
  { market: "th", regex: /\bTH-?\d/i },
  { market: "za", regex: /\bZA-?\d/i },
];

/** Returns detected markets in declaration order. Empty if none. */
export function detectMarkets(text: string): Market[] {
  const found = new Set<Market>();
  for (const { market, regex } of PATTERNS) {
    if (regex.test(text)) found.add(market);
  }
  for (const { market, regex } of ORDER_PREFIXES) {
    if (regex.test(text)) found.add(market);
  }
  return [...found];
}

/**
 * The market filter argument for the retrieval RPC.
 *
 * - `null`         → no filter (all markets + global). Used for multi-country
 *                    comparison questions.
 * - `['global']`   → global only. Used when no country was detected.
 * - `['uae']` etc. → market + global (implicit). Used when one country was
 *                    detected.
 */
export type MarketFilter = string[] | null;

export function marketFilterFor(detected: Market[]): MarketFilter {
  if (detected.length === 0) return ["global"];
  if (detected.length === 1) return [detected[0]];
  return null;
}

/** A short human-readable description of the routing decision, for logging. */
export function describeRoute(detected: Market[]): string {
  if (detected.length === 0) return "no country in question — searching global only";
  if (detected.length === 1) return `${detected[0]} detected — searching ${detected[0]} + global`;
  return `multiple markets detected (${detected.join(", ")}) — searching all markets`;
}
