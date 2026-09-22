-- OLC-created exits (systems-spec §7): links made in-game with `dig`. Keyed by (from_vnum, dir) so a
-- room can hold many exits; applied at boot after created rooms exist, adding/replacing the exit on
-- the source room. Rooms created by dig are stored in world_created with kind='room'.
create table if not exists world_exits (
  from_vnum integer not null,
  dir text not null,
  to_vnum integer not null,
  created_at timestamptz not null default now(),
  primary key (from_vnum, dir)
);
-- The game server uses the service-role key (bypasses RLS); enable RLS so no anon access leaks.
alter table world_exits enable row level security;
