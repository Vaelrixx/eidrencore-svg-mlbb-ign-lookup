create extension if not exists pgcrypto;

create table if not exists public.developer_plans (
  slug text primary key check (slug in ('free','pro','business')),
  name text not null,
  price_paise integer not null default 0 check (price_paise >= 0),
  monthly_limit integer not null check (monthly_limit > 0),
  enabled boolean not null default false,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.developer_plans (slug,name,price_paise,monthly_limit,enabled,description) values
('free','Free',0,100,true,'Try the API with a small monthly allowance.'),
('pro','Pro',0,10000,false,'For apps and bots with regular traffic.'),
('business','Business',0,100000,false,'Higher volume for production integrations.')
on conflict (slug) do nothing;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null unique check (length(key_hash)=64),
  key_prefix text not null,
  name text not null check (char_length(name) between 1 and 80),
  plan_slug text not null default 'free' references public.developer_plans(slug),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_user_created_idx on public.api_keys(user_id, created_at desc);

create table if not exists public.developer_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_slug text not null default 'free' references public.developer_plans(slug),
  status text not null default 'free' check (status in ('free','pending','active','past_due','cancelled')),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.developer_api_usage (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  month_start date not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (api_key_id, month_start)
);

create or replace function public.consume_developer_api_quota(p_key_id uuid, p_monthly_limit integer)
returns table(allowed boolean, remaining integer)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_month date := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC'))::date;
  v_count integer;
begin
  if p_key_id is null or p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 10000000 then
    raise exception 'invalid quota arguments' using errcode = '22023';
  end if;
  insert into public.developer_api_usage as current_usage (api_key_id, month_start, request_count, updated_at)
  values (p_key_id, v_month, 1, pg_catalog.now())
  on conflict (api_key_id, month_start) do update
  set request_count = least(current_usage.request_count + 1, p_monthly_limit + 1), updated_at = pg_catalog.now()
  returning request_count into v_count;
  return query select v_count <= p_monthly_limit, greatest(0, p_monthly_limit-v_count);
end;
$function$;

alter table public.developer_plans enable row level security;
alter table public.api_keys enable row level security;
alter table public.developer_subscriptions enable row level security;
alter table public.developer_api_usage enable row level security;
revoke all on public.developer_plans, public.api_keys, public.developer_subscriptions, public.developer_api_usage from anon, authenticated, public;
revoke all on function public.consume_developer_api_quota(uuid, integer) from public, anon, authenticated;
grant select, insert, update, delete on public.developer_plans, public.api_keys, public.developer_subscriptions, public.developer_api_usage to service_role;
grant execute on function public.consume_developer_api_quota(uuid, integer) to service_role;
