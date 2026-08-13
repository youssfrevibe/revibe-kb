/**
 * The only place the Gemini API is touched.
 *
 * Models are pinned here so a model change is a one-line edit rather than a
 * grep across the codebase.
 */
import { GoogleGenAI } from "@google/genai";

export const EMBED_MODEL = "gemini-embedding-001";
export const ANSWER_MODEL = "gemini-2.5-flash";
export const UTILITY_MODEL = "gemini-2.5-flash-lite";

/**
 * gemini-embedding-001 emits 3072 dimensions, but pgvector's HNSW index caps at
 * 2000. The model supports Matryoshka truncation, so we ask for 1536: a real
 * HNSW index, half the storage, no meaningful quality loss.
 */
export const EMBED_DIMS = 1536;

/** Embedding requests per batch. The API accepts up to 100 inputs per call. */
const EMBED_BATCH_SIZE = 100;

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Truncated Matryoshka embeddings come back un-normalised, unlike the full 3072
 * ones. Cosine distance in pgvector assumes nothing about magnitude, but an
 * un-normalised vector makes `<=>` results inconsistent with the dot-product
 * shortcuts and skews comparisons between vectors of differing length. Cheap to
 * fix, easy to forget, so it happens here for every embedding we produce.
 */
function normalise(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return values;
  return values.map((v) => v / norm);
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /429|500|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed|ETIMEDOUT/i.test(message);
      if (!retryable || attempt === attempts) break;
      const backoff = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      console.warn(`  ${label}: attempt ${attempt} failed (${message.slice(0, 120)}), retrying in ${backoff}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}

type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

async function embed(texts: string[], taskType: EmbedTask): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await withRetry(
      () =>
        ai().models.embedContent({
          model: EMBED_MODEL,
          contents: batch,
          config: { outputDimensionality: EMBED_DIMS, taskType },
        }),
      `embed batch ${i / EMBED_BATCH_SIZE + 1}`,
    );

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding count mismatch: asked for ${batch.length}, got ${embeddings.length}`);
    }
    for (const item of embeddings) {
      if (!item.values) throw new Error("Embedding response contained no values");
      out.push(normalise(item.values));
    }
  }

  return out;
}

/**
 * Embed chunks for storage. Uses RETRIEVAL_DOCUMENT, which is asymmetric with
 * the query task type below — that asymmetry is what makes retrieval work well,
 * so the two must not be collapsed into one function.
 */
export function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, "RETRIEVAL_DOCUMENT");
}

/** Embed a user question for searching. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embed([text], "RETRIEVAL_QUERY");
  return vector;
}

/** Non-streaming call, for short utility work like query rewriting. */
export async function generateText(args: {
  prompt: string;
  system?: string;
  model?: string;
  maxOutputTokens?: number;
}): Promise<string> {
  const response = await withRetry(
    () =>
      ai().models.generateContent({
        model: args.model ?? UTILITY_MODEL,
        contents: args.prompt,
        config: {
          systemInstruction: args.system,
          temperature: 0,
          maxOutputTokens: args.maxOutputTokens ?? 256,
        },
      }),
    "generateText",
  );
  return (response.text ?? "").trim();
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Stream a grounded answer. Yields text deltas. */
export async function* streamAnswer(args: {
  system: string;
  turns: ChatTurn[];
  maxOutputTokens?: number;
}): AsyncGenerator<string> {
  const stream = await withRetry(
    () =>
      ai().models.generateContentStream({
        model: ANSWER_MODEL,
        contents: args.turns.map((turn) => ({
          // Gemini calls the assistant role "model".
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.content }],
        })),
        config: {
          systemInstruction: args.system,
          // Near-zero: this is a policy lookup, not creative writing. Support
          // answers about SLAs and fees must be reproducible.
          temperature: 0.1,
          // gemini-2.5-flash "thinks" by default and those thinking tokens count
          // against maxOutputTokens — with a modest cap the visible answer gets
          // truncated mid-sentence. This is a grounded lookup, not a reasoning
          // task, so disable thinking and give the answer the full budget.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: args.maxOutputTokens ?? 3072,
        },
      }),
    "streamAnswer",
  );

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}
