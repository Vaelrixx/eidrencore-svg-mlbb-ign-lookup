-- Durable webhook outbox and workspace-owned subscriptions.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
alter table public.developer_subscriptions add column if not exists pending_order_id text unique;
alter table public.developer_subscriptions add column if not exists pending_plan_slug text references public.developer_plans(slug);
alter table public.developer_subscriptions add column if not exists pending_started_at timestamptz;
create table if not exists public.developer_webhook_outbox (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.developer_webhook_endpoints(id) on delete cascade,
  event_id uuid not null,
  event_type text not null check (char_length(event_type) between 1 and 100),
  payload jsonb not null check (pg_column_size(payload) <= 65536),
  attempt integer not null default 0 check (attempt between 0 and 8),
  replay_count integer not null default 0 check (replay_count between 0 and 100),
  max_attempts integer not null default 8 check (max_attempts between 1 and 8),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  response_status integer,
  response_ms integer,
  created_at timestamptz not null default now(),
  unique(endpoint_id, event_id)
);
create index if not exists developer_webhook_outbox_due_idx
  on public.developer_webhook_outbox(available_at, created_at)
  where delivered_at is null and dead_lettered_at is null;
create index if not exists developer_webhook_outbox_endpoint_idx
  on public.developer_webhook_outbox(endpoint_id, created_at desc);
alter table public.developer_webhook_deliveries add column if not exists delivery_run integer not null default 0;
drop index if exists public.developer_webhook_deliveries_event_attempt_idx;
create unique index if not exists developer_webhook_deliveries_event_attempt_idx
  on public.developer_webhook_deliveries(endpoint_id, event_id, delivery_run, attempt);

create table if not exists public.developer_workspace_subscriptions (
  workspace_id uuid primary key references public.developer_workspaces(id) on delete cascade,
  plan_slug text not null default 'free' references public.developer_plans(slug),
  status text not null default 'active' check (status in ('active','pending','expired','cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  pending_order_id text unique,
  pending_plan_slug text references public.developer_plans(slug),
  pending_started_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists developer_workspace_subscriptions_plan_idx
  on public.developer_workspace_subscriptions(plan_slug, status, current_period_end);

alter table public.developer_webhook_outbox enable row level security;
alter table public.developer_workspace_subscriptions enable row level security;
revoke all on public.developer_webhook_outbox, public.developer_workspace_subscriptions from anon, authenticated, public;
grant select, insert, update, delete on public.developer_webhook_outbox, public.developer_workspace_subscriptions to service_role;

create or replace function public.claim_developer_webhook_jobs(p_batch_size integer, p_lock_token uuid)
returns table (
  id uuid,
  endpoint_id uuid,
  event_id uuid,
  event_type text,
  payload jsonb,
  attempt integer,
  max_attempts integer,
  replay_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select q.id
    from public.developer_webhook_outbox q
    where q.delivered_at is null
      and q.dead_lettered_at is null
      and q.available_at <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '2 minutes')
    order by q.available_at asc, q.created_at asc
    for update skip locked
    limit least(greatest(coalesce(p_batch_size, 10), 1), 50)
  )
  update public.developer_webhook_outbox q
  set locked_at = now(), lock_token = p_lock_token
  from due
  where q.id = due.id
  returning q.id, q.endpoint_id, q.event_id, q.event_type, q.payload, q.attempt, q.max_attempts, q.replay_count;
end;
$$;
revoke all on function public.claim_developer_webhook_jobs(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_developer_webhook_jobs(integer, uuid) to service_role;




create or replace function public.consume_workspace_api_quota(
  p_workspace_id uuid,
  p_key_id uuid,
  p_monthly_limit integer
)
returns table(allowed boolean, remaining integer)
language plpgsql
set search_path = ''
as $function$
declare
  v_month date := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC'))::date;
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_used integer;
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

  if v_used >= p_monthly_limit then
    return query select false, 0;
    return;
  end if;

  insert into public.developer_api_usage as current_usage (api_key_id, month_start, request_count, updated_at)
  values (p_key_id, v_month, 1, pg_catalog.now())
  on conflict (api_key_id, month_start) do update
  set request_count = current_usage.request_count + 1,
      updated_at = pg_catalog.now();

  insert into public.developer_api_usage_daily as daily_usage (api_key_id, usage_day, request_count, updated_at)
  values (p_key_id, v_day, 1, pg_catalog.now())
  on conflict (api_key_id, usage_day) do update
  set request_count = daily_usage.request_count + 1,
      updated_at = pg_catalog.now();

  return query select true, greatest(0, p_monthly_limit - v_used - 1);
end;
$function$;
revoke all on function public.consume_workspace_api_quota(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_workspace_api_quota(uuid, uuid, integer) to service_role;

-- Bound storage growth while retaining enough history for investigations.
select cron.schedule(
  'eidren-webhook-outbox-retention',
  '15 3 * * *',
  $$ delete from public.developer_webhook_outbox
     where delivered_at < now() - interval '30 days'
        or dead_lettered_at < now() - interval '90 days' $$
);
select cron.schedule(
  'eidren-webhook-delivery-retention',
  '25 3 * * *',
  $$ delete from public.developer_webhook_deliveries
     where created_at < now() - interval '90 days' $$
);
