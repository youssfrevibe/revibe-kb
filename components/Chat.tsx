"use client";

import { useEffect, useRef, useState } from "react";
import { MARKETS, type Market } from "@/lib/markets";
import { SourcesBlock, type Source } from "./SourcesBlock";

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  detectedMarkets?: Market[];
  feedbackRating?: 'good' | 'bad';
  feedbackCorrection?: string;
};

type Props = {
  initialMessages?: ChatMessage[];
  initialSlug?: string | null;
};

export function Chat({
  initialMessages = [],
  initialSlug = null,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeFeedbackIndex, setActiveFeedbackIndex] = useState<number | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send() {
    const question = input.trim();
    if (!question || busy) return;

    setError(null);
    setInput("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);

    try {
      const clientDateStr = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, threadSlug: slug, clientDate: clientDateStr }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(detail.error ?? "Request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // NDJSON: one JSON event per line. A partial line stays in the buffer
      // until its newline arrives.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "meta") {
            const newSlug = event.threadSlug as string;
            const sources = event.sources as Source[];
            const detectedMarkets = (event.detectedMarkets as Market[] | undefined) ?? [];
            setSlug(newSlug);
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], sources, detectedMarkets };
              return next;
            });
            // Give the thread a real URL without a navigation, so the page can be
            // shared immediately and the back button still works.
            if (!slug) window.history.replaceState(null, "", `/t/${newSlug}`);
          } else if (event.type === "delta") {
            const text = event.text as string;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: next[next.length - 1].content + text,
              };
              return next;
            });
          } else if (event.type === "done") {
            const messageId = event.messageId as string;
            setMessages((prev) => {
              const next = [...prev];
              if (next.length > 0 && next[next.length - 1].role === "assistant") {
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  id: messageId,
                };
              }
              return next;
            });
          } else if (event.type === "error") {
            throw new Error(event.message as string);
          }
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      // Drop the empty assistant bubble so a failure doesn't leave a blank turn.
      setMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "assistant" && !next[next.length - 1].content) {
          next.pop();
        }
        return next;
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function submitFeedback(index: number, rating: 'good' | 'bad', correction?: string) {
    const msg = messages[index];
    if (!msg.id || !slug || submittingFeedback) return;

    setSubmittingFeedback(true);
    try {
      const response = await fetch(`/api/threads/${slug}/messages/${msg.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, correction }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(detail.error ?? "Failed to save feedback");
      }

      setMessages((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          feedbackRating: rating,
          feedbackCorrection: correction,
        };
        return next;
      });

      setActiveFeedbackIndex(null);
      setCorrectionText("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error saving feedback");
    } finally {
      setSubmittingFeedback(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">

        <div
          className="rounded-[var(--revibe-radius)] border p-5"
          style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
        >
          <p className="revibe-label mb-2 text-[12px]">Ask the knowledge base</p>
          <p className="text-[13px] leading-6" style={{ color: "var(--revibe-ink-muted)" }}>
            Answers come only from Revibe&apos;s guidelines and training material. Name the country in
            your question (&ldquo;<em>Saudi Arabia</em>&rdquo;, &ldquo;<em>UAE</em>&rdquo;, &ldquo;
            <em>Cape Town</em>&rdquo;) and only that market&apos;s SLAs, fees, and contact details are
            quoted. If you don&apos;t name a country, answers stick to global training material and won&apos;t
            quote market-specific numbers.
          </p>
        </div>

      <div className="flex flex-col gap-4">
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="flex justify-end">
              <div
                className="max-w-[85%] rounded-[var(--revibe-radius)] px-3.5 py-2.5 text-[13px] leading-6"
                style={{ background: "var(--revibe-ink)", color: "#fff" }}
              >
                {message.content}
              </div>
            </div>
          ) : (
            // The answer is the whole point of this page, so it gets the emphasis:
            // an accent rail on the left, a hair more padding, and larger, wider-set
            // type than the surrounding UI. Sources shrink and mute out below it.
            <div
              key={index}
              className="relative overflow-hidden rounded-[var(--revibe-radius)] border p-5 pl-6"
              style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1"
                style={{ background: "var(--revibe-accent)" }}
              />
              {message.content ? (
                <>
                  {message.detectedMarkets && message.detectedMarkets.length > 0 ? (
                    <div className="mb-2 flex flex-wrap items-center gap-1">
                      <span className="revibe-label text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>
                        Detected
                      </span>
                      {message.detectedMarkets.map((code) => (
                        <span
                          key={code}
                          className="revibe-label rounded px-1.5 py-0.5 text-[10px]"
                          style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink)" }}
                        >
                          {MARKETS[code].short}
                        </span>
                      ))}
                    </div>
                  ) : message.detectedMarkets ? (
                    <div className="mb-2">
                      <span
                        className="revibe-label rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-faint)" }}
                        title="No country was in your question — answered from global training only"
                      >
                        No country in question
                      </span>
                    </div>
                  ) : null}
                  <div className="answer text-[15px] leading-7" style={{ color: "var(--revibe-ink)" }}>
                    {message.content}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--revibe-accent)" }} />
                  Searching the material…
                </div>
              )}
              {message.sources && message.content ? <SourcesBlock sources={message.sources} /> : null}

              {message.id && slug && message.content && (
                <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--revibe-border)" }}>
                  {message.feedbackRating ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {message.feedbackRating === "good" ? (
                          <span className="flex items-center gap-1 font-semibold" style={{ color: "#059669" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.8-9.8a1 1 0 00-1.4-1.4L9 10.1 7.6 8.7a1 1 0 00-1.4 1.4l2.1 2.1a1 1 0 001.4 0l4.1-4.1z" clipRule="evenodd" />
                            </svg>
                            Verified Policy Good
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 font-semibold" style={{ color: "#e11d48" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                            </svg>
                            Flagged Policy Correction
                          </span>
                        )}
                      </div>
                      {message.feedbackCorrection && (
                        <div className="rounded p-2.5 text-[12px] mt-1 leading-5" style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-muted)", border: "1px solid var(--revibe-border)" }}>
                          <span className="font-semibold block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--revibe-ink-faint)" }}>Correction / Correct Answer</span>
                          {message.feedbackCorrection}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      {activeFeedbackIndex === index ? (
                        <div className="flex flex-col gap-2.5 mt-2">
                          <label className="revibe-label text-[10px]" style={{ color: "var(--revibe-ink-muted)" }}>
                            What's the right thing? (Mandatory)
                          </label>
                          <textarea
                            value={correctionText}
                            onChange={(e) => setCorrectionText(e.target.value)}
                            placeholder="Describe the correct SLA, fee, or support guideline that should apply here..."
                            rows={3}
                            className="w-full rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px] outline-none revibe-focus"
                            style={{
                              borderColor: "var(--revibe-border-input)",
                              background: "var(--revibe-surface)",
                              color: "var(--revibe-ink)",
                            }}
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFeedbackIndex(null);
                                setCorrectionText("");
                              }}
                              disabled={submittingFeedback}
                              className="rounded-[var(--revibe-radius)] px-3 py-1.5 text-[11px] font-medium border transition-opacity disabled:opacity-40"
                              style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink-muted)", background: "transparent" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={submittingFeedback || !correctionText.trim()}
                              onClick={() => submitFeedback(index, "bad", correctionText)}
                              className="revibe-label rounded-[var(--revibe-radius)] px-4 py-1.5 text-[11px] transition-opacity disabled:opacity-40"
                              style={{ background: "var(--revibe-ink)", color: "#fff" }}
                            >
                              {submittingFeedback ? "Submitting..." : "Submit Correction"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="revibe-label text-[9px]" style={{ color: "var(--revibe-ink-faint)" }}>Is this answer correct?</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => submitFeedback(index, "good")}
                              disabled={submittingFeedback}
                              className="flex items-center gap-1 rounded-[var(--revibe-radius)] border px-2.5 py-1.5 transition-colors hover:bg-emerald-50"
                              style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-3.5 w-3.5 text-emerald-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Good Answer
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveFeedbackIndex(index)}
                              disabled={submittingFeedback}
                              className="flex items-center gap-1 rounded-[var(--revibe-radius)] border px-2.5 py-1.5 transition-colors hover:bg-rose-50"
                              style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-3.5 w-3.5 text-rose-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Wrong Answer
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {error ? (
        <div
          className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
          style={{ borderColor: "var(--revibe-error)", background: "var(--revibe-error-bg)", color: "var(--revibe-error)" }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="sticky bottom-0 flex items-end gap-2 pb-2"
        style={{ background: "var(--revibe-canvas)" }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter makes a new line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Name the country in your question — e.g. &ldquo;shipping SLA for Saudi Arabia&rdquo;"
          aria-label="Your question"
          className="revibe-focus min-h-[52px] flex-1 resize-y rounded-[var(--revibe-radius)] border px-3 py-2 text-[13px] outline-none"
          style={{
            borderColor: "var(--revibe-border-input)",
            background: "var(--revibe-surface)",
            color: "var(--revibe-ink)",
          }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-5 py-3 text-[12px] font-bold tracking-wider transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
          style={{ background: "var(--revibe-gradient)", color: "#fff" }}
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
