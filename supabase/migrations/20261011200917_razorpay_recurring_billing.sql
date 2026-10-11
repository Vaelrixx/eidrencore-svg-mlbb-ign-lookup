-- Recurring Razorpay subscriptions for account and workspace billing.
-- This migration only adds tracking columns and reservation RPCs; it does not
-- create Razorpay plans, initiate payments, or change existing subscriptions.

alter table public.developer_subscriptions
  add column if not exists razorpay_subscription_id text,
  add column if not exists pending_razorpay_subscription_id text,
  add column if not exists cancel_at_cycle_end boolean not null default false,
  add column if not exists last_payment_at timestamptz,
  add column if not exists razorpay_last_event_at bigint not null default 0;

alter table public.developer_workspace_subscriptions
  add column if not exists razorpay_subscription_id text,
  add column if not exists pending_razorpay_subscription_id text,
  add column if not exists cancel_at_cycle_end boolean not null default false,
  add column if not exists last_payment_at timestamptz,
  add column if not exists razorpay_last_event_at bigint not null default 0;

create unique index if not exists developer_subscriptions_razorpay_subscription_uidx
  on public.developer_subscriptions(razorpay_subscription_id)
  where razorpay_subscription_id is not null;
create unique index if not exists developer_subscriptions_pending_razorpay_subscription_uidx
  on public.developer_subscriptions(pending_razorpay_subscription_id)
  where pending_razorpay_subscription_id is not null;
create unique index if not exists developer_workspace_subscriptions_razorpay_subscription_uidx
  on public.developer_workspace_subscriptions(razorpay_subscription_id)
  where razorpay_subscription_id is not null;
create unique index if not exists developer_workspace_subscriptions_pending_razorpay_subscription_uidx
  on public.developer_workspace_subscriptions(pending_razorpay_subscription_id)
  where pending_razorpay_subscription_id is not null;

