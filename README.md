# Revibe Knowledge Base

An internal knowledge base over Revibe's support guidelines and training
material. Staff ask questions in plain language; answers come only from Revibe's
own documents, with the sources listed underneath. Every conversation is saved as
a linkable thread, and the archive of past threads is searchable.

Next.js 16 · Gemini (embeddings + answers) · Supabase Postgres with pgvector.

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the database

Create a Supabase project, then open **SQL Editor → New query**, paste all of
`supabase/migrations/0001_init.sql`, and run it. That creates the tables, the
HNSW and full-text indexes, and the two search functions.

### 3. Configure

```bash
cp .env.local.example .env.local
```

Fill in:

- `GEMINI_API_KEY` — the paid Gemini key
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API

The service-role key is server-side only. It's read from an unprefixed env var,
so Next never includes it in the browser bundle.

### 4. Index the material

Source files live in `sources/` — see [sources/README.md](sources/README.md) for
how filenames determine market, which matters more than it looks.

```bash
npm run ingest -- --dry-run   # parse and report, writes nothing
npm run ingest                # embed and index
```

Ingestion is a local CLI, not an API route: it takes minutes, and there's no
reason to pay for serverless compute to do a job a laptop does fine.

### 5. Check retrieval before touching the UI

This is the gate. If the right passage isn't in the top few results, no amount of
prompt or interface work will produce a correct answer.

```bash
npm run query -- --market uae "how long is the shipping SLA"
npm run eval
```

`npm run eval` reports hit-rate@6 over [evals/questions.md](evals/questions.md).
Add the questions your team actually asks — especially any that someone got wrong
in a live conversation.

### 6. Run it

```bash
npm run dev
```

- `/ask` — new question
- `/t/[slug]` — a saved thread
- `/threads` — searchable archive
- `/admin` — what's indexed right now

## How it works

```
sources/*.{md,pdf}
   │  npm run ingest      parse → chunk → embed (gemini-embedding-001, 1536d)
   ▼
Supabase Postgres
   ├── documents · chunks      embedding vector(1536) + fts tsvector
   └── threads · messages · message_sources
   │  hybrid retrieval: vector + full-text, fused with RRF, filtered by market
   ▼
/api/chat → gemini-2.5-flash, grounded → streamed answer + Sources
```

### Market is a hard filter

The six compiled country guideline files are ~95% identical text. They differ
only in interpolated values — shipping SLA, restocking fee, support phone,
domain. Cosine similarity cannot distinguish them, so an unfiltered search
returns six near-duplicate passages and the model blends contradictory numbers
into a confidently wrong answer.

So `market` is a SQL `WHERE` clause, the UI makes you pick one, and a thread's
market is fixed once it starts. `guidelines.md` is indexed as `master` and kept
out of customer-facing answers because its `{{PLACEHOLDER}}` tokens would leak.

### Why hybrid search

Vector search alone misses exact tokens — order prefixes like `SA-`, guideline
IDs like `G12`, installment provider names. Full-text alone misses paraphrase.
Reciprocal rank fusion combines both rankings without needing their scores to be
comparable. All retrieval goes through `match_chunks` in the migration; there is
deliberately only one implementation.

Optional LLM reranking sits behind `RERANK=1`. Measure it with `npm run eval`
before turning it on — RRF is often enough, and reranking adds a round-trip to
every question.

### Why answers refuse to guess

This material is operational policy. An invented SLA or fee becomes a wrong
promise to a customer, so the prompt in `lib/prompt.ts` requires every specific
value to be quoted from a retrieved passage or omitted, and requires the model to
say the material doesn't cover something rather than fill the gap.

Sources shown under an answer come from the `message_sources` table — the
passages actually retrieved — not from anything the model wrote, so they can't be
hallucinated.

## Embedding into revibe.training.hub

Any page accepts `?embed=1`, which drops the outer navigation:

```html
<iframe src="https://<deployed-host>/ask?embed=1" width="100%" height="720"></iframe>
```

Set `EMBED_ALLOWED_ORIGIN=https://revibe.training.hub` so the CSP
`frame-ancestors` header allows the hub to frame it. Framing is default-deny
otherwise.

## Deployment note

Vercel's Hobby tier is licensed for non-commercial use, so an internal company
tool sits awkwardly on it. Cloudflare Pages' free tier has no such restriction.
Supabase's free tier pauses a project after about a week of inactivity — a weekly
ping keeps it warm.
