-- The "NEW" source pool.
--
-- Purpose: capture new processes / new policy implementations that admins
-- want the AI to reference IMMEDIATELY and PROMINENTLY, regardless of
-- whether the asker picked SRC-only or SRC+ALH mode. Think of it as the
-- "recent policy changes" bin — high visibility for humans (there's a
-- dedicated admin tab listing recent entries), high priority for
-- retrieval (a small RRF score boost so tie-breaks land here).
--
-- Also: source-thread editing is now restricted to admin + owner. That's
-- an app-level rule enforced in the PATCH route — no schema change needed.
--
-- Idempotent.

-- 1) Extend source_tag check to allow NEW alongside SRC / ALH / MSTR.
alter table threads drop constraint if exists threads_source_tag_check;
alter table threads add constraint threads_source_tag_check
  check (source_tag in ('SRC', 'ALH', 'MSTR', 'NEW'));

-- 2) Replace match_threads: always union NEW refs (regardless of filter),
--    add a small score boost so a NEW ref of comparable relevance wins
--    the tie-break, and keep everything else identical to 0004.
create or replace function match_threads (
  query_embedding vector(1536),
  query_text      text,
  filter_markets  text[] default null,
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
  with
  -- The effective source-tag filter is the caller's list PLUS 'NEW'.
  -- Duplicates don't matter — `= any` treats it as a set.
  effective_tags as (
    select array_cat(coalesce(filter_source_tags, array['SRC','ALH']::text[]), array['NEW']::text[]) as tags
  ),
  vec as (
    select m.id, row_number() over (order by m.embedding <=> query_embedding) as rank
    from messages m
    join threads t on t.id = m.thread_id
    cross join effective_tags e
    where m.embedding is not null
      and t.source_tag = any (e.tags)
      and (
        filter_markets is null
        or t.market = 'global'
        or t.market = any (filter_markets)
      )
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
    cross join effective_tags e
    where m.fts @@ websearch_to_tsquery('english', query_text)
      and t.source_tag = any (e.tags)
      and (
        filter_markets is null
        or t.market = 'global'
        or t.market = any (filter_markets)
      )
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
    -- Priority boost for NEW refs. 0.005 is enough to break ties among
    -- comparably-ranked results without swamping a genuinely better match
    -- (RRF scores here are typically in the 0.01–0.04 range).
    (f.score + case when t.source_tag = 'NEW' then 0.005 else 0 end)::real as score
  from fused f
  join messages m on m.id = f.id
  join threads t  on t.id = m.thread_id
  order by score desc
  limit match_count;
$$;
