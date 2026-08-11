import { extname } from "node:path";
import type { Parser } from "./types";
import { markdownParser } from "./markdown";
import { pdfParser } from "./pdf";
import { threadParser } from "./threads";

export type { Parser, ParsedDoc, Section } from "./types";

const PARSERS: Parser[] = [markdownParser, pdfParser];

/**
 * Pick a parser for a source file.
 *
 * Anything under a `threads/` directory goes to the thread parser regardless of
 * extension — a .md chat export is a conversation, not a document, and needs
 * exchange-based chunking rather than heading-based.
 */
export function parserFor(relativePath: string): Parser | null {
  const normalised = relativePath.replace(/\\/g, "/");
  if (/(^|\/)threads\//i.test(normalised)) return threadParser;

  const ext = extname(normalised).toLowerCase();
  return PARSERS.find((parser) => parser.extensions.includes(ext)) ?? null;
}

export const SUPPORTED_EXTENSIONS = Array.from(
  new Set([...PARSERS.flatMap((p) => p.extensions), ...threadParser.extensions]),
);