-- Use row locks to ensure concurrent requests for the same account don't create
-- multiple external Razorpay subscriptions. The service role is the only caller.
create or replace function public.reserve_developer_recurring_checkout(
  p_user_id uuid,
  p_plan_slug text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v public.developer_subscriptions%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  if p_user_id is null or p_plan_slug is null or p_plan_slug not in ('pro', 'business') then
    return pg_catalog.jsonb_build_object('result', 'invalid_request');
  end if;

  if not exists (
    select 1 from public.developer_plans p
    where p.slug = p_plan_slug and p.enabled and p.price_paise >= 100
  ) then
    return pg_catalog.jsonb_build_object('result', 'plan_unavailable');
  end if;

  insert into public.developer_subscriptions(user_id, plan_slug, status)
  values (p_user_id, 'free', 'free')
  on conflict (user_id) do nothing;

  select * into v
  from public.developer_subscriptions
  where user_id = p_user_id
  for update;

  if v.pending_razorpay_subscription_id is not null then
    if v.pending_plan_slug is distinct from p_plan_slug then
      return pg_catalog.jsonb_build_object('result', 'another_checkout_pending',
        'pending_plan_slug', v.pending_plan_slug);
    end if;
    return pg_catalog.jsonb_build_object('result', 'resume_subscription',
      'pending_subscription_id', v.pending_razorpay_subscription_id,
      'pending_plan_slug', v.pending_plan_slug,
      'pending_started_at', v.pending_started_at);
  end if;

  if v.pending_order_id is not null then
    return pg_catalog.jsonb_build_object('result', 'legacy_order_pending',
      'pending_order_id', v.pending_order_id,
      'pending_plan_slug', v.pending_plan_slug,
      'pending_started_at', v.pending_started_at);
  end if;

  if v.razorpay_subscription_id is not null
     and v.status not in ('cancelled', 'free') then
    if v.cancel_at_cycle_end then
      return pg_catalog.jsonb_build_object('result', 'cancellation_scheduled',
        'current_plan_slug', v.plan_slug,
        'current_period_end', v.current_period_end);
    end if;
    if v.pending_plan_slug is not null then
      if v.pending_plan_slug = p_plan_slug then
        return pg_catalog.jsonb_build_object('result', 'plan_change_pending',
          'current_plan_slug', v.plan_slug,
          'pending_plan_slug', v.pending_plan_slug,
          'current_period_end', v.current_period_end);
      end if;
      return pg_catalog.jsonb_build_object('result', 'another_plan_change_pending',
        'pending_plan_slug', v.pending_plan_slug);
    end if;
    if v.plan_slug = p_plan_slug then
      return pg_catalog.jsonb_build_object('result', 'already_subscribed',
        'current_plan_slug', v.plan_slug,
        'current_period_end', v.current_period_end);
    end if;
    if v.status <> 'active' then
      return pg_catalog.jsonb_build_object('result', 'subscription_needs_attention',
        'current_plan_slug', v.plan_slug,
        'current_status', v.status);
    end if;
    return pg_catalog.jsonb_build_object('result', 'change_plan',
      'current_subscription_id', v.razorpay_subscription_id,
      'current_plan_slug', v.plan_slug,
      'current_period_end', v.current_period_end);
  end if;

  if v.pending_plan_slug is not null
     and v.pending_started_at > v_now - interval '10 minutes' then
    return pg_catalog.jsonb_build_object('result', 'checkout_initializing',
      'pending_plan_slug', v.pending_plan_slug);
  end if;

  update public.developer_subscriptions
  set pending_plan_slug = p_plan_slug,
      pending_started_at = v_now,
      status = case
        when status = 'active' and current_period_end > v_now then 'active'
        else 'pending'
      end,
      updated_at = v_now
  where user_id = p_user_id;

  return pg_catalog.jsonb_build_object('result', 'reserved',
    'pending_plan_slug', p_plan_slug,
    'pending_started_at', v_now,
    'current_period_end', v.current_period_end,
    'current_status', v.status,
    'current_plan_slug', v.plan_slug);
end;
$function$;

create or replace function public.reserve_workspace_recurring_checkout(
  p_workspace_id uuid,
  p_plan_slug text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v public.developer_workspace_subscriptions%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  if p_workspace_id is null or p_plan_slug is null or p_plan_slug not in ('pro', 'business') then
    return pg_catalog.jsonb_build_object('result', 'invalid_request');
  end if;

  if not exists (
    select 1 from public.developer_plans p
    where p.slug = p_plan_slug and p.enabled and p.price_paise >= 100
  ) then
    return pg_catalog.jsonb_build_object('result', 'plan_unavailable');
  end if;

  insert into public.developer_workspace_subscriptions(workspace_id, plan_slug, status)
  values (p_workspace_id, 'free', 'active')
  on conflict (workspace_id) do nothing;

  select * into v
  from public.developer_workspace_subscriptions
  where workspace_id = p_workspace_id
  for update;

  if v.pending_razorpay_subscription_id is not null then
    if v.pending_plan_slug is distinct from p_plan_slug then
      return pg_catalog.jsonb_build_object('result', 'another_checkout_pending',
        'pending_plan_slug', v.pending_plan_slug);
    end if;
    return pg_catalog.jsonb_build_object('result', 'resume_subscription',
      'pending_subscription_id', v.pending_razorpay_subscription_id,
      'pending_plan_slug', v.pending_plan_slug,
      'pending_started_at', v.pending_started_at);
  end if;

  if v.pending_order_id is not null then
    return pg_catalog.jsonb_build_object('result', 'legacy_order_pending',
      'pending_order_id', v.pending_order_id,
      'pending_plan_slug', v.pending_plan_slug,
      'pending_started_at', v.pending_started_at);
  end if;

  if v.razorpay_subscription_id is not null
     and v.status not in ('cancelled', 'expired') then
    if v.cancel_at_cycle_end then
      return pg_catalog.jsonb_build_object('result', 'cancellation_scheduled',
        'current_plan_slug', v.plan_slug,
        'current_period_end', v.current_period_end);
    end if;
    if v.pending_plan_slug is not null then
      if v.pending_plan_slug = p_plan_slug then
        return pg_catalog.jsonb_build_object('result', 'plan_change_pending',
          'current_plan_slug', v.plan_slug,
          'pending_plan_slug', v.pending_plan_slug,
          'current_period_end', v.current_period_end);
      end if;
      return pg_catalog.jsonb_build_object('result', 'another_plan_change_pending',
        'pending_plan_slug', v.pending_plan_slug);
    end if;
    if v.plan_slug = p_plan_slug then
      return pg_catalog.jsonb_build_object('result', 'already_subscribed',
        'current_plan_slug', v.plan_slug,
        'current_period_end', v.current_period_end);
    end if;
    if v.status <> 'active' then
      return pg_catalog.jsonb_build_object('result', 'subscription_needs_attention',
        'current_plan_slug', v.plan_slug,
        'current_status', v.status);
    end if;
    return pg_catalog.jsonb_build_object('result', 'change_plan',
      'current_subscription_id', v.razorpay_subscription_id,
      'current_plan_slug', v.plan_slug,
      'current_period_end', v.current_period_end);
  end if;

  if v.pending_plan_slug is not null
     and v.pending_started_at > v_now - interval '10 minutes' then
    return pg_catalog.jsonb_build_object('result', 'checkout_initializing',
      'pending_plan_slug', v.pending_plan_slug);
  end if;

  update public.developer_workspace_subscriptions
  set pending_plan_slug = p_plan_slug,
      pending_started_at = v_now,
      status = case
        when status = 'active' and current_period_end > v_now then 'active'
        else 'pending'
      end,
      updated_at = v_now
  where workspace_id = p_workspace_id;

  return pg_catalog.jsonb_build_object('result', 'reserved',
    'pending_plan_slug', p_plan_slug,
    'pending_started_at', v_now,
    'current_period_end', v.current_period_end,
    'current_status', v.status,
    'current_plan_slug', v.plan_slug);
end;
$function$;

revoke all on function public.reserve_developer_recurring_checkout(uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_workspace_recurring_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_developer_recurring_checkout(uuid, text) to service_role;
grant execute on function public.reserve_workspace_recurring_checkout(uuid, text) to service_role;
