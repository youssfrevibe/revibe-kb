-- Revibe AI Knowledge Base — initial schema
-- Apply by pasting into the Supabase SQL editor (Dashboard > SQL Editor > New query).

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Source material
-- ---------------------------------------------------------------------------

-- market: 'uae' | 'ksa' | 'ph' | 'hk' | 'th' | 'za' | 'master' | 'global'
--   'master'  = guidelines.md, contains {{PLACEHOLDER}} tokens, never used for
--               customer-facing answers because the placeholders would leak.
--   'global'  = material that genuinely applies everywhere (the training PDFs,
--               unless a PDF turns out to be market-specific).
-- Retrieval ALWAYS filters on this column. The compiled country guideline files
-- are near-identical apart from interpolated SLAs, fees, and phone numbers, so
-- similarity search cannot distinguish them and must not be asked to.
create table if not exists documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  source_path  text not null unique,
  source_type  text not null check (source_type in ('md', 'pdf', 'docx', 'pptx', 'thread')),
  market       text not null default 'global',
  version      int  not null default 1,
  content_hash text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists documents_market_idx on documents (market);

create table if not exists chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  ord          int  not null,
  heading_path text,
  -- Denormalised from documents so the market filter and the vector scan hit the
  -- same table. Joining to filter would force Postgres to over-fetch from the
  -- HNSW index before discarding most rows.
  market       text not null,
  content      text not null,
  content_hash text not null,
  embedding    vector(1536),
  fts          tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, ord)
);

create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_fts_idx        on chunks using gin (fts);
create index if not exists chunks_market_idx     on chunks (market);
create index if not exists chunks_document_idx   on chunks (document_id);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table if not exists threads (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text,
  market     text not null default 'global',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists threads_updated_idx on threads (updated_at desc);

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references threads(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  fts        tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now()
);

create index if not exists messages_thread_idx on messages (thread_id, created_at);
create index if not exists messages_fts_idx    on messages using gin (fts);

-- Which chunks produced which answer. Powers the Sources block at the end of an
-- answer and makes any past thread auditable against the material.
create table if not exists message_sources (
  message_id uuid not null references messages(id) on delete cascade,
  chunk_id   uuid not null references chunks(id) on delete cascade,
  rank       int  not null,
  score      real,
  primary key (message_id, chunk_id)
);

-- ---------------------------------------------------------------------------
-- Retrieval: hybrid vector + full-text with reciprocal rank fusion
-- ---------------------------------------------------------------------------

-- The single retrieval primitive. Every code path goes through this — do not add
-- a second search implementation.
--
-- Vector search alone misses exact tokens (order prefixes like SA-/ZA-, guideline
-- IDs like G12, provider names). Full-text alone misses paraphrase. RRF fuses the
-- two rankings without needing the scores to be on a comparable scale.
create or replace function match_chunks (
  query_embedding vector(1536),
  query_text      text,
  filter_market   text,
  match_count     int default 6,
  candidate_count int default 30
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  title        text,
  source_path  text,
  market       text,
  heading_path text,
  content      text,
  score        real
)
language sql
stable
as $$
  with vec as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
    from chunks c
    where c.market = filter_market
      and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit candidate_count
  ),
  kw as (
    select c.id,
           row_number() over (
             order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
           ) as rank
    from chunks c
    where c.market = filter_market
      and c.fts @@ websearch_to_tsquery('english', query_text)
    order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
    limit candidate_count
  ),
  fused as (
    select
      coalesce(vec.id, kw.id) as id,
      -- k=60 is the standard RRF damping constant; it stops rank-1 from
      -- dominating so a result strong in both lists can outrank it.
      coalesce(1.0 / (60 + vec.rank), 0) + coalesce(1.0 / (60 + kw.rank), 0) as score
    from vec
    full outer join kw on vec.id = kw.id
  )
  select
    c.id, d.id, d.title, d.source_path, c.market, c.heading_path, c.content,
    f.score::real
  from fused f
  join chunks c    on c.id = f.id
  join documents d on d.id = c.document_id
  order by f.score desc
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Threads archive search
-- ---------------------------------------------------------------------------

create or replace function search_threads (q text)
returns table (
  slug          text,
  title         text,
  market        text,
  snippet       text,
  message_count bigint,
  updated_at    timestamptz
)
language sql
stable
as $$
  select
    t.slug,
    t.title,
    t.market,
    ts_headline(
      'english',
      -- Prefer a matching message for the snippet; fall back to the first one.
      coalesce(
        (select m2.content from messages m2
          where m2.thread_id = t.id
            and m2.fts @@ websearch_to_tsquery('english', q)
          order by m2.created_at limit 1),
        (select m3.content from messages m3
          where m3.thread_id = t.id
          order by m3.created_at limit 1)
      ),
      websearch_to_tsquery('english', q),
      -- Sentinel markers, not <b>. ts_headline does NOT escape the surrounding
      -- text, so emitting real HTML here would let anything a user typed into a
      -- question ("<img onerror=...>") execute when the archive renders it.
      -- The client escapes the whole string, then swaps these for <b>.
      'MaxWords=30, MinWords=10, ShortWord=3, MaxFragments=1, StartSel=[[hl]], StopSel=[[/hl]]'
    ) as snippet,
    count(m.id) as message_count,
    t.updated_at
  from threads t
  join messages m on m.thread_id = t.id
  where t.id in (
    select m4.thread_id from messages m4
    where m4.fts @@ websearch_to_tsquery('english', q)
    union
    select t2.id from threads t2
    where t2.title ilike '%' || q || '%'
  )
  group by t.id, t.slug, t.title, t.market, t.updated_at
  order by t.updated_at desc
  limit 50;
$$;
