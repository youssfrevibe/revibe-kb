import { createHash } from "node:crypto";
import type { Section } from "./parsers/types";

export type Chunk = {
  ord: number;
  headingPath: string;
  content: string;
  contentHash: string;
};

/**
 * Rough token count. A real tokenizer would be more accurate, but chunk sizing
 * only needs to be approximately right and ~4 chars/token holds well enough for
 * English prose. Not worth a dependency.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TARGET_TOKENS = 800;
const OVERLAP_TOKENS = 100;

function isTableLine(line: string): boolean {
  return line.trimStart().startsWith("|");
}

/**
 * Split a section's text into paragraph-ish blocks that are safe to break
 * between. Markdown tables and fenced code blocks stay whole: half a table has
 * no header row, and half a fenced block loses its context entirely.
 */
function splitIntoBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let inTable = false;

  const flush = () => {
    if (current.length === 0) return;
    const joined = current.join("\n").trim();
    if (joined) blocks.push(joined);
    current = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      // Opening a fence starts a new block; closing one ends it.
      if (!inFence) flush();
      inFence = !inFence;
      current.push(line);
      if (!inFence) flush();
      continue;
    }

    if (inFence) {
      current.push(line);
      continue;
    }

    const tableLine = isTableLine(line);
    if (tableLine && !inTable) {
      flush();
      inTable = true;
    } else if (!tableLine && inTable) {
      flush();
      inTable = false;
    }

    if (!inTable && line.trim() === "") {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

/**
 * Turn sections into embeddable chunks.
 *
 * Sections are the preferred chunk boundary — in the Revibe guideline files one
 * section is one complete guideline (trigger plus action), which is exactly the
 * unit someone asks a question about. A section is only subdivided when it
 * exceeds the target size, and then only between blocks.
 *
 * The heading path is prepended to the stored content on purpose: a chunk is
 * retrieved without its surroundings, so "Shipping SLA Check" needs to travel
 * with the text or the passage reads as unattributed prose.
 */
export function chunkSections(sections: Section[]): Chunk[] {
  const chunks: Chunk[] = [];
  let ord = 0;

  const push = (headingPath: string, body: string) => {
    const content = headingPath ? `${headingPath}\n\n${body.trim()}` : body.trim();
    if (!content.trim()) return;
    chunks.push({
      ord: ord++,
      headingPath,
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
    });
  };

  for (const section of sections) {
    const body = section.text.trim();
    if (!body) continue;

    if (estimateTokens(body) <= TARGET_TOKENS) {
      push(section.headingPath, body);
      continue;
    }

    const blocks = splitIntoBlocks(body);
    let buffer: string[] = [];
    let bufferTokens = 0;

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      push(section.headingPath, buffer.join("\n\n"));

      // Carry the tail of this chunk into the next one so a statement split
      // across the boundary is still retrievable from either side.
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = buffer.length - 1; i >= 0; i--) {
        const tokens = estimateTokens(buffer[i]);
        if (overlapTokens + tokens > OVERLAP_TOKENS) break;
        overlap.unshift(buffer[i]);
        overlapTokens += tokens;
      }
      buffer = overlap;
      bufferTokens = overlapTokens;
    };

    for (const block of blocks) {
      const tokens = estimateTokens(block);

      // A single oversized block (a long table, a big fenced action list) is
      // emitted whole rather than mangled. Better one large passage than a
      // table with no header.
      if (tokens > TARGET_TOKENS) {
        flushBuffer();
        buffer = [];
        bufferTokens = 0;
        push(section.headingPath, block);
        continue;
      }

      if (bufferTokens + tokens > TARGET_TOKENS) flushBuffer();
      buffer.push(block);
      bufferTokens += tokens;
    }

    if (buffer.length > 0) push(section.headingPath, buffer.join("\n\n"));
  }

  return chunks;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
