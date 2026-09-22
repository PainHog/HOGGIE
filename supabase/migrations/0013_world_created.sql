-- OLC-created prototypes (systems-spec §7): brand-new mob/object prototypes made in-game with
-- mcreate/ocreate. Stored minimal (keywords + area); the server registers a default prototype from
-- this at boot, then world_overrides field edits patch it. Applied before overrides at startup.
create table if not exists world_created (
  kind text not null,            -- 'mob' | 'obj'
  vnum integer not null,
  data jsonb not null,           -- { keywords, area }
  created_at timestamptz not null default now(),
  primary key (kind, vnum)
);
-- The game server uses the service-role key (bypasses RLS); enable RLS so no anon access leaks.
alter table world_created enable row level security;
