"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { MARKETS } from "@/lib/markets";

type SourceHit = {
  threadSlug: string;
  messageId: string;
  refLabel: string;
  title: string;
  market: string;
  content: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: SourceHit[];
};

export function TeachChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setStreaming(true);

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    // Build history for context (exclude sources from history sent to API)
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const response = await fetch("/api/admin/teach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      if (!response.ok) {
        const err = await response.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err.error ?? "Unknown error"}` },
        ]);
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";
      let currentSources: SourceHit[] = [];
      let assistantText = "";

      // Add a placeholder assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "", sources: [] }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "sources") {
              currentSources = event.sources;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, sources: currentSources };
                }
                return updated;
              });
            } else if (event.type === "delta") {
              assistantText += event.text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: assistantText };
                }
                return updated;
              });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev.filter((m) => m.content !== ""),
        { role: "assistant", content: `Network error: ${error instanceof Error ? error.message : String(error)}` },
      ]);
    }

    setStreaming(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="revibe-label text-[13px]">Teach the AI</h1>
        <p className="mt-1 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
          Ask where things are stated in the source material, discuss policies, and edit references directly.
        </p>
      </div>

      {/* Chat messages */}
      <div
        className="flex flex-col gap-3 overflow-y-auto"
        style={{ maxHeight: "calc(100dvh - 280px)" }}
      >
        {messages.length === 0 && (
          <div
            className="rounded-[var(--revibe-radius)] border p-6 text-center"
            style={{ borderColor: "var(--revibe-border)", background: "var(--revibe-surface)" }}
          >
            <p className="text-[13px] font-semibold" style={{ color: "var(--revibe-ink)" }}>
              Ask me about your source material
            </p>
            <p className="mt-2 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
              Examples: &ldquo;Where does it say the SA shipping SLA is 3-5 days?&rdquo; or
              &ldquo;What sources mention cashback for ZA?&rdquo;
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className="flex flex-col gap-2">
            {/* Source references (shown above assistant messages) */}
            {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="revibe-label text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                  Related sources ({msg.sources.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {msg.sources.map((src, j) => (
                    <Link
                      key={j}
                      href={`/t/${src.threadSlug}`}
                      target="_blank"
                      className="revibe-focus inline-flex items-center gap-1.5 rounded-[var(--revibe-radius)] border px-2 py-1 text-[11px] transition-colors hover:border-[var(--revibe-ink)]"
                      style={{
                        borderColor: "var(--revibe-border)",
                        background: "var(--revibe-surface)",
                        color: "var(--revibe-ink)",
                      }}
                    >
                      <span className="font-mono font-semibold">{src.refLabel}</span>
                      <span style={{ color: "var(--revibe-ink-muted)" }}>·</span>
                      <span className="max-w-[180px] truncate">{src.title.replace(/^(?:SRC|ALH)-\d+ · /, "")}</span>
                      <span
                        className="revibe-label rounded px-1 py-px text-[9px]"
                        style={{ background: "var(--revibe-canvas)", color: "var(--revibe-ink-faint)" }}
                      >
                        {src.market in MARKETS ? MARKETS[src.market as keyof typeof MARKETS].short : src.market}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Message bubble */}
            <div
              className="relative rounded-[var(--revibe-radius)] border p-4"
              style={{
                borderColor: msg.role === "user" ? "var(--revibe-border)" : "var(--revibe-accent)",
                background: msg.role === "user" ? "var(--revibe-surface)" : "var(--revibe-surface)",
              }}
            >
              {msg.role === "assistant" && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1 rounded-l-[var(--revibe-radius)]"
                  style={{ background: "var(--revibe-accent)" }}
                />
              )}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="revibe-label text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                  {msg.role === "user" ? "You" : "AI"}
                </span>
              </div>
              <div
                className="answer text-[13px] leading-6 whitespace-pre-wrap"
                style={{ color: "var(--revibe-ink)" }}
              >
                {msg.content || (streaming ? "Thinking…" : "")}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about source material or request an edit…"
          disabled={streaming}
          className="revibe-focus flex-1 rounded-[var(--revibe-radius)] border px-3 py-2.5 text-[13px] outline-none disabled:opacity-50"
          style={{
            borderColor: "var(--revibe-border-input)",
            background: "var(--revibe-surface)",
            color: "var(--revibe-ink)",
          }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-5 py-2.5 text-[12px] font-bold tracking-wider transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
          style={{ background: "var(--revibe-gradient)", color: "#fff" }}
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
