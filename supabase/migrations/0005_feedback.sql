-- Add feedback columns to messages table
alter table messages add column if not exists feedback_rating text check (feedback_rating in ('good', 'bad'));
alter table messages add column if not exists feedback_correction text;
