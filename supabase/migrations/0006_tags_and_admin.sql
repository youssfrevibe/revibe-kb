-- Add tags column to threads table
alter table threads add column if not exists tags text[] default array[]::text[];
