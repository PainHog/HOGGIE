-- Tier / remort (systems-spec §2.4): a character can `advancetier` at level 50 to swap into their
-- tier class, reset to level 2, and re-level on the tier track while keeping earned power.
-- `tier` is the remort count (0 = not tiered); `tier_exp` banks exp earned before tiering.
alter table public.characters
  add column if not exists tier     integer not null default 0,
  add column if not exists tier_exp bigint  not null default 0;
