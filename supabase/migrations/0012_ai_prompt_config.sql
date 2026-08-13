-- =============================================================================
-- 0012_ai_prompt_config.sql  (paste entire block, click Run)
-- Live-editable master system prompt (Admin ▸ KB AI Brain).
--
-- Stores ONLY the tunable body of the prompt. The persona line, dynamic
-- market/date context, and the non-negotiable guardrails stay in code
-- (lib/prompt.ts) and are wrapped around this body at request time — so a live
-- edit can tune behaviour but can never remove the safety rails.
--
-- No row is seeded: an empty table means "use the DEFAULT_PROMPT_BODY from
-- code", so retrieval/answers behave exactly as before until an owner saves a
-- custom version.
-- =============================================================================

-- Singleton: the current active body. id is pinned to 1.
CREATE TABLE IF NOT EXISTS ai_prompt_config (
  id          int PRIMARY KEY DEFAULT 1,
  body        text NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prompt_config_singleton CHECK (id = 1)
);

-- History: one row per save, for audit + one-click rollback.
CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id          bigserial PRIMARY KEY,
  body        text NOT NULL,
  updated_by  text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_prompt_versions_created_idx
  ON ai_prompt_versions (created_at DESC);
