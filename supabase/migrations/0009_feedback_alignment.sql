-- Universal source alignment audit trail.
--
-- After an Admin approves or corrects a feedback review, they can also
-- align (rewrite) every OTHER source thread that mentions the outdated
-- policy — so the KB doesn't keep two parallel truths for the same topic.
--
-- This column stores exactly what was aligned. One entry per source thread
-- the admin ticked to update. Enough context for the Owner to review the
-- audit log and roll something back manually if needed.
--
-- Each entry: {
--   messageId, threadSlug, refNumber, sourceTag, title,
--   before, after,
--   editedAt
-- }
--
-- Idempotent.

alter table feedback_reviews
  add column if not exists aligned_edits jsonb not null default '[]'::jsonb;
