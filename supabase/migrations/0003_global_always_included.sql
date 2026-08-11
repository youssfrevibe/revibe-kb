-- Cross-market retrieval: global material is always in scope.
--
-- Training PDFs (Claims Process, Inbound, Operations, Orders & Buyback,
-- Tickets & Social) are tagged market='global' because they're the same deck
-- everywhere — one authoritative source of internal training. Under the
-- original strict market filter that made them invisible unless the user
-- explicitly picked "Global" as the market, which meant a UAE question about
-- claim SLAs never surfaced the SLA MATRIX slide in the Claims training deck.
--
-- Fix: match_threads returns rows where `t.market = filter_market OR
-- t.market = 'global'`. The per-market ALH guideline files stay strictly
-- filtered (UAE query never sees KSA numbers), but the cross-cutting training
-- material is always in the candidate pool.
--
-- Re-run safe: replaces the function with the same signature.

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
      and (t.market = filter_market or t.market = 'global')
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
      and (t.market = filter_market or t.market = 'global')
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
