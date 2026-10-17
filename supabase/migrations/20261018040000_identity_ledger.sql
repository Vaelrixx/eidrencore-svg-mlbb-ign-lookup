-- Eidren identity ledger: every confirmed nickname becomes ours. Reads serve
-- repeat lookups without touching any upstream; writes happen on confirmed
-- success only. Nicknames are public display names, not secrets.
create table if not exists public.identity_ledger (
  game text not null,
  player_key text not null,
  nickname text not null check (char_length(nickname) between 1 and 64),
  source text not null,
  verified_at timestamptz not null default now(),
  hit_count integer not null default 0,
  primary key (game, player_key)
);
alter table public.identity_ledger enable row level security;
revoke all on public.identity_ledger from anon, authenticated, public;
grant select, insert, update on public.identity_ledger to service_role;

create index if not exists identity_ledger_verified_idx
  on public.identity_ledger (verified_at desc);

-- Atomic upsert: insert fresh confirmations, refresh nickname/source on
-- re-confirmation. hit_count only moves via record_identity_ledger_hit.
create or replace function public.upsert_identity_ledger(
  p_game text,
  p_player_key text,
  p_nickname text,
  p_source text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_game is null or p_game = '' or p_player_key is null or p_player_key = ''
    or p_nickname is null or p_nickname = '' or p_source is null or p_source = '' then
    raise exception 'invalid ledger arguments' using errcode = '22023';
  end if;
  insert into public.identity_ledger as ledger (game, player_key, nickname, source, verified_at, hit_count)
  values (p_game, p_player_key, left(p_nickname, 64), left(p_source, 64), pg_catalog.now(), 0)
  on conflict (game, player_key) do update
  set nickname = excluded.nickname,
      source = excluded.source,
      verified_at = pg_catalog.now();
end;
$function$;
revoke all on function public.upsert_identity_ledger(text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_identity_ledger(text, text, text, text) to service_role;

-- Atomic hit counter for served-from-ledger lookups.
create or replace function public.record_identity_ledger_hit(p_game text, p_player_key text)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.identity_ledger
  set hit_count = least(hit_count + 1, 2147483647)
  where game = p_game and player_key = p_player_key;
end;
$function$;
revoke all on function public.record_identity_ledger_hit(text, text) from public, anon, authenticated;
grant execute on function public.record_identity_ledger_hit(text, text) to service_role;
