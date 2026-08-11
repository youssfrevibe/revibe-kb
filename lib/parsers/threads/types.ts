export type Turn = {
  speaker: string;
  /** "customer" when the speaker is the person asking, "agent" otherwise. */
  side: "customer" | "agent";
  text: string;
  at?: string;
};

export type ImportedThread = {
  /** Stable id from the source system, used to avoid re-importing duplicates. */
  externalId: string;
  title: string;
  turns: Turn[];
  resolution?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Adapter contract for importing existing conversations as source material.
 *
 * The export format is not known yet, so this is the seam: adding WhatsApp,
 * Slack, or a helpdesk CSV later means writing one file implementing this and
 * adding it to the registry in ./index.ts. Nothing else in the pipeline changes —
 * imported threads become `documents` with source_type 'thread' and flow through
 * the same chunking and embedding path as every other source.
 */
export type ThreadAdapter = {
  name: string;
  /** File extensions this adapter can even attempt. */
  extensions: string[];
  /** Cheap sniff on the first ~2KB. Return false unless reasonably confident. */
  detect(filename: string, sample: string): boolean;
  parse(raw: string, filename: string): ImportedThread[];
};
