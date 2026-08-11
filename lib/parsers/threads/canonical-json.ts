import type { ThreadAdapter, ImportedThread, Turn } from "./types";

/**
 * The canonical import shape. Anything can be converted into this with a short
 * script, so it doubles as the documented escape hatch when a source system has
 * no dedicated adapter yet.
 *
 * [
 *   {
 *     "externalId": "TKT-1042",
 *     "title": "Refund not received after claim approved",
 *     "resolution": "Refund was reissued to the original card.",
 *     "turns": [
 *       { "speaker": "Customer", "side": "customer", "text": "..." },
 *       { "speaker": "Agent",    "side": "agent",    "text": "..." }
 *     ]
 *   }
 * ]
 */
export const canonicalJsonAdapter: ThreadAdapter = {
  name: "canonical-json",
  extensions: [".json"],

  detect(_filename, sample) {
    const trimmed = sample.trimStart();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;
    return /"turns"\s*:/.test(sample);
  },

  parse(raw, filename) {
    const parsed: unknown = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items.flatMap((item, index): ImportedThread[] => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;

      const rawTurns = Array.isArray(record.turns) ? record.turns : [];
      const turns: Turn[] = rawTurns.flatMap((turn): Turn[] => {
        if (typeof turn !== "object" || turn === null) return [];
        const t = turn as Record<string, unknown>;
        const text = typeof t.text === "string" ? t.text.trim() : "";
        if (!text) return [];
        const speaker = typeof t.speaker === "string" ? t.speaker : "Unknown";
        const side =
          t.side === "customer" || t.side === "agent"
            ? t.side
            : /customer|client|user/i.test(speaker)
              ? "customer"
              : "agent";
        return [{ speaker, side, text, at: typeof t.at === "string" ? t.at : undefined }];
      });

      if (turns.length === 0) return [];

      return [
        {
          externalId:
            typeof record.externalId === "string"
              ? record.externalId
              : `${filename}#${index}`,
          title:
            typeof record.title === "string" && record.title.trim()
              ? record.title.trim()
              : turns[0].text.slice(0, 80),
          turns,
          resolution: typeof record.resolution === "string" ? record.resolution : undefined,
          metadata: { adapter: "canonical-json" },
        },
      ];
    });
  },
};
