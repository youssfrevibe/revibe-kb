/**
 * Tier taxonomy for the Revibe KB.
 *
 * TR1   Operational ground truth extracted from the live database.
 *       Market configs, claim workflows, shipping carriers, refund formulas,
 *       cancellation policies. Always preferred on factual values.
 *
 * TR2   Reference material. Training PDFs, FAQ scenario resolutions, and
 *       process walkthroughs. The primary answer layer — TR1 backs it up.
 *
 * NEWP  New policy changes taught by admins. Overrides TR1/TR2 on the specific
 *       point it addresses. Surfaced as a mandatory alert in answers.
 *
 * NEWL  Newly learnt corrections from feedback validated by admins. Definitive
 *       for the specific scenario it covers. Surfaced as a mandatory alert.
 *
 * MSTR  Master guideline template. Contains uninterpolated {{PLACEHOLDER}}
 *       tokens — retrieval-excluded by default.
 *
 * Retrieval priority (DB boost order): TR1 > NEWP > NEWL > TR2
 * Answer construction order:           NEWP/NEWL alert → TR2 body → TR1 backing
 */
export type SourceTag = "TR1" | "TR2" | "NEWP" | "NEWL" | "MSTR";

export const SOURCE_TAGS: SourceTag[] = ["TR1", "TR2", "NEWP", "NEWL", "MSTR"];

/**
 * Categorise a document by its path at seed time.
 *
 * Rules:
 * - sources/tr1/**  → TR1
 * - sources/tr2/**  → TR2  (covers both phase1 and phase2 subdirectory)
 * - guidelines.md   → MSTR (retrieval-excluded master template)
 * - everything else → TR2  (safe fallback for reference material)
 *
 * Returns null for documents that should not become reference threads at all.
 */
export function sourceTagFor(filePath: string): SourceTag | null {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  // Paths are stored relative to sources/ so they start with "tr1/" or "tr2/".
  // Using includes("tr1/") catches both "tr1/..." and nested ".../tr1/..." forms.
  if (p.includes("tr1/")) return "TR1";
  if (p.includes("tr2/")) return "TR2";
  if (p.endsWith("guidelines.md")) return "MSTR";
  return "TR2";
}
