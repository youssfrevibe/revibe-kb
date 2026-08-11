-- Auto market detection: match_threads accepts a market filter array.
--
-- The country picker is gone from the UI. The server auto-detects the market
-- from the question text and passes one of three shapes to this function:
--
--   filter_markets = ['global']    → global training material only. Used when
--                                    the question doesn't name a country, so
--                                    the model can't quote market-specific
--                                    numbers by accident.
--   filter_markets = ['uae']       → the detected market + global. The old
--                                    single-market flow.
--   filter_markets = NULL          → no filter (all markets + global). Used
--                                    for comparison questions that name two
--                                    or more countries.
--
-- The prior signature took a single text market. Postgres lets you overload,
-- but keeping both around would let a stale caller silently keep the old
-- behaviour, so I DROP the old signature explicitly.

drop function if exists match_threads(vector, text, text, text[], int, int);

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
  with vec as (
    select m.id, row_number() over (order by m.embedding <=> query_embedding) as rank
    from messages m
    join threads t on t.id = m.thread_id
    where m.embedding is not null
      and t.source_tag = any (filter_source_tags)
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
    where m.fts @@ websearch_to_tsquery('english', query_text)
      and t.source_tag = any (filter_source_tags)
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
    f.score::real
  from fused f
  join messages m on m.id = f.id
  join threads t  on t.id = m.thread_id
  order by f.score desc
  limit match_count;
$$;
