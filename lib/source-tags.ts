/**
 * Which pool a document lives in for retrieval and citation display.
 *
 * SRC   Training PDFs and the public help center (customer-facing FAQ). This is
 *       what staff quote from directly.
 * ALH   Alhena — the customer-facing AI bot's per-market guideline files. These
 *       are internal action plans and drive procedure but shouldn't be pasted
 *       verbatim to customers.
 * MSTR  The master guideline template (guidelines.md). Contains uninterpolated
 *       {{PLACEHOLDER}} tokens so it's kept out of user-facing retrieval by
 *       default.
 */
export type SourceTag = "SRC" | "ALH" | "MSTR";

export const SOURCE_TAGS: SourceTag[] = ["SRC", "ALH", "MSTR"];

/** The two retrieval modes the UI exposes. */
export type SourceMode = "SRC" | "SRC+ALH";

export const SOURCE_MODES: SourceMode[] = ["SRC", "SRC+ALH"];

export function tagsForMode(mode: SourceMode): SourceTag[] {
  return mode === "SRC" ? ["SRC"] : ["SRC", "ALH"];
}

export function isSourceMode(value: unknown): value is SourceMode {
  return value === "SRC" || value === "SRC+ALH";
}

/** Human labels for the mode pill. */
export const SOURCE_MODE_LABEL: Record<SourceMode, string> = {
  SRC: "SRC only",
  "SRC+ALH": "SRC + ALH",
};

/**
 * Categorise a document by its type and filename. Called once at seed time to
 * decide which pool the resulting reference thread joins.
 *
 * The rules follow content, not extension:
 * - PDFs are training material, always SRC.
 * - The help center file is scraped public FAQ, still SRC even though it's .md.
 * - guidelines.md is the master template — MSTR, retrieval-excluded by default.
 * - Any other .md file is a compiled country guideline, ALH.
 *
 * Returns null for anything that doesn't fit — those documents don't get
 * reference threads.
 */
export function sourceTagFor(sourceType: string, sourcePath: string): SourceTag | null {
  const filename = sourcePath.split("/").pop()?.toLowerCase() ?? "";

  if (sourceType === "pdf") return "SRC";
  if (filename.includes("help_center") || filename.includes("help-center")) return "SRC";
  if (filename === "guidelines.md") return "MSTR";
  if (sourceType === "md") return "ALH";

  return null;
}
