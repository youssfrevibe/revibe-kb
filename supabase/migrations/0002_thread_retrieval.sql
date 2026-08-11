-- Retrieval pivot: threads become the searched source, not chunks.
--
-- What changes:
-- 1. `messages` grows an embedding column so an assistant message can be found
--    via vector search. It's nullable — only reference threads (source_tag set)
--    get embedded; Q&A messages stay unindexed.
-- 2. `threads` grows a `source_tag` column so the UI can filter which pool to
--    search: SRC (training PDFs + help center), ALH (Alhena's customer-bot
--    guidelines), MSTR (master template with placeholders), or NULL (Q&A).
-- 3. `threads` grows a `ref_number` column so REF-#### labels are stable and
--    can be shown in citations without re-parsing the title.
-- 4. A new RPC `match_threads` mirrors match_chunks but searches the reference
--    thread messages and filters by market + source_tag list. Hybrid search
--    stays the same shape — vector + BM25 fused with RRF — so eval and prompt
--    behaviour don't shift underneath us.
--
-- Apply by pasting into the Supabase SQL editor after 0001_init.sql is already
-- in place. Idempotent: uses IF NOT EXISTS everywhere.

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------

alter table threads add column if not exists source_tag text check (source_tag in ('SRC', 'ALH', 'MSTR'));
alter table threads add column if not exists ref_number int;

-- Unique per (source_tag, ref_number), but NULL source_tag (Q&A threads) is
-- unconstrained so multiple Q&A threads don't fight over ref_number.
create unique index if not exists threads_source_tag_ref_idx
  on threads (source_tag, ref_number)
  where source_tag is not null;

create index if not exists threads_source_tag_market_idx
  on threads (source_tag, market)
  where source_tag is not null;

-- ---------------------------------------------------------------------------
-- Messages: retrievable, editable
-- ---------------------------------------------------------------------------

alter table messages add column if not exists embedding vector(1536);
alter table messages add column if not exists embedded_at timestamptz;
alter table messages add column if not exists edited_at timestamptz;

-- Partial HNSW index: only embedded rows participate. Q&A messages never carry
-- an embedding, so they're skipped, keeping the index small.
create index if not exists messages_embedding_idx
  on messages using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- ---------------------------------------------------------------------------
-- message_sources: point at the source MESSAGE, not the raw chunk
-- ---------------------------------------------------------------------------
--
-- After the pivot, an answer's cited "source" is a reference thread's
-- assistant message (the editable one) rather than a raw chunk. The table
-- keeps its name but grows a nullable source_message_id and chunk_id becomes
-- nullable so both citation shapes can coexist during the transition.
--
-- The original schema used (message_id, chunk_id) as a composite PRIMARY KEY,
-- which Postgres refuses to let us make nullable. Replace that with a surrogate
-- `id` PK and keep uniqueness via a nullable-friendly partial unique index.
-- Existing rows keep their chunk_id and are unaffected.

alter table message_sources add column if not exists source_message_id uuid references messages(id) on delete cascade;

-- Add the surrogate id — nullable at first so the ALTER succeeds against
-- existing rows, then backfill, then set NOT NULL + PK.
alter table message_sources add column if not exists id uuid default gen_random_uuid();
update message_sources set id = gen_random_uuid() where id is null;
alter table message_sources alter column id set not null;

-- Drop the old composite PK before allowing chunk_id to go NULL. The name is
-- Supabase's default, but we look it up dynamically in case a re-run has moved
-- past this step already.
do $$
declare
  pk_name text;
begin
  select conname into pk_name
    from pg_constraint
   where conrelid = 'public.message_sources'::regclass
     and contype = 'p';
  if pk_name is not null then
    execute format('alter table message_sources drop constraint %I', pk_name);
  end if;
end $$;

-- The new primary key.
alter table message_sources add constraint message_sources_pkey primary key (id);

-- chunk_id becomes optional now that the PK doesn't require it.
alter table message_sources alter column chunk_id drop not null;

-- Preserve the old (message_id, chunk_id) uniqueness so a re-answer can't
-- cite the same chunk twice, but only when chunk_id is set.
create unique index if not exists message_sources_chunk_uniq
  on message_sources (message_id, chunk_id)
  where chunk_id is not null;

-- Same for the new pointer.
create unique index if not exists message_sources_srcmsg_uniq
  on message_sources (message_id, source_message_id)
  where source_message_id is not null;

create index if not exists message_sources_source_message_idx on message_sources (source_message_id);

-- One of the two must be set. Enforced at insert time by the app.
alter table message_sources drop constraint if exists message_sources_target_check;
alter table message_sources add constraint message_sources_target_check
  check (chunk_id is not null or source_message_id is not null);

-- ---------------------------------------------------------------------------
-- match_threads: the new retrieval primitive
-- ---------------------------------------------------------------------------
--
-- Same shape as match_chunks — RRF of vector cosine and BM25 — but scoped to
-- reference-thread messages and filtered by market plus a list of source_tag
-- values. Returns the thread's slug and REF number so citations can link
-- directly to the (editable) thread.
--
-- `filter_source_tags` is a text[] rather than a single value because the UI
-- lets the user pick "SRC only" or "SRC + ALH". Passing an array keeps that
-- decision at the caller and away from Postgres.

create or replace function match_threads (
  query_embedding vector(1536),
  query_text      text,
  filter_market   text,
  filter_source_tags text[] default array['SRC','ALH']::text[],
  match_count     int default 6,
  candidate_count int default 30
)
returns table (
  message_id   uuid,
  thread_id    uuid,
  thread_slug  text,
  ref_number   int,
  source_tag   text,
  title        text,
  market       text,
  content      text,
  score        real
)
language sql
stable
as $$
  with vec as (
    select m.id, row_number() over (order by m.embedding <=> query_embedding) as rank
    from messages m
    join threads t on t.id = m.thread_id
    where m.embedding is not null
      and t.source_tag = any (filter_source_tags)
      and t.market = filter_market
      and m.role = 'assistant'
    order by m.embedding <=> query_embedding
    limit candidate_count
  ),
  kw as (
    select m.id,
           row_number() over (
             order by ts_rank_cd(m.fts, websearch_to_tsquery('english', query_text)) desc
           ) as rank
    from messages m
    join threads t on t.id = m.thread_id
    where m.fts @@ websearch_to_tsquery('english', query_text)
      and t.source_tag = any (filter_source_tags)
      and t.market = filter_market
      and m.role = 'assistant'
    order by ts_rank_cd(m.fts, websearch_to_tsquery('english', query_text)) desc
    limit candidate_count
  ),
  fused as (
    select
      coalesce(vec.id, kw.id) as id,
      coalesce(1.0 / (60 + vec.rank), 0) + coalesce(1.0 / (60 + kw.rank), 0) as score
    from vec
    full outer join kw on vec.id = kw.id
  )
  select
    m.id,
    t.id,
    t.slug,
    t.ref_number,
    t.source_tag,
    t.title,
    t.market,
    m.content,
    f.score::real
  from fused f
  join messages m on m.id = f.id
  join threads t  on t.id = m.thread_id
  order by f.score desc
  limit match_count;
$$;
