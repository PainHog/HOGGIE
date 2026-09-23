-- Phase 5: the builder sandbox. A builder is scoped to a vnum range they may edit
-- (the old area/vnum-range boundary, carried forward). Nullable = no assignment yet.
alter table public.accounts add column if not exists builder_low_vnum  integer;
alter table public.accounts add column if not exists builder_high_vnum integer;
