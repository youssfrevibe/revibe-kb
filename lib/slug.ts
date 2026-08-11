import { randomBytes } from "node:crypto";

// Unambiguous alphabet: no 0/O/1/l/I, so slugs survive being read aloud or
// copied out of a chat message.
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

/** Short, URL-safe thread id used in /t/[slug]. */
export function newSlug(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** First line of a question, trimmed to something that fits a list row. */
export function titleFromQuestion(question: string, max = 80): string {
  const line = question.trim().split("\n")[0].trim();
  if (line.length <= max) return line;
  return line.slice(0, max - 1).trimEnd() + "…";
}
