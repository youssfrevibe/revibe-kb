import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { marketFromFilename } from "../../markets";
import type { Parser, ParsedDoc, Section } from "../types";
import type { ImportedThread, ThreadAdapter, Turn } from "./types";
import { canonicalJsonAdapter } from "./canonical-json";
import { chatLogAdapter } from "./chat-log";

/**
 * Adapter registry. Order matters: the first adapter whose `detect` returns true
 * wins, so put specific formats above general ones. Add new formats here.
 */
export const THREAD_ADAPTERS: ThreadAdapter[] = [canonicalJsonAdapter, chatLogAdapter];

export type { ImportedThread, ThreadAdapter, Turn } from "./types";

/**
 * Group turns into question → resolution exchanges.
 *
 * This is the whole reason threads aren't chunked like documents: an agent's
 * reply is meaningless without the question that prompted it, and a question is
 * useless without its answer. One exchange is one retrievable unit of "this came
 * up before, here's what we said".
 */
function toExchanges(thread: ImportedThread): Section[] {
  const sections: Section[] = [];
  let current: Turn[] = [];
  let index = 0;

  const flush = () => {
    if (current.length === 0) return;
    const hasCustomer = current.some((turn) => turn.side === "customer");
    const hasAgent = current.some((turn) => turn.side === "agent");
    // A question with no answer teaches nothing; an answer with no question
    // can't be matched to anything. Keep only complete exchanges.
    if (hasCustomer && hasAgent) {
      index += 1;
      const body = current.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
      sections.push({
        headingPath: `${thread.title} › Exchange ${index}`,
        text: body,
      });
    }
    current = [];
  };

  for (const turn of thread.turns) {
    // A new customer turn after we've already heard from an agent starts a new
    // exchange.
    if (turn.side === "customer" && current.some((t) => t.side === "agent")) flush();
    current.push(turn);
  }
  flush();

  if (thread.resolution?.trim()) {
    sections.push({
      headingPath: `${thread.title} › Resolution`,
      text: thread.resolution.trim(),
    });
  }

  return sections;
}

/**
 * Parses files under sources/threads/ using the adapter registry. Each imported
 * thread becomes its own document so it can be cited and audited individually.
 */
export const threadParser: Parser = {
  name: "thread",
  extensions: [".json", ".txt", ".log", ".csv", ".md"],

  async parse(absolutePath, filename) {
    const raw = await readFile(absolutePath, "utf8");
    const sample = raw.slice(0, 2048);
    const ext = extname(filename).toLowerCase();

    const adapter = THREAD_ADAPTERS.find(
      (candidate) => candidate.extensions.includes(ext) && candidate.detect(filename, sample),
    );

    if (!adapter) {
      throw new Error(
        `No thread adapter matched ${filename}. Registered: ${THREAD_ADAPTERS.map((a) => a.name).join(", ")}. ` +
          `Either convert it to the canonical JSON shape (see lib/parsers/threads/canonical-json.ts) ` +
          `or add an adapter for this format.`,
      );
    }

    const threads = adapter.parse(raw, filename);
    const market = marketFromFilename(filename);

    return threads.flatMap((thread): ParsedDoc[] => {
      const sections = toExchanges(thread);
      if (sections.length === 0) return [];
      return [
        {
          title: thread.title,
          market,
          sourceType: "thread",
          metadata: {
            ...thread.metadata,
            externalId: thread.externalId,
            adapter: adapter.name,
            turnCount: thread.turns.length,
          },
          sections,
        },
      ];
    });
  },
};
