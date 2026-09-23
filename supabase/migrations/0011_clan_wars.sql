-- Persisted clan wars (systems-spec §5): a war is a symmetric relationship between two clans that
-- lets their members fight without the PvP opt-in. Runtime keeps an in-memory registry; this table
-- is the durable source of truth so wars survive a restart. Pairs are stored canonically with
-- clan_a < clan_b (both lowercased) so each war is one row.
create table if not exists clan_wars (
  clan_a text not null,
  clan_b text not null,
  declared_at timestamptz not null default now(),
  primary key (clan_a, clan_b)
);
-- The game server uses the service-role key (bypasses RLS); enable RLS so no anon access leaks.
alter table clan_wars enable row level security;
