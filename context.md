# Revibe Knowledge Base — Codebase Context

## What This Is

An **internal AI-powered knowledge base** for Revibe's support and operations staff. Staff ask questions in plain English; the system retrieves relevant passages from Revibe's own documents (training PDFs, guideline files, help center articles) and streams back a grounded answer via Gemini. Every conversation is saved as a shareable, linkable thread.

This is **not** a customer-facing product. The reader is always a Revibe employee — a support agent, ops analyst, or team lead — looking something up mid-work. The prompt and UI are deliberately optimised for this.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + custom CSS design tokens (brand-matched to revibe.me) |
| Font | Montserrat (Google Fonts, self-hosted at build time) |
| AI | Google Gemini via `@google/genai` |
| Database | Supabase (Postgres + pgvector) |
| Deployment target | Cloudflare Pages (Vercel Hobby is licensed for non-commercial use only) |

### Gemini models used
- **`gemini-embedding-001`** — embeddings at 1536 dimensions (Matryoshka truncation from 3072, normalised)
- **`gemini-2.5-flash`** — answer streaming (temp 0.1, near-deterministic for policy lookups)
- **`gemini-2.5-flash-lite`** — lightweight utility tasks: follow-up query rewriting, optional reranking

---

## Repository Layout

```
sources/                   Source documents (gitignored — company IP)
  *.pdf                    Training PDFs → market: global
  uae_guidelines.md        Compiled country guidelines → market: uae
  ksa_guidelines.md        → market: ksa
  ph_guidelines.md         → market: ph
  hk_guidelines.md         → market: hk
  th_guidelines.md         → market: th
  za_guidelines.md         → market: za
  guidelines.md            Master template ({{PLACEHOLDER}} tokens) → market: master
  uae_help_center.md       Public help center scrape → SRC pool, market: uae
  threads/                 Conversation exports for ingestion

supabase/migrations/
  0001_init.sql            Base schema: documents, chunks, threads, messages, message_sources
  0002_thread_retrieval.sql Pivot to thread-based retrieval; adds match_threads RPC
  0003_global_always_included.sql  Global material always included in market-filtered queries
  0004_market_filter_array.sql     match_threads accepts string[] market filter

lib/
  markets.ts               Market codes + labels (single source of truth)
  market-detect.ts         Regex-based market detection from question text
  source-tags.ts           Source pool types: SRC, ALH, MSTR
  gemini.ts                All Gemini API calls (embed, generate, stream)
  supabase.ts              Singleton Supabase client (server-side only)
  retrieve.ts              hybridSearch() — the one retrieval entry point
  prompt.ts                systemPrompt(), buildUserMessage(), rewritePrompt()
  chunk.ts                 Section → chunks with overlap (800 tok target, 100 tok overlap)
  slug.ts                  Thread slug generation
  config.ts                Env var validation
  parsers/
    index.ts               Parser registry (dispatches by file extension)
    markdown.ts            Heading-based section splitter for .md files
    pdf.ts                 PDF text extraction (unpdf)
    threads/               Conversation export adapters (canonical-json, chat-log)

scripts/
  ingest.ts                CLI: parse → chunk → embed → upsert to Supabase
  query.ts                 CLI: retrieval harness for testing before touching the UI
  eval.ts                  CLI: hit-rate@6 evaluation over evals/questions.md
  seed-threads.ts          Seed reference threads from source documents
  seed-references.ts       Additional reference seeding helper
  scrape-help-center.ts    Scrape Revibe's public help center into sources/

app/
  layout.tsx               Root layout (Montserrat font, Chrome wrapper, Suspense)
  page.tsx                 Redirects / → /ask
  ask/page.tsx             New question page
  t/[slug]/                Thread view page
  threads/page.tsx         Searchable archive of past threads
  admin/page.tsx           Read-only view of indexed material
  api/chat/route.ts        POST /api/chat — the core streaming API
  globals.css              Brand design tokens + Tailwind base

components/
  Chrome.tsx               App shell (nav, embed mode via ?embed=1)
  Chat.tsx                 Chat UI (streaming NDJSON reader, source pills, mode selector)
  SourcesBlock.tsx         Cited sources rendered under each answer
  ThreadSearch.tsx         Threads archive search
  ReferenceEditor.tsx      Inline editor for reference thread content

evals/
  questions.md             Q&A pairs for hit-rate@6 evaluation
```

---

## Core Concepts

### Markets (Hard Filter, Not a Ranking Hint)

Revibe operates in **6 markets**: UAE, KSA, Philippines, Hong Kong, Thailand, South Africa. The compiled guideline files for each are ~95% identical text, differing only on interpolated values — shipping SLAs, restocking fees, support phone numbers, domain URLs.

