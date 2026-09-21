-- Worn/wielded gear, keyed by slot -> { vnum }. Defaults to no equipment.
alter table characters add column if not exists equipment jsonb not null default '{}'::jsonb;
