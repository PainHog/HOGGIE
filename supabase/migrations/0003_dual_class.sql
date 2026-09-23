-- Dual-class (systems-spec §2.4): an optional second class chosen at character creation.
-- NULL = single-class. A dual character uses both classes' skills, blends thac0/attacks, and
-- gains an extra practice per level. Existing characters default to NULL (single-class).
alter table public.characters
  add column if not exists dual_class_id integer;