Cosine similarity **cannot** distinguish these files. An unfiltered search returns near-duplicate passages from all markets, and the model blends contradictory numbers into a confidently wrong answer.

**Solution**: `market` is a SQL `WHERE` clause on every retrieval. The UI never shows a market picker — instead, `lib/market-detect.ts` runs a set of hand-curated regexes on the question text to detect which market(s) are being asked about:

- **Single market detected** → filter to that market + global material
- **Multiple markets detected** → search all markets (comparison question — model quotes each clearly)
- **No market detected** → search global-only (training PDFs, help center) and warn the user market-specific numbers won't be quoted

Market is re-detected on every turn of a multi-turn conversation, on a rewritten query that includes prior context.

### Source Pools

Three pools control what material is searched:

| Tag | Contents | Default |
|---|---|---|
| `SRC` | Training PDFs + public help center articles | Always included |
| `ALH` | Alhena's per-market customer-bot guideline files | Included in default `SRC+ALH` mode |
| `MSTR` | `guidelines.md` master template (has `{{PLACEHOLDER}}` tokens) | Never in user answers |

The UI lets staff toggle between `SRC only` and `SRC + ALH` before starting a thread. Once a thread has started the mode is locked (it's part of the audit trail).

### Hybrid Retrieval (RRF)

All retrieval flows through a single Postgres RPC `match_threads` (defined in migration `0002`):

1. **Vector search** — cosine similarity on 1536-dim embeddings (`<=>` operator on pgvector HNSW index)
2. **Full-text search** — BM25 via `ts_rank_cd` on `tsvector` columns
3. **Reciprocal Rank Fusion** — scores fused without needing them on a comparable scale (`1/(60+rank)` for each signal)

RRF handles cases that each alone misses:
- Vector misses exact tokens: order prefixes (`SA-42`, `ZA-99`), guideline IDs (`G12`), provider names
- Full-text misses paraphrase and semantic similarity

Optional LLM reranking sits behind `RERANK=1` env var — uses `gemini-2.5-flash-lite` to reorder the top 30 down to 6. Off by default; measure with `npm run eval` before turning on.

### Thread-Based Retrieval Architecture

The retrieval unit is a **reference thread message**, not a raw chunk. The pivot (migration `0002`) moved embeddings from `chunks` to `messages`, so every indexed piece of source material lives as an assistant message in a "reference thread" in the same threads table as Q&A conversations.

This means:
- Every cited source is a real, navigable thread at `/t/[slug]`
- Reference content is **editable** via `ReferenceEditor.tsx` (inline editing for corrections without re-ingesting)
- Citations link to the actual thread, so the source is always verifiable
- `source_tag` on `threads` distinguishes reference threads (`SRC`/`ALH`/`MSTR`) from Q&A threads (`null`)

### The Prompt Contract

The system prompt (in `lib/prompt.ts`) is very strict because this is operational policy:

1. Answer **only** from the retrieved passages — never invent
2. Lead with the answer — no preamble, no empathy lines (the reader is staff, not a customer)
3. Never include verbatim customer-facing scripts unless explicitly asked for wording
4. If passages don't cover it, say so plainly and describe what they do cover
5. **Never** invent or adjust a specific value — SLAs, fees, phone numbers, URLs must be quoted exactly or omitted
6. If a `{{PLACEHOLDER}}` token appears, say the value is market-specific
7. Never write a sources list — the UI renders sources from `message_sources` automatically (so they can't be hallucinated)

### Chat API Flow (`POST /api/chat`)

```
1. Validate body, check env vars
2. Load or create thread in DB
3. Rewrite follow-up queries into standalone queries (using gemini-2.5-flash-lite)
4. Detect market(s) from rewritten query
5. hybridSearch(query, marketFilter, mode, k=6)
6. Persist user message to DB
7. Stream answer via gemini-2.5-flash (NDJSON: meta → delta… → done)
8. Persist assistant message + message_sources
9. Update thread updated_at
```

The response is `application/x-ndjson` — one JSON event per line:
- `{type:"meta", threadSlug, title, sources, detectedMarkets}` — sent first
- `{type:"delta", text}` — streamed text chunks
- `{type:"done"}` — signals end
- `{type:"error", message}` — if something fails mid-stream

The client (`Chat.tsx`) reads this with a `ReadableStream` + `TextDecoder`, buffering partial lines.

---

## Database Schema (Key Tables)

```sql
threads
  id, slug, title, market, source_tag (SRC|ALH|MSTR|null), ref_number, created_at, updated_at

messages
  id, thread_id, role (user|assistant), content, embedding vector(1536), fts tsvector,
  embedded_at, edited_at, created_at

message_sources
  id, message_id, source_message_id, chunk_id (legacy), rank, score

documents          -- legacy chunk-based storage (pre-migration 0002)
  id, title, source_path, source_type, market, content_hash, metadata

chunks             -- legacy raw text chunks
  id, document_id, ord, heading_path, market, content, embedding vector(1536), fts tsvector
```

---

## Pages and Routes

| Route | Purpose |
|---|---|
| `/ask` | New question — starts a thread |
| `/t/[slug]` | View a saved thread (Q&A or reference) |
| `/threads` | Searchable archive of all past threads |
| `/admin` | Read-only: what is currently indexed, chunk counts |

Any page accepts `?embed=1` which drops the nav chrome — used to embed this app in an `<iframe>` on `revibe.training.hub`. The `EMBED_ALLOWED_ORIGIN` env var sets the CSP `frame-ancestors` header.

---

## CLI Scripts

| Command | What it does |
|---|---|
| `npm run ingest` | Parse → chunk → embed → upsert source files to Supabase |
| `npm run ingest -- --dry-run` | Parse and report only — writes nothing |
| `npm run ingest -- --only uae` | Only files whose path contains "uae" |
| `npm run ingest -- --force` | Re-embed even if content hash is unchanged |
| `npm run query -- --market uae "question"` | Test retrieval before touching the UI |
| `npm run eval` | Hit-rate@6 over `evals/questions.md` |
| `npm run seed:threads` | Seed reference threads from source documents |
| `npm run seed:references` | Additional reference seeding |
| `npm run scrape:help` | Scrape Revibe's public help center |

Ingestion runs locally (not as an API route) — it takes minutes and hits Gemini's embedding API, so no serverless compute needed.

---

## Ingestion Pipeline

```
sources/*.{md,pdf}
  ↓ lib/parsers/ (markdown.ts → heading-based sections, pdf.ts → text extraction)
  ↓ lib/chunk.ts (sections → chunks, ~800 tokens, 100-token overlap, tables/fences kept whole)
  ↓ lib/gemini.ts embedDocuments() (RETRIEVAL_DOCUMENT task type, batched 100 at a time)
  ↓ Supabase upsert (documents + chunks tables, batch size 25 to stay under payload cap)
  ↓ scripts/seed-threads.ts (chunks → reference threads + embedded messages)
```

Chunk size: 800 tokens target (~3200 chars), 100-token overlap. Content hash is SHA-256 — unchanged documents are skipped. Tables and fenced code blocks are never split mid-way.

---

## Design and Brand

- Matches `revibe.me` storefront: same design tokens read from the live stylesheet
- Primary color `#232323` (near-black ink), accent `#ff8b21` (warm orange), canvas `#f9f9f9`
- Font: Montserrat 400/500/600/700
- Light-only (no dark mode) so embedded iframe matches the hub
- UPPERCASE tracked labels (`revibe-label`) are the storefront's strongest type signal
- Answer text is rendered `white-space: pre-wrap` — no markdown-to-HTML conversion, so model output cannot inject DOM

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Embeddings, answers, query rewriting |
| `SUPABASE_URL` | Yes | Postgres connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side DB access (bypasses RLS — never in browser bundle) |
| `SUPABASE_ANON_KEY` | Optional | Public/client-side key if needed |
| `RERANK` | Optional | Set to `1` to enable LLM reranking (off by default) |
| `EMBED_ALLOWED_ORIGIN` | Optional | CSP `frame-ancestors` for iframe embedding |

Service-role key is read from an **unprefixed** env var — Next.js only sends `NEXT_PUBLIC_*` to the browser, so this key never leaks.

---

## Key Design Decisions

1. **Market as SQL filter, not similarity signal** — The six guideline files are near-identical; similarity can't tell them apart. Every query has an explicit `WHERE market = ?`.

2. **Single retrieval function** — Everything goes through `match_threads`. No second implementation anywhere. Eval and prompt behaviour stay stable.

3. **Reference threads, not raw chunks** — Indexed material is stored as navigable, editable threads so citations are real links and content can be corrected without re-ingesting.

4. **Strict grounding prompt** — Policy material has zero tolerance for invented numbers. Model is instructed to quote exactly or omit, never to guess.

5. **Local ingestion CLI** — Embedding takes minutes; serverless timeouts would kill it. A laptop does it fine.

6. **Embed mode** — `?embed=1` drops the nav, enabling clean iframe embedding in `revibe.training.hub`.

7. **No markdown rendering** — Answer text is `pre-wrap` plain text. Prevents any model-generated HTML from executing in the DOM.
