-- Minimal inventory (systems-spec §4): items a character carries, so shops can function.
-- Each entry references an object prototype vnum; defaults to an empty list.
alter table public.characters
  add column if not exists inventory jsonb not null default '[]'::jsonb;
