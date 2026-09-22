-- Clan-level record: the hall (a recall room) and the shared gold bank (systems-spec §5).
-- Membership stays on characters (characters.clan); this holds what a clan owns.
create table if not exists clans (
  name text primary key,
  leader_id uuid,
  hall_vnum integer,
  bank bigint not null default 0,
  created_at timestamptz not null default now()
);
-- The game server uses the service-role key (bypasses RLS); enable RLS so no anon access leaks.
alter table clans enable row level security;
