import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";
import { razorpayEpochToIso, razorpaySubscriptionStartIsFuture, razorpayWorkspaceStatus, razorpayUserStatus } from "@/lib/razorpay-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RazorpaySubscriptionEntity = {
  id?: string;
  status?: string;
  plan_id?: string;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  paid_count?: number;
  total_count?: number;
  remaining_count?: number;
  has_scheduled_changes?: boolean;
  change_scheduled_at?: number | null;
  notes?: Record<string, string>;
};

type RazorpayWebhookEvent = {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string; subscription_id?: string } };
    order?: { entity?: { id?: string } };
    subscription?: { entity?: RazorpaySubscriptionEntity };
  };
};

const recurringEvents = new Set([
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "subscription.paused",
  "subscription.resumed",
]);

function webhookSignatureValid(raw: string, signature: string, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function paidPlanForId(planId: string | undefined) {
  if (planId && planId === process.env.RAZORPAY_PRO_PLAN_ID?.trim()) return "pro";
  if (planId && planId === process.env.RAZORPAY_BUSINESS_PLAN_ID?.trim()) return "business";
  return null;
}

function subscriptionIsActive(eventName: string, status: string | undefined) {
  return status === "active" || status === "resumed" ||
    (["subscription.activated", "subscription.charged", "subscription.resumed"].includes(eventName) && !status);
}

function subscriptionIsTerminal(eventName: string, status: string | undefined) {
  return ["cancelled", "completed", "expired"].includes(status || "") ||
    eventName === "subscription.cancelled" || eventName === "subscription.completed";
}

function subscriptionIsFailing(eventName: string, status: string | undefined) {
  return ["pending", "halted", "paused"].includes(status || "") ||
    ["subscription.pending", "subscription.halted", "subscription.paused"].includes(eventName);
}

function problem(message: string, status = 500) {
  console.error("[razorpay-webhook]", message);
  return NextResponse.json({ error: message }, { status });
}

async function processUserSubscriptionEvent(
  admin: ReturnType<typeof createAdminClient>,
  eventName: string,
  entity: RazorpaySubscriptionEntity,
  eventAt: number,
) {
  const subscriptionId = entity.id;
  if (!subscriptionId) return NextResponse.json({ received: true });
  const fields = "user_id,plan_slug,status,current_period_end,pending_plan_slug,pending_razorpay_subscription_id,razorpay_subscription_id,cancel_at_cycle_end,razorpay_last_event_at";
  const pendingLookup = await admin.from("developer_subscriptions").select(fields).eq("pending_razorpay_subscription_id", subscriptionId).maybeSingle();
  if (pendingLookup.error) return problem("Could not read account subscription state.");
  let local = pendingLookup.data;
  const isPending = Boolean(local);
  if (!local) {
    const currentLookup = await admin.from("developer_subscriptions").select(fields).eq("razorpay_subscription_id", subscriptionId).maybeSingle();
    if (currentLookup.error) return problem("Could not read account subscription state.");
    local = currentLookup.data;
  }
  if (!local) return null; // not a subscription created by this application
  // An out-of-order "active" event for a subscription already cancelled in
  // Eidren must never restore entitlement. Pending replacement subscriptions
  // are resolved through their separate pending-ID lookup above.
  if (!isPending && local.status === "cancelled" && !subscriptionIsTerminal(eventName, entity.status)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const lastEvent = Number(local.razorpay_last_event_at || 0);
  if (eventAt < lastEvent) return NextResponse.json({ received: true, stale: true });

  const status = entity.status;
  const nowIso = new Date().toISOString();
  let currentEnd = razorpayEpochToIso(entity.current_end) || razorpayEpochToIso(entity.charge_at) || local.current_period_end;
  let nextPlan = local.plan_slug;
  let nextStatus: string = local.status;
  let pendingPlan = local.pending_plan_slug;
  let pendingSubscriptionId = local.pending_razorpay_subscription_id;
  let cancelAtCycleEnd = local.cancel_at_cycle_end;
  let clearPending = false;
  let activation = false;
  let pendingCheckoutEnded = false;
  const wasAlreadyTerminal = local.status === "cancelled" && !local.cancel_at_cycle_end &&
    !local.pending_plan_slug && !local.pending_razorpay_subscription_id;

  if (subscriptionIsTerminal(eventName, status)) {
    pendingCheckoutEnded = isPending && local.razorpay_subscription_id !== subscriptionId;
    const replacementInProgress = !isPending &&
      !!local.pending_razorpay_subscription_id &&
      local.pending_razorpay_subscription_id !== subscriptionId;
    if (pendingCheckoutEnded) {
      const priorPeriodIsCurrent = !!local.current_period_end && Date.parse(local.current_period_end) > Date.now();
      nextStatus = priorPeriodIsCurrent && ["active", "past_due"].includes(local.status) ? local.status : "free";
    } else {
      nextStatus = "cancelled";
      cancelAtCycleEnd = false;
    }
    if (!replacementInProgress) {
      pendingPlan = null;
      pendingSubscriptionId = null;
      clearPending = true;
    }
    cancelAtCycleEnd = pendingCheckoutEnded ? local.cancel_at_cycle_end : cancelAtCycleEnd;
  } else if (subscriptionIsActive(eventName, status)) {
    const providerStartIsFuture = isPending && razorpaySubscriptionStartIsFuture(entity.start_at, entity.current_start);
    if (providerStartIsFuture) {
      // A subscription that authorizes today but starts after a paid one-time
      // term must not elevate the tier before Razorpay's scheduled start date.
      const priorPeriodIsCurrent = !!local.current_period_end && Date.parse(local.current_period_end) > Date.now();
      nextStatus = priorPeriodIsCurrent && ["active", "past_due"].includes(local.status) ? local.status : "pending";
      currentEnd = local.current_period_end;
    } else if (isPending) {
      const expectedPlan = local.pending_plan_slug;
      const actualPlan = paidPlanForId(entity.plan_id);
      if (!expectedPlan || expectedPlan !== actualPlan ||
          entity.notes?.user_id !== local.user_id ||
          entity.notes?.billing_scope !== "user" ||
          entity.notes?.plan_slug !== expectedPlan) {
        return problem("Active account subscription did not match its reserved plan/owner.");
      }
      nextPlan = expectedPlan;
      pendingPlan = null;
      pendingSubscriptionId = null;
      cancelAtCycleEnd = false;
      activation = true;
      clearPending = true;
    } else if (pendingPlan && entity.has_scheduled_changes !== true) {
      const actualPlan = paidPlanForId(entity.plan_id);
      if (actualPlan === pendingPlan) {
        nextPlan = pendingPlan;
        pendingPlan = null;
        activation = nextPlan !== local.plan_slug;
        clearPending = true;
      } else if (actualPlan && actualPlan !== local.plan_slug) {
        return problem("Active account subscription plan diverged from its scheduled change.");
      }
    }
    if (!providerStartIsFuture) nextStatus = "active";
    // Do not clear a cycle-end cancellation flag when processing a normal renewal.
  } else if (subscriptionIsFailing(eventName, status)) {
    nextStatus = razorpayUserStatus(status || "pending");
    // Key-quota enforcement preserves the previous tier through any paid period.
  } else {
    // Authentication alone does not grant a paid plan. Preserve a still-valid
    // legacy period if the customer is switching from one-time billing.
    const periodIsCurrent = !!local.current_period_end && Date.parse(local.current_period_end) > Date.now();
    nextStatus = periodIsCurrent && ["active", "past_due"].includes(local.status) ? local.status : "pending";
  }

  const update = await admin.from("developer_subscriptions").update({
    ...(activation ? { plan_slug: nextPlan, razorpay_subscription_id: subscriptionId } : {}),
    status: nextStatus,
    pending_plan_slug: pendingPlan,
    pending_razorpay_subscription_id: pendingSubscriptionId,
    ...(clearPending ? { pending_started_at: null } : {}),
    cancel_at_cycle_end: cancelAtCycleEnd,
    current_period_end: currentEnd,
    ...(eventName === "subscription.charged" ? { last_payment_at: nowIso } : {}),
    razorpay_last_event_at: Math.max(lastEvent, eventAt),
    updated_at: nowIso,
  }).eq("user_id", local.user_id).lte("razorpay_last_event_at", eventAt)
    .or("razorpay_subscription_id.eq." + subscriptionId + ",pending_razorpay_subscription_id.eq." + subscriptionId)
    .select("user_id,plan_slug,status").maybeSingle();
  if (update.error) return problem("Could not update account subscription state.");
  if (!update.data) return NextResponse.json({ received: true, stale: true });

  if (activation) {
    await admin.from("api_keys").update({ plan_slug: nextPlan }).eq("user_id", local.user_id).is("workspace_id", null).is("revoked_at", null);
    await writeAuditLog({
      userId: local.user_id,
      action: nextPlan !== local.plan_slug ? "billing.subscription.activated" : "billing.subscription.renewed",
      resourceType: "subscription",
      resourceId: subscriptionId,
      metadata: { plan: nextPlan, provider: "razorpay_subscriptions", event: eventName },
    });
    if (nextPlan !== local.plan_slug) {
      await emitDeveloperEvent({
        userId: local.user_id,
        type: "billing.subscription.activated",
        data: { plan: nextPlan, period_end: currentEnd, provider: "razorpay_subscriptions" },
      });
    }
  } else if (pendingCheckoutEnded) {
    await writeAuditLog({ userId: local.user_id, action: "billing.subscription.pending_checkout_cancelled", resourceType: "subscription", resourceId: subscriptionId, metadata: { provider: "razorpay_subscriptions", event: eventName } });
  } else if (subscriptionIsTerminal(eventName, status) && !wasAlreadyTerminal) {
    await admin.from("api_keys").update({ plan_slug: "free" }).eq("user_id", local.user_id).is("workspace_id", null).is("revoked_at", null);
    await writeAuditLog({ userId: local.user_id, action: "billing.subscription.cancelled", resourceType: "subscription", resourceId: subscriptionId, metadata: { provider: "razorpay_subscriptions", event: eventName } });
    await emitDeveloperEvent({ userId: local.user_id, type: "billing.subscription.cancelled", data: { plan: local.plan_slug, provider: "razorpay_subscriptions" } });
  }
  return NextResponse.json({ received: true });
}

async function processWorkspaceSubscriptionEvent(
  admin: ReturnType<typeof createAdminClient>,
  eventName: string,
  entity: RazorpaySubscriptionEntity,
  eventAt: number,
) {
  const subscriptionId = entity.id;
  if (!subscriptionId) return NextResponse.json({ received: true });
  const fields = "workspace_id,plan_slug,status,current_period_start,current_period_end,pending_plan_slug,pending_razorpay_subscription_id,razorpay_subscription_id,cancel_at_cycle_end,razorpay_last_event_at";
  const pendingLookup = await admin.from("developer_workspace_subscriptions").select(fields).eq("pending_razorpay_subscription_id", subscriptionId).maybeSingle();
  if (pendingLookup.error) return problem("Could not read workspace subscription state.");
  let local = pendingLookup.data;
  const isPending = Boolean(local);
  if (!local) {
    const currentLookup = await admin.from("developer_workspace_subscriptions").select(fields).eq("razorpay_subscription_id", subscriptionId).maybeSingle();
    if (currentLookup.error) return problem("Could not read workspace subscription state.");
    local = currentLookup.data;
  }
  if (!local) return null; // not a subscription created by this application
  if (!isPending && local.status === "cancelled" && !subscriptionIsTerminal(eventName, entity.status)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const lastEvent = Number(local.razorpay_last_event_at || 0);
  if (eventAt < lastEvent) return NextResponse.json({ received: true, stale: true });

  const status = entity.status;
  const nowIso = new Date().toISOString();
  let currentStart = razorpayEpochToIso(entity.current_start) || local.current_period_start || nowIso;
  let currentEnd = razorpayEpochToIso(entity.current_end) || razorpayEpochToIso(entity.charge_at) || local.current_period_end;
  let nextPlan = local.plan_slug;
  let nextStatus: string = local.status;
  let pendingPlan = local.pending_plan_slug;
  let pendingSubscriptionId = local.pending_razorpay_subscription_id;
  let cancelAtCycleEnd = local.cancel_at_cycle_end;
  let clearPending = false;
  let activation = false;
  let pendingCheckoutEnded = false;
  const wasAlreadyTerminal = local.status === "cancelled" && !local.cancel_at_cycle_end &&
    !local.pending_plan_slug && !local.pending_razorpay_subscription_id;

  if (subscriptionIsTerminal(eventName, status)) {
    pendingCheckoutEnded = isPending && local.razorpay_subscription_id !== subscriptionId;
    const replacementInProgress = !isPending &&
      !!local.pending_razorpay_subscription_id &&
      local.pending_razorpay_subscription_id !== subscriptionId;
    if (pendingCheckoutEnded) {
      const priorPeriodIsCurrent = !!local.current_period_end && Date.parse(local.current_period_end) > Date.now();
      nextStatus = priorPeriodIsCurrent && ["active", "pending"].includes(local.status) ? "active" : "expired";
    } else {
      nextStatus = "cancelled";
      cancelAtCycleEnd = false;
    }
    if (!replacementInProgress) {
      pendingPlan = null;
      pendingSubscriptionId = null;
      clearPending = true;
    }
    cancelAtCycleEnd = pendingCheckoutEnded ? local.cancel_at_cycle_end : cancelAtCycleEnd;
  } else if (subscriptionIsActive(eventName, status)) {
    const providerStartIsFuture = isPending && razorpaySubscriptionStartIsFuture(entity.start_at, entity.current_start);
    if (providerStartIsFuture) {
      const priorPeriodIsCurrent = !!local.current_period_end && Date.parse(local.current_period_end) > Date.now();
      nextStatus = priorPeriodIsCurrent && ["active", "pending"].includes(local.status) ? "active" : "pending";
      currentStart = local.current_period_start || currentStart;
      currentEnd = local.current_period_end;
    } else if (isPending) {
      const expectedPlan = local.pending_plan_slug;
      const actualPlan = paidPlanForId(entity.plan_id);
      if (!expectedPlan || expectedPlan !== actualPlan ||
          entity.notes?.user_id == null ||
          entity.notes?.workspace_id !== local.workspace_id ||
          entity.notes?.billing_scope !== "workspace" ||
          entity.notes?.plan_slug !== expectedPlan) {
        return problem("Active workspace subscription did not match its reserved plan/workspace.");
      }
      nextPlan = expectedPlan;
      pendingPlan = null;
      pendingSubscriptionId = null;
      cancelAtCycleEnd = false;
      activation = true;
      clearPending = true;
    } else if (pendingPlan && entity.has_scheduled_changes !== true) {
      const actualPlan = paidPlanForId(entity.plan_id);
      if (actualPlan === pendingPlan) {
        nextPlan = pendingPlan;
        pendingPlan = null;
        activation = nextPlan !== local.plan_slug;
        clearPending = true;
      } else if (actualPlan && actualPlan !== local.plan_slug) {
        return problem("Active workspace subscription plan diverged from its scheduled change.");
      }
    }
    if (!providerStartIsFuture) nextStatus = "active";
  } else if (subscriptionIsFailing(eventName, status)) {
    nextStatus = razorpayWorkspaceStatus(status || "pending");
  } else {
    const periodIsCurrent = !!local.current_period_end && Date.parse(local.current_period_end) > Date.now();
    nextStatus = periodIsCurrent && local.status === "active" ? "active" : "pending";
  }

  const update = await admin.from("developer_workspace_subscriptions").update({
    ...(activation ? { plan_slug: nextPlan, razorpay_subscription_id: subscriptionId } : {}),
    status: nextStatus,
    pending_plan_slug: pendingPlan,
    pending_razorpay_subscription_id: pendingSubscriptionId,
    ...(clearPending ? { pending_started_at: null } : {}),
    cancel_at_cycle_end: cancelAtCycleEnd,
    current_period_start: currentStart,
    current_period_end: currentEnd,
    ...(eventName === "subscription.charged" ? { last_payment_at: nowIso } : {}),
    razorpay_last_event_at: Math.max(lastEvent, eventAt),
    updated_at: nowIso,
  }).eq("workspace_id", local.workspace_id).lte("razorpay_last_event_at", eventAt)
    .or("razorpay_subscription_id.eq." + subscriptionId + ",pending_razorpay_subscription_id.eq." + subscriptionId)
    .select("workspace_id,plan_slug,status").maybeSingle();
  if (update.error) return problem("Could not update workspace subscription state.");
  if (!update.data) return NextResponse.json({ received: true, stale: true });

  if (activation) {
    await admin.from("api_keys").update({ plan_slug: nextPlan }).eq("workspace_id", local.workspace_id).is("revoked_at", null);
    const { data: workspace } = await admin.from("developer_workspaces").select("owner_user_id").eq("id", local.workspace_id).maybeSingle();
    if (workspace?.owner_user_id) {
      await writeAuditLog({
        userId: workspace.owner_user_id,
        workspaceId: local.workspace_id,
        action: nextPlan !== local.plan_slug ? "billing.workspace_subscription.activated" : "billing.workspace_subscription.renewed",
        resourceType: "workspace_subscription",
        resourceId: subscriptionId,
        metadata: { plan: nextPlan, provider: "razorpay_subscriptions", event: eventName },
      });
      if (nextPlan !== local.plan_slug) {
        await emitDeveloperEvent({
          userId: workspace.owner_user_id, workspaceId: local.workspace_id,
          type: "billing.subscription.activated",
          data: { workspace_id: local.workspace_id, plan: nextPlan, period_end: currentEnd, provider: "razorpay_subscriptions" },
        });
      }
    }
  } else if (pendingCheckoutEnded) {
    const { data: workspace } = await admin.from("developer_workspaces").select("owner_user_id").eq("id", local.workspace_id).maybeSingle();
    if (workspace?.owner_user_id) {
      await writeAuditLog({ userId: workspace.owner_user_id, workspaceId: local.workspace_id, action: "billing.workspace_subscription.pending_checkout_cancelled", resourceType: "workspace_subscription", resourceId: subscriptionId, metadata: { provider: "razorpay_subscriptions", event: eventName } });
    }
  } else if (subscriptionIsTerminal(eventName, status) && !wasAlreadyTerminal) {
    await admin.from("api_keys").update({ plan_slug: "free" }).eq("workspace_id", local.workspace_id).is("revoked_at", null);
    const { data: workspace } = await admin.from("developer_workspaces").select("owner_user_id").eq("id", local.workspace_id).maybeSingle();
    if (workspace?.owner_user_id) {
      await writeAuditLog({ userId: workspace.owner_user_id, workspaceId: local.workspace_id, action: "billing.workspace_subscription.cancelled", resourceType: "workspace_subscription", resourceId: subscriptionId, metadata: { provider: "razorpay_subscriptions", event: eventName } });
      await emitDeveloperEvent({ userId: workspace.owner_user_id, workspaceId: local.workspace_id, type: "billing.subscription.cancelled", data: { workspace_id: local.workspace_id, plan: local.plan_slug, provider: "razorpay_subscriptions" } });
    }
  }
  return NextResponse.json({ received: true });
}

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!secret || !signature) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const raw = await request.text();
  if (!webhookSignatureValid(raw, signature, secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });

  let event: RazorpayWebhookEvent;
  try { event = JSON.parse(raw) as RazorpayWebhookEvent; }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (typeof event.event !== "string") return NextResponse.json({ received: true });
  const admin = createAdminClient();

  if (recurringEvents.has(event.event)) {
    const entity = event.payload?.subscription?.entity;
    if (!entity?.id) return NextResponse.json({ received: true });
    const eventAt = Number.isSafeInteger(event.created_at) && Number(event.created_at) > 0
      ? Number(event.created_at)
      : Math.floor(Date.now() / 1000);
    const userResult = await processUserSubscriptionEvent(admin, event.event, entity, eventAt);
    if (userResult) return userResult;
    const workspaceResult = await processWorkspaceSubscriptionEvent(admin, event.event, entity, eventAt);
    if (workspaceResult) return workspaceResult;
    return NextResponse.json({ received: true, ignored: true });
  }

  // Compatibility path for one-time Orders created before recurring billing.
  if (!["payment.captured", "order.paid"].includes(event.event)) return NextResponse.json({ received: true });
  const payment = event.payload?.payment?.entity;
  const order = event.payload?.order?.entity;
  const orderId = payment?.order_id || order?.id;
  const paymentId = payment?.id;
  if (!orderId || !paymentId) return NextResponse.json({ received: true });
  if (payment?.status && payment.status !== "captured") return NextResponse.json({ received: true });

  const { data: sub } = await admin.from("developer_subscriptions")
    .select("user_id,plan_slug,status,current_period_end,pending_order_id,pending_plan_slug,razorpay_order_id,razorpay_payment_id")
    .eq("pending_order_id", orderId).maybeSingle();
  if (sub && sub.pending_plan_slug) {
    if (sub.razorpay_order_id === orderId && sub.razorpay_payment_id && sub.razorpay_payment_id !== paymentId) return NextResponse.json({ error: "Order already has a different payment." }, { status: 409 });
    const now = Date.now();
    const previousEnd = sub.current_period_end ? Date.parse(sub.current_period_end) : 0;
    const periodStart = sub.plan_slug === sub.pending_plan_slug ? Math.max(now, Number.isFinite(previousEnd) ? previousEnd : 0) : now;
    const periodEnd = new Date(periodStart + 30 * 86400000).toISOString();
    const { data: activated, error } = await admin.from("developer_subscriptions").update({
      plan_slug: sub.pending_plan_slug, status: "active", razorpay_order_id: orderId, razorpay_payment_id: paymentId,
      current_period_end: periodEnd, pending_order_id: null, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
    }).eq("user_id", sub.user_id).eq("pending_order_id", orderId).select("user_id,plan_slug").maybeSingle();
    if (error) return NextResponse.json({ error: "Could not activate subscription." }, { status: 500 });
    if (!activated) return NextResponse.json({ received: true, duplicate: true });
    await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("user_id", activated.user_id).is("workspace_id", null).is("revoked_at", null);
    await writeAuditLog({ userId: activated.user_id, action: "billing.subscription.activated", resourceType: "subscription", resourceId: orderId, metadata: { plan: activated.plan_slug, paymentId, source: "razorpay_webhook" } });
    await emitDeveloperEvent({ userId: activated.user_id, type: "billing.subscription.activated", data: { plan: activated.plan_slug, payment_id: paymentId, period_end: periodEnd } });
    return NextResponse.json({ received: true });
  }

  const { data: workspaceSub } = await admin.from("developer_workspace_subscriptions")
    .select("workspace_id,plan_slug,status,current_period_end,pending_order_id,pending_plan_slug,razorpay_order_id,razorpay_payment_id")
    .eq("pending_order_id", orderId).maybeSingle();
  if (workspaceSub && workspaceSub.pending_plan_slug) {
    if (workspaceSub.razorpay_order_id === orderId && workspaceSub.razorpay_payment_id && workspaceSub.razorpay_payment_id !== paymentId) return NextResponse.json({ error: "Order already has a different payment." }, { status: 409 });
    const now = Date.now();
    const previousEnd = workspaceSub.current_period_end ? Date.parse(workspaceSub.current_period_end) : 0;
    const periodStart = workspaceSub.plan_slug === workspaceSub.pending_plan_slug ? Math.max(now, Number.isFinite(previousEnd) ? previousEnd : 0) : now;
    const periodEnd = new Date(periodStart + 30 * 86400000).toISOString();
    const { data: activated, error } = await admin.from("developer_workspace_subscriptions").update({
      plan_slug: workspaceSub.pending_plan_slug, status: "active", razorpay_order_id: orderId, razorpay_payment_id: paymentId,
      current_period_start: new Date(periodStart).toISOString(), current_period_end: periodEnd,
      pending_order_id: null, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspaceSub.workspace_id).eq("pending_order_id", orderId).select("workspace_id,plan_slug").maybeSingle();
    if (error) return NextResponse.json({ error: "Could not activate workspace subscription." }, { status: 500 });
    if (!activated) return NextResponse.json({ received: true, duplicate: true });
    await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("workspace_id", activated.workspace_id).is("revoked_at", null);
    const { data: workspace } = await admin.from("developer_workspaces").select("owner_user_id").eq("id", activated.workspace_id).maybeSingle();
    if (workspace?.owner_user_id) {
      await writeAuditLog({ userId: workspace.owner_user_id, workspaceId: activated.workspace_id, action: "billing.workspace_subscription.activated", resourceType: "workspace_subscription", resourceId: activated.workspace_id, metadata: { plan: activated.plan_slug, paymentId, source: "razorpay_webhook" } });
      await emitDeveloperEvent({ userId: workspace.owner_user_id, workspaceId: activated.workspace_id, type: "billing.subscription.activated", data: { workspace_id: activated.workspace_id, plan: activated.plan_slug, payment_id: paymentId, period_end: periodEnd } });
    }
    return NextResponse.json({ received: true });
  }
  return NextResponse.json({ received: true });
}
