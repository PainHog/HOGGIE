-- Clan membership ({name, rank}) and the PvP opt-in flag (systems-spec §5).
alter table characters add column if not exists clan jsonb;
alter table characters add column if not exists pk boolean not null default false;
