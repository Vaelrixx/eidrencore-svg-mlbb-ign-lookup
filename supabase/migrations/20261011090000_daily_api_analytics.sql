create table if not exists public.developer_api_usage_daily (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  usage_day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (api_key_id, usage_day)
);

create index if not exists developer_api_usage_daily_day_idx
  on public.developer_api_usage_daily(usage_day desc, api_key_id);

alter table public.developer_api_usage_daily enable row level security;
revoke all on public.developer_api_usage_daily from anon, authenticated, public;
grant select, insert, update, delete on public.developer_api_usage_daily to service_role;

create or replace function public.consume_developer_api_quota(p_key_id uuid, p_monthly_limit integer)
returns table(allowed boolean, remaining integer)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_month date := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC'))::date;
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_count integer;
begin
  if p_key_id is null or p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 10000000 then
    raise exception 'invalid quota arguments' using errcode = '22023';
  end if;

  insert into public.developer_api_usage as current_usage (api_key_id, month_start, request_count, updated_at)
  values (p_key_id, v_month, 1, pg_catalog.now())
  on conflict (api_key_id, month_start) do update
  set request_count = least(current_usage.request_count + 1, p_monthly_limit + 1),
      updated_at = pg_catalog.now()
  returning request_count into v_count;

  if v_count <= p_monthly_limit then
    insert into public.developer_api_usage_daily as daily_usage (api_key_id, usage_day, request_count, updated_at)
    values (p_key_id, v_day, 1, pg_catalog.now())
    on conflict (api_key_id, usage_day) do update
    set request_count = least(daily_usage.request_count + 1, 2147483647),
        updated_at = pg_catalog.now();
  end if;

  return query select v_count <= p_monthly_limit, greatest(0, p_monthly_limit-v_count);
end;
$function$;

revoke all on function public.consume_developer_api_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_developer_api_quota(uuid, integer) to service_role;
