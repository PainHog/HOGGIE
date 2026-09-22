-- OLC edits (systems-spec §7): staff field edits to room/mob/object prototypes. The world loads from
-- extracted content JSON; these rows are replayed over it at boot so live edits survive a restart.
-- One row per (kind, vnum, field); value is the field's new value as text (numbers stored as text).
create table if not exists world_overrides (
  kind text not null,            -- 'room' | 'mob' | 'obj'
  vnum integer not null,
  field text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (kind, vnum, field)
);
-- The game server uses the service-role key (bypasses RLS); enable RLS so no anon access leaks.
alter table world_overrides enable row level security;
