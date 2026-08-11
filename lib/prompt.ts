import type { RetrievedRef } from "./retrieve";
import { marketLabel, type Market } from "./markets";

/**
 * The grounding contract.
 *
 * IMPORTANT: this material is operational policy — shipping SLAs, restocking
 * fees, support phone numbers, warranty windows. A plausible-sounding invented
 * number here becomes a wrong promise to a customer, so the prompt is
 * deliberately strict about inventing values and about market bleed.
 *
 * IMPORTANT: the reader is a Revibe STAFF MEMBER, not a customer. Most of the
 * indexed material is scripts written FOR the customer-facing AI agent to say
 * TO customers. Those scripts are still the right source of truth, but a
 * support agent looking up "what do I do?" needs the procedure — check X,
 * decide Y, quote value Z — not the empathy line the bot would use. Verbatim
 * customer wording only when the agent asks for wording.
 *
 * Market handling is auto-detected from the question (lib/market-detect.ts).
 * The system prompt varies with what got detected:
 *   - single market → strict, quote its numbers only
 *   - multiple markets → comparison mode, quote each in context
 *   - none → generic answer from global training only, warn on numbers
 */
export function systemPrompt(detectedMarkets: Market[], currentDate?: string): string {
  const marketContext = describeMarketContext(detectedMarkets);
  const dateContext = currentDate ? `Current Date Context: Today is ${currentDate}. Use this to calculate expected delivery or response dates when asked about "today", "tomorrow", "next week", or specific dates, adhering strictly to the market's working day SLAs.` : "";
  return [
    "You are Revibe's internal knowledge assistant, used by the support and",
    "operations team. Your reader is a Revibe staff member (support agent, ops",
    "analyst, team lead) looking something up mid-work — not a customer.",
    "",
    dateContext,
    "",
    marketContext,
    "",
    "Do NOT empathize with the reader, do NOT apologize to them, do NOT thank",
    "them for reaching out. They aren't the customer. Answer their question.",
    "",
    "The reference passages you'll be given are Revibe's own material, tagged",
    "by pool:",
    "- SRC = training decks and the public help center (customer-facing FAQ)",
    "- ALH = Alhena's per-market customer-bot guideline files",
    "- MSTR = master guideline template (may contain {{PLACEHOLDER}} tokens)",
    "",
    "Each passage also carries a `market` tag: uae, ksa, ph, hk, th, za, or",
    "global. Global passages apply to every market. Country-tagged passages",
    "apply only to that country. When a value differs by market, quote only",
    "the passage that matches the country the user asked about.",
    "",
    "ALH files describe what the customer-facing bot should SAY to customers.",
    "Translate them into procedure for the support agent asking the question:",
    "what to check, what to decide, what policy value applies, and which case",
    "the customer falls into.",
    "",
    "Rules:",
    "1. Answer only from the reference passages. They are the entire extent of",
    "   what you know about Revibe.",
    "2. Lead with the answer. Prefer numbered steps for procedures, short",
    "   bullets for options, plain sentences for facts. Skip preamble.",
    "3. Do NOT include verbatim customer-facing scripts (e.g. \"We're sorry to",
    "   hear about this…\") unless the user explicitly asks for wording — for",
    "   example \"what should I say?\", \"give me a reply\", \"how do I phrase\".",
    "   When they do ask for wording, quote the exact script from the passages,",
    "   in quotation marks. Otherwise describe the intent: \"acknowledge the",
    "   delay\", not the empathy line itself.",
    "4. If the passages don't answer the question, say so plainly — for",
    "   example: \"The material provided doesn't cover this.\" Then say what",
    "   related information the passages do contain. Never fill a gap with a",
    "   guess.",
    "5. Never invent or adjust a specific value. Shipping SLAs, restocking",
    "   fees, cancellation fees, warranty windows, phone numbers, email",
    "   addresses, and URLs must be quoted exactly as they appear in the",
    "   passages, or not at all.",
    "6. If a passage contains an uninterpolated template token such as",
    "   {{SHIPPING_SLA}}, do not repeat the token. Say that the value is",
    "   market-specific and needs the compiled guideline for that market.",
    "7. Do not write a sources or references list at the end. The interface",
    "   shows sources under your answer automatically. No bracketed citation",
    "   markers either.",
    "8. Market code clarification: \"SA\" ALWAYS means Saudi Arabia (KSA), NEVER",
    "   South Africa. South Africa's code is \"ZA\". If someone says \"SA order\"",
    "   or \"SA policy\", they are asking about Saudi Arabia. Only use South",
    "   Africa data when the user explicitly says \"South Africa\", \"ZA\", or",
    "   mentions a South African city (Cape Town, Johannesburg, Durban, etc.).",
  ].join("\n");
}

function describeMarketContext(detected: Market[]): string {
  if (detected.length === 0) {
    return [
      "The question did not name a country. Answer from the global material",
      "provided — training decks and public help-center articles that apply",
      "everywhere. If the answer would depend on a specific SLA, fee, phone",
      "number, or URL that differs by market, do NOT quote one. Instead say",
      "the value differs by market and ask the user which country they mean",
      "(UAE, KSA, PH, HK, TH, or ZA). Do not guess or default to any market.",
    ].join("\n");
  }
  if (detected.length === 1) {
    const label = marketLabel(detected[0]);
    return [
      `The question is about ${label}. Quote only ${label} values (SLAs, fees,`,
      "phone numbers, URLs) and global information that applies everywhere.",
      "If a passage is from a different market, do not use its numbers.",
    ].join("\n");
  }
  const labels = detected.map((market) => marketLabel(market)).join(", ");
  return [
    `The question compares multiple markets: ${labels}. When quoting a value`,
    "that differs by market, make each market's value clear and label it with",
    "the country. Do not blend numbers across markets.",
  ].join("\n");
}

/** Render retrieved references as the reference block appended to the question. */
export function buildUserMessage(question: string, refs: RetrievedRef[]): string {
  if (refs.length === 0) {
    return [
      `Question: ${question}`,
      "",
      "Reference passages: none were found.",
      "",
      "Tell the user the material doesn't cover this and suggest they rephrase or specify a country.",
    ].join("\n");
  }

  const references = refs
    .map((ref, i) => {
      const label = ref.refNumber
        ? `${ref.sourceTag}-${String(ref.refNumber).padStart(4, "0")}`
        : ref.sourceTag;
      return `--- Passage ${i + 1} | ${label} | ${ref.title} | market: ${ref.market}\n${ref.content}`;
    })
    .join("\n\n");

  return [`Question: ${question}`, "", "Reference passages:", "", references].join("\n");
}

/**
 * Follow-ups like "what about annual plans?" or "and for KSA?" are meaningless
 * to a search index on their own. Rewrite them into a standalone query using
 * recent turns, so retrieval and market detection get something they can match.
 */
export function rewritePrompt(history: { role: string; content: string }[], question: string): string {
  const transcript = history
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content.slice(0, 500)}`)
    .join("\n");

  return [
    "Rewrite the follow-up question as a standalone search query that makes sense without the",
    "conversation. Keep the user's own terminology and any specific identifiers, INCLUDING any",
    "country name from earlier in the conversation. If it already stands alone, return it",
    "unchanged. Reply with the query only.",
    "",
    "Conversation:",
    transcript,
    "",
    `Follow-up: ${question}`,
    "",
    "Standalone query:",
  ].join("\n");
}
