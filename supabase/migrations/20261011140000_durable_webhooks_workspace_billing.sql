-- Durable webhook outbox and workspace-owned subscriptions.
create table if not exists public.developer_webhook_outbox (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.developer_webhook_endpoints(id) on delete cascade,
  event_id uuid not null,
  event_type text not null check (char_length(event_type) between 1 and 100),
  payload jsonb not null check (pg_column_size(payload) <= 65536),
  attempt integer not null default 0 check (attempt between 0 and 8),
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
  max_attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
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
  returning q.id, q.endpoint_id, q.event_id, q.event_type, q.payload, q.attempt, q.max_attempts;
end;
$$;
revoke all on function public.claim_developer_webhook_jobs(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_developer_webhook_jobs(integer, uuid) to service_role;
