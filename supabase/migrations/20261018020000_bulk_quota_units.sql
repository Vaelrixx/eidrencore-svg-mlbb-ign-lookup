-- Bulk verification consumes one quota unit per item. Both quota RPCs gain an
-- optional p_units argument (default 1) so existing single-lookup callers keep
-- working unchanged while bulk callers consume atomically in one call.
create or replace function public.consume_developer_api_quota(p_key_id uuid, p_monthly_limit integer, p_units integer default 1)
returns table(allowed boolean, remaining integer)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_month date := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC'))::date;
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_count integer;
  v_units integer := greatest(1, least(coalesce(p_units, 1), 100));
begin
  if p_key_id is null or p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 10000000 then
    raise exception 'invalid quota arguments' using errcode = '22023';
  end if;
  insert into public.developer_api_usage as current_usage (api_key_id, month_start, request_count, updated_at)
  values (p_key_id, v_month, v_units, pg_catalog.now())
  on conflict (api_key_id, month_start) do update
  set request_count = least(current_usage.request_count + v_units, p_monthly_limit + v_units),
      updated_at = pg_catalog.now()
  returning request_count into v_count;
  if v_count <= p_monthly_limit then
    insert into public.developer_api_usage_daily as daily_usage (api_key_id, usage_day, request_count, updated_at)
    values (p_key_id, v_day, v_units, pg_catalog.now())
    on conflict (api_key_id, usage_day) do update
    set request_count = least(daily_usage.request_count + v_units, 2147483647),
        updated_at = pg_catalog.now();
  end if;
  return query select v_count <= p_monthly_limit, greatest(0, p_monthly_limit-v_count);
end;
$function$;
revoke all on function public.consume_developer_api_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_developer_api_quota(uuid, integer, integer) to service_role;

create or replace function public.consume_workspace_api_quota(
  p_workspace_id uuid,
  p_key_id uuid,
  p_monthly_limit integer,
  p_units integer default 1
)
returns table(allowed boolean, remaining integer)
language plpgsql
set search_path = ''
as $function$
declare
  v_month date := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC'))::date;
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_used integer;
  v_units integer := greatest(1, least(coalesce(p_units, 1), 100));
begin
  if p_workspace_id is null or p_key_id is null or p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 10000000 then
    raise exception 'invalid workspace quota arguments' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 0));

  if not exists (
    select 1 from public.api_keys k
    where k.id = p_key_id and k.workspace_id = p_workspace_id and k.revoked_at is null
  ) then
    raise exception 'workspace API key is not active' using errcode = '22023';
  end if;

  select coalesce(sum(u.request_count), 0)::integer
  into v_used
  from public.developer_api_usage u
  join public.api_keys k on k.id = u.api_key_id
  where k.workspace_id = p_workspace_id and u.month_start = v_month;

  if v_used + v_units > p_monthly_limit then
    return query select false, greatest(0, p_monthly_limit - v_used);
    return;
  end if;

  insert into public.developer_api_usage as current_usage (api_key_id, month_start, request_count, updated_at)
  values (p_key_id, v_month, v_units, pg_catalog.now())
  on conflict (api_key_id, month_start) do update
  set request_count = current_usage.request_count + v_units,
      updated_at = pg_catalog.now();
  insert into public.developer_api_usage_daily as daily_usage (api_key_id, usage_day, request_count, updated_at)
  values (p_key_id, v_day, v_units, pg_catalog.now())
  on conflict (api_key_id, usage_day) do update
  set request_count = daily_usage.request_count + v_units,
      updated_at = pg_catalog.now();
  return query select true, greatest(0, p_monthly_limit - v_used - v_units);
end;
$function$;
revoke all on function public.consume_workspace_api_quota(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_workspace_api_quota(uuid, uuid, integer, integer) to service_role;
