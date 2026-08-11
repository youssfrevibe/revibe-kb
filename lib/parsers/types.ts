import type { Market } from "../markets";

/** A logical section of a document, already grouped under its heading trail. */
export type Section = {
  /** e.g. "General Support Guidelines › Shipping SLA Check" */
  headingPath: string;
  text: string;
};

export type ParsedDoc = {
  title: string;
  market: Market;
  sourceType: "md" | "pdf" | "docx" | "pptx" | "thread";
  metadata: Record<string, unknown>;
  sections: Section[];
};

export type Parser = {
  name: string;
  extensions: string[];
  parse(absolutePath: string, filename: string): Promise<ParsedDoc[]>;
};
