-- =============================================================================
-- 0011_tier_taxonomy.sql  (CLEAN VERSION — paste entire block, click Run)
-- KB Tier Migration: SRC/ALH/NEW → TR1/TR2/NEWP/NEWL
-- =============================================================================


-- Step 1: Drop whatever constraint exists and add the new one first
-- (must happen before any UPDATE that changes source_tag values)

ALTER TABLE threads
  DROP CONSTRAINT IF EXISTS threads_source_tag_check;

ALTER TABLE threads
  ADD CONSTRAINT threads_source_tag_check
  CHECK (source_tag IN ('TR1','TR2','NEWP','NEWL','MSTR','SRC','ALH','NEW'));


-- Step 2: Migrate rows — NULL ref_number first to avoid unique index clash,
-- then change the tag

UPDATE threads SET ref_number = NULL WHERE source_tag = 'SRC';
UPDATE threads SET source_tag = 'TR2'  WHERE source_tag = 'SRC';

UPDATE threads SET ref_number = NULL WHERE source_tag = 'ALH';
UPDATE threads SET source_tag = 'TR2'  WHERE source_tag = 'ALH';

UPDATE threads SET ref_number = NULL WHERE source_tag = 'NEW';
UPDATE threads SET source_tag = 'NEWL' WHERE source_tag = 'NEW';

-- MSTR stays as-is (retrieval-excluded, no change needed)


-- Step 3: Replace match_threads RPC with tiered-boost version
-- Must DROP first because the return type signature changed.

DROP FUNCTION IF EXISTS match_threads(vector, text, text[], text[], integer, integer);

CREATE OR REPLACE FUNCTION match_threads(
  query_embedding vector(1536),
  query_text      text,
  filter_markets  text[]  DEFAULT '{}',
  filter_tags     text[]  DEFAULT '{}',
  match_count     int     DEFAULT 6,
  candidate_pool  int     DEFAULT 30
)
RETURNS TABLE(
  message_id  uuid,
  thread_id   uuid,
  thread_slug text,
  ref_number  int,
  source_tag  text,
  title       text,
  market      text,
  content     text,
  score       real
)
LANGUAGE plpgsql AS $$
DECLARE
  half_pool int := candidate_pool / 2;
BEGIN
  RETURN QUERY
  WITH vector_candidates AS (
    SELECT
      m.id   AS m_id,
      t.id   AS t_id,
      t.slug,
      t.ref_number,
      t.source_tag,
      t.title,
      t.market,
      m.content,
      ROW_NUMBER() OVER (ORDER BY m.embedding <=> query_embedding) AS rn
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE t.source_tag <> 'MSTR'
      AND (array_length(filter_markets, 1) IS NULL OR t.market = ANY(filter_markets) OR t.market IS NULL)
      AND (array_length(filter_tags,   1) IS NULL OR t.source_tag = ANY(filter_tags))
    ORDER BY m.embedding <=> query_embedding
    LIMIT half_pool
  ),
  keyword_candidates AS (
    SELECT
      m.id   AS m_id,
      t.id   AS t_id,
      t.slug,
      t.ref_number,
      t.source_tag,
      t.title,
      t.market,
      m.content,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(m.fts, plainto_tsquery('english', query_text)) DESC
      ) AS rn
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE t.source_tag <> 'MSTR'
      AND m.fts @@ plainto_tsquery('english', query_text)
      AND (array_length(filter_markets, 1) IS NULL OR t.market = ANY(filter_markets) OR t.market IS NULL)
      AND (array_length(filter_tags,   1) IS NULL OR t.source_tag = ANY(filter_tags))
    ORDER BY ts_rank_cd(m.fts, plainto_tsquery('english', query_text)) DESC
    LIMIT half_pool
  ),
  fused AS (
    SELECT
      COALESCE(v.m_id,       k.m_id)       AS m_id,
      COALESCE(v.t_id,       k.t_id)       AS t_id,
      COALESCE(v.slug,       k.slug)        AS slug,
      COALESCE(v.ref_number, k.ref_number)  AS ref_number,
      COALESCE(v.source_tag, k.source_tag)  AS source_tag,
      COALESCE(v.title,      k.title)       AS title,
      COALESCE(v.market,     k.market)      AS market,
      COALESCE(v.content,    k.content)     AS content,
      COALESCE(1.0 / (60.0 + v.rn), 0.0)
      + COALESCE(1.0 / (60.0 + k.rn), 0.0)
      + CASE COALESCE(v.source_tag, k.source_tag)
          WHEN 'TR1'  THEN 0.020
          WHEN 'NEWP' THEN 0.010
          WHEN 'NEWL' THEN 0.008
          WHEN 'TR2'  THEN 0.000
          ELSE             0.000
        END
      AS score
    FROM vector_candidates v
    FULL OUTER JOIN keyword_candidates k
      ON v.t_id = k.t_id AND v.m_id = k.m_id
  )
  SELECT
    f.m_id,
    f.t_id,
    f.slug,
    f.ref_number,
    f.source_tag,
    f.title,
    f.market,
    f.content,
    f.score
  FROM fused f
  ORDER BY f.score DESC
  LIMIT match_count;
END;
$$;


-- Step 4: Verify — you should see TR2 and NEWL only (no SRC, ALH, or NEW)

SELECT source_tag, COUNT(*) AS n
FROM threads
WHERE source_tag IS NOT NULL
GROUP BY source_tag
ORDER BY source_tag;
