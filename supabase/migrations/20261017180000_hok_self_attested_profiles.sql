create table if not exists public.developer_hok_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_uid text not null check (game_uid ~ '^[0-9]{6,22}$'),
  nickname text not null check (char_length(nickname) between 1 and 64),
  icon text check (icon is null or char_length(icon) <= 40),
  grade integer check (grade is null or grade >= 0),
  score integer check (score is null or score >= 0),
  world_id integer check (world_id is null or world_id >= 0),
  consented_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.developer_hok_profiles enable row level security;
revoke all on public.developer_hok_profiles from anon, authenticated, public;
grant select, insert, update, delete on public.developer_hok_profiles to service_role;
