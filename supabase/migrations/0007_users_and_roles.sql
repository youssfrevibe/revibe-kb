-- Firebase-side identity, Supabase-side linking.
--
-- Users, teams, and roles all live in Firestore (project revibe-kb-6b102).
-- Supabase only needs to link its rows back to whoever created them, so it
-- can render "asked by youssf@revibe.me" in the audit log and let reviews
-- store the reviewer's Firebase UID.
--
-- All identity columns are `text` because that's what a Firebase UID is —
-- a 28-character base64-ish string, not a UUID. Nullable throughout because
-- we have 967 pre-existing rows that predate accounts and 200+ Q&A threads
-- created by the seed scripts.
--
-- Idempotent. Re-run safe.

alter table threads add column if not exists user_uid text;
create index if not exists threads_user_uid_idx on threads (user_uid);

alter table messages add column if not exists feedback_by text;
create index if not exists messages_feedback_by_idx on messages (feedback_by)
  where feedback_by is not null;
