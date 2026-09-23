-- Glory (quest points) + the character's one active hunt quest (§3.6).
alter table characters add column if not exists glory integer not null default 0;
alter table characters add column if not exists quest jsonb;
