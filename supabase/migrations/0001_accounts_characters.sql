-- House of Ghouls — Phase 2 state schema: accounts + characters.
--
-- Content (rooms/mobs/objects/classes/races/skills) is NOT stored here in v1 — the server
-- loads it from houseofghouls-export/content JSON at boot. Supabase holds mutable player
-- state only. The game server (service role) is the only writer of gameplay state; RLS below
-- protects any direct client reads.

-- ---------------------------------------------------------------------------
-- accounts: one row per Supabase auth user. Roles drive the permission system
-- (Phase 5); everyone starts as a plain player.
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  roles      text[] not null default array['player']::text[],
  banned     boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- characters: many per account. stats is the 7-attribute block (incl. lck).
-- room_vnum points at a world room (content vnum, not an FK — content lives in JSON).
-- ---------------------------------------------------------------------------
create table if not exists public.characters (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  name             text not null,
  race_id          integer not null,
  class_id         integer not null,
  level            integer not null default 1,
  exp              bigint  not null default 0,
  alignment        integer not null default 0,
  stats            jsonb   not null,
  hp               integer not null,
  max_hp           integer not null,
  mana             integer not null,
  max_mana         integer not null,
  move             integer not null,
  max_move         integer not null,
  gold             bigint  not null default 0,
  practices        integer not null default 0,
  position         text    not null default 'standing',
  room_vnum        integer not null,
  title            text,
  created_at       timestamptz not null default now(),
  last_played      timestamptz,
  playtime_seconds bigint  not null default 0,
  deleted          boolean not null default false
);

create index if not exists characters_account_id_idx on public.characters (account_id);

-- Case-insensitive unique character names (ignoring soft-deleted rows).
create unique index if not exists characters_name_lower_uidx
  on public.characters (lower(name))
  where not deleted;

-- ---------------------------------------------------------------------------
-- RLS. The server uses the service role, which bypasses RLS. These policies only
-- constrain any direct client (anon/authenticated) access: an account may read its
-- own row and its own characters, nothing else. No client write policies exist, so
-- all gameplay writes must go through the server.
-- ---------------------------------------------------------------------------
alter table public.accounts   enable row level security;
alter table public.characters enable row level security;

drop policy if exists accounts_self_read on public.accounts;
create policy accounts_self_read on public.accounts
  for select using (auth.uid() = id);

drop policy if exists characters_self_read on public.characters;
create policy characters_self_read on public.characters
  for select using (account_id = auth.uid());
