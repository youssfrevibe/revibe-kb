/**
 * Loads the live-editable master prompt body (Admin ▸ KB AI Brain).
 *
 * The chat route calls getActivePromptBody() on every turn, so this caches the
 * DB read for a short window and always falls back to the code default — a
 * missing row, empty body, or unreachable DB can never take the assistant down.
 *
 * Server-side only (imports the service-role Supabase client).
 */
import { db } from "./supabase";
import { DEFAULT_PROMPT_BODY } from "./prompt";

const CACHE_TTL_MS = 30_000;

let cache: { body: string; at: number } | null = null;

/**
 * The tunable body to feed into systemPrompt(). Returns the saved custom body
 * when one exists and is non-empty, otherwise the code default.
 */
export async function getActivePromptBody(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.body;
  try {
    const { data, error } = await db()
      .from("ai_prompt_config")
      .select("body")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const body = typeof data?.body === "string" && data.body.trim() ? data.body : DEFAULT_PROMPT_BODY;
    cache = { body, at: Date.now() };
    return body;
  } catch {
    // Table missing (pre-migration) or DB hiccup — never block a chat turn.
    return DEFAULT_PROMPT_BODY;
  }
}

/** Drop the cache so the next getActivePromptBody() re-reads from the DB. */
export function clearPromptBodyCache(): void {
  cache = null;
}
