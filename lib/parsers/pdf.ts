import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { marketFromFilename } from "../markets";
import type { Parser, ParsedDoc, Section } from "./types";

/**
 * The Revibe training PDFs are exported slide decks, so one page is one slide
 * and pages are the natural section boundary. The first non-empty line of a page
 * is almost always the slide title, which makes a serviceable heading.
 *
 * Slide-deck text extraction is the lowest-fidelity input in the pipeline —
 * always eyeball `npm run ingest -- --dry-run` output for these before trusting
 * retrieval over them.
 */
export const pdfParser: Parser = {
  name: "pdf",
  extensions: [".pdf"],

  async parse(absolutePath, filename) {
    const { extractText, getDocumentProxy } = await import("unpdf");

    const buffer = await readFile(absolutePath);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text: pages } = await extractText(pdf, { mergePages: false });

    const sections: Section[] = [];

    pages.forEach((pageText, index) => {
      const cleaned = pageText
        .replace(/ /g, " ")
        // Icon fonts in these decks map into the Unicode Private Use Area and
        // extract as junk glyphs ("REVIBE CUSTOMER CARE" picking up stray
        // symbols). Only the PUA is stripped, so real non-Latin text (Arabic,
        // Thai) survives untouched.
        .replace(/[\u{E000}-\u{F8FF}]/gu, "")
        .replace(/[\u{F0000}-\u{FFFFD}]/gu, "")
        // Slide extraction leaves runs of spaces where layout columns were.
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (cleaned.replace(/\s/g, "").length < 40) return; // title-only or empty slide

      const firstLine = cleaned.split("\n").find((line) => line.trim().length > 0) ?? "";
      const slideTitle = firstLine.trim().slice(0, 80);
      const pageLabel = `Page ${index + 1}`;

      sections.push({
        headingPath: slideTitle && slideTitle.length > 3 ? `${pageLabel} › ${slideTitle}` : pageLabel,
        text: cleaned,
      });
    });

    return [
      {
        title: basename(filename).replace(/\.pdf$/i, "").trim(),
        market: marketFromFilename(filename),
        sourceType: "pdf",
        metadata: { pageCount: pages.length, sectionCount: sections.length },
        sections,
      } satisfies ParsedDoc,
    ];
  },
};
