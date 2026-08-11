import { basename } from "node:path";
import type { ThreadAdapter, ImportedThread, Turn } from "./types";

// Matches the common export shapes:
//   [15/01/2024, 10:32:11] Name: message      (WhatsApp, bracketed)
//   15/01/2024, 10:32 - Name: message         (WhatsApp, dashed)
//   Name: message                             (plain log)
const BRACKETED = /^\[([^\]]+)\]\s*([^:]{1,60}):\s*(.*)$/;
const DASHED = /^(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\s+-\s+([^:]{1,60}):\s*(.*)$/;
const PLAIN = /^([A-Za-z][^:]{0,59}):\s*(.*)$/;

/**
 * One chat log file becomes one thread. Lines that don't start a new turn are
 * appended to the previous one, which is how multi-line messages appear in every
 * export format we've seen.
 *
 * Speaker side is guessed from the name. That guess is the weak point: verify it
 * with `--dry-run` on a real export and add an explicit agent-name list here if
 * the heuristic mislabels your team.
 */
export const chatLogAdapter: ThreadAdapter = {
  name: "chat-log",
  extensions: [".txt", ".log", ".md"],

  detect(_filename, sample) {
    const lines = sample.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 3) return false;
    const matching = lines.filter(
      (line) => BRACKETED.test(line) || DASHED.test(line) || PLAIN.test(line),
    ).length;
    // Most lines looking like "Speaker: text" is a strong enough signal.
    return matching / lines.length > 0.6;
  },

  parse(raw, filename): ImportedThread[] {
    const turns: Turn[] = [];

    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;

      const match = BRACKETED.exec(line) ?? DASHED.exec(line);
      let speaker: string | null = null;
      let text = "";
      let at: string | undefined;

      if (match) {
        at = match[1].trim();
        speaker = match[2].trim();
        text = match[3];
      } else {
        const plain = PLAIN.exec(line);
        if (plain) {
          speaker = plain[1].trim();
          text = plain[2];
        }
      }

      if (speaker === null) {
        // Continuation of the previous message.
        if (turns.length > 0) turns[turns.length - 1].text += `\n${line.trim()}`;
        continue;
      }

      if (!text.trim()) continue;

      turns.push({
        speaker,
        side: /agent|support|revibe|admin|team|bot/i.test(speaker) ? "agent" : "customer",
        text: text.trim(),
        at,
      });
    }

    if (turns.length === 0) return [];

    const name = basename(filename).replace(/\.[^.]+$/, "");
    return [
      {
        externalId: name,
        title: turns.find((turn) => turn.side === "customer")?.text.slice(0, 80) ?? name,
        turns,
        metadata: { adapter: "chat-log" },
      },
    ];
  },
};
