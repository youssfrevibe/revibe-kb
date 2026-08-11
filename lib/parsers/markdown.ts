import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { marketFromFilename } from "../markets";
import type { Parser, ParsedDoc, Section } from "./types";

/**
 * Sections break at h1–h3 only. In the Revibe guideline files an h3 is one whole
 * guideline, while h4 marks its "Trigger Condition(s)" and "Action(s)" parts —
 * splitting there would separate a trigger from the action it triggers, which is
 * the one pairing a reader always needs together. So h4 and deeper stay inline
 * as part of the section body.
 */
const MAX_HEADING_DEPTH = 3;

export const markdownParser: Parser = {
  name: "markdown",
  extensions: [".md", ".markdown", ".txt"],

  async parse(absolutePath, filename) {
    const raw = await readFile(absolutePath, "utf8");
    const lines = raw.split(/\r?\n/);

    let title = basename(filename).replace(/\.(md|markdown|txt)$/i, "");
    const trail: string[] = []; // heading text by depth, index 0 = h1
    const sections: Section[] = [];
    let buffer: string[] = [];
    let inFence = false;

    const headingPath = () =>
      // h1 is the document title, already stored separately, so the path shown
      // with a passage starts at h2.
      trail.slice(1).filter(Boolean).join(" › ");

    const flush = () => {
      const text = buffer.join("\n").trim();
      buffer = [];
      if (!text) return;
      sections.push({ headingPath: headingPath(), text });
    };

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        buffer.push(line);
        continue;
      }

      // A "#" inside a fenced block is content, not a heading.
      const heading = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);

      if (heading) {
        const depth = heading[1].length;
        const text = heading[2].trim();

        if (depth === 1) {
          flush();
          title = text;
          trail.length = 0;
          trail[0] = text;
          continue;
        }

        if (depth <= MAX_HEADING_DEPTH) {
          flush();
          trail[depth - 1] = text;
          trail.length = depth; // drop any deeper trail from the previous branch
          continue;
        }

        // h4+ : keep the label in the body so the structure survives.
        buffer.push(`${text}:`);
        continue;
      }

      // Horizontal rules are visual separators between guidelines; they add
      // nothing to an embedding.
      if (!inFence && /^\s*([-*_])\1{2,}\s*$/.test(line)) continue;

      buffer.push(line);
    }

    flush();

    const market = marketFromFilename(filename);

    return [
      {
        title,
        market,
        sourceType: "md",
        metadata: { sectionCount: sections.length },
        sections: sections.filter((section) => section.text.replace(/\s/g, "").length > 40),
      } satisfies ParsedDoc,
    ];
  },
};
