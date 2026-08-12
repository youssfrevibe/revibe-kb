-- Feedback review queue.
--
-- Before: 👎 + correction → immediately embedded as an ALH reference thread.
-- After:  👎 + correction → creates a feedback_reviews row (status='pending').
--         An Admin sees it in /admin/feedback and either:
--           - approves  → the agent's correction becomes the ALH ref
--           - corrects  → the admin's version becomes the ALH ref
--           - marks invalid → nothing is taught; row stays for audit
--
-- Approve/Correct is what actually creates the ALH reference — that happens
-- in the API route, not here in SQL.
--
-- submitted_by and reviewed_by are text (Firebase UIDs), not FKs, because
-- identity lives in Firestore. Displaying names/roles for the audit log
-- means looking them up in Firestore at render time.
--
-- Idempotent.

create table if not exists feedback_reviews (
  id                     uuid primary key default gen_random_uuid(),

  -- The wrong assistant message that got the 👎.
  message_id             uuid not null references messages(id) on delete cascade,

  -- Firebase UID of the support agent who submitted the correction.
  submitted_by           text,

  -- Snapshot of context taken at submission, so what the reviewer sees can't
  -- drift if the underlying thread is later edited or deleted.
  question               text not null,
  wrong_answer           text not null,
  cited_sources          jsonb not null default '[]'::jsonb,
  market                 text,

  -- Agent's correction. Required at submission.
  submitted_correction   text not null,

  -- Review state.
  status                 text not null default 'pending'
    check (status in ('pending', 'approved', 'corrected', 'invalid')),
  reviewed_by            text,
  reviewed_at            timestamptz,

  -- If status='corrected', the admin's rewritten correction.
  admin_correction       text,
  admin_notes            text,

  -- Link to the ALH ref thread that was created on approve/correct.
  created_ref_thread_id  uuid references threads(id) on delete set null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists feedback_reviews_status_idx on feedback_reviews (status, created_at desc);
create index if not exists feedback_reviews_reviewer_idx on feedback_reviews (reviewed_by, reviewed_at desc);
create index if not exists feedback_reviews_message_idx on feedback_reviews (message_id);

-- Prevent duplicate pending reviews for the same wrong answer. Approved or
-- rejected items don't block a fresh review.
create unique index if not exists feedback_reviews_pending_uniq
  on feedback_reviews (message_id)
  where status = 'pending';
