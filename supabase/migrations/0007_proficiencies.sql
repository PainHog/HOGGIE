-- Per-skill learned% (lowercased skill name -> proficiency), raised by practising/use (§2.6).
alter table characters add column if not exists proficiencies jsonb not null default '{}'::jsonb;
