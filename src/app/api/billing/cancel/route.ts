import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";
import { razorpayApi, type RazorpaySubscription } from "@/lib/razorpay-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function problem(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const { user } = await requireUser();
  if (!user) return problem("Sign in required.", 401);
  const admin = createAdminClient();
  const { data: current, error } = await admin.from("developer_subscriptions")
    .select("user_id,plan_slug,status,current_period_end,razorpay_subscription_id,pending_razorpay_subscription_id,pending_plan_slug,pending_order_id,cancel_at_cycle_end")
    .eq("user_id", user.id).maybeSingle();
  if (error) return problem("Could not load your billing state. Please retry.", 503);
  if (!current) return problem("No subscription was found for this account.", 404);

  // Canceling a newly created, not-yet-active subscription must not cancel the
  // currently paid subscription/legacy entitlement.
  if (current.pending_razorpay_subscription_id) {
    const id = current.pending_razorpay_subscription_id;
    const remote = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(id));
    if (!remote.ok) return problem(remote.error, remote.status);
    if (remote.data.notes?.user_id !== user.id || remote.data.notes?.billing_scope !== "user") return problem("The pending subscription does not match this account.", 403);
    if (!["cancelled", "completed", "expired"].includes(remote.data.status)) {
      const cancelled = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(id) + "/cancel", {
        method: "POST", body: { cancel_at_cycle_end: false },
      });
      if (!cancelled.ok) return problem(cancelled.error, cancelled.status);
    }
    const restorePaidPeriod = ["active", "past_due"].includes(current.status) && !!current.current_period_end && Date.parse(current.current_period_end) > Date.now();
    const restoredStatus = restorePaidPeriod ? current.status : "free";
    const { error: updateError } = await admin.from("developer_subscriptions").update({
      pending_razorpay_subscription_id: null,
      pending_plan_slug: null,
      pending_started_at: null,
      status: restoredStatus,
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("pending_razorpay_subscription_id", id);
    if (updateError) return problem("Razorpay cancelled the pending subscription, but Eidren could not save that state. Please refresh billing and contact support if it remains pending.", 500);
    await writeAuditLog({ userId: user.id, action: "billing.subscription.pending_checkout_cancelled", resourceType: "subscription", resourceId: id, metadata: { provider: "razorpay_subscriptions" } });
    return NextResponse.json({ success: true, cancelled: true, pendingCheckout: true, status: restoredStatus }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!current.razorpay_subscription_id) {
    if (current.pending_order_id) return problem("A one-time order checkout is pending. Close or finish that checkout before managing recurring billing.");
    return problem("This account has no active recurring subscription to cancel.", 409);
  }
  if (current.cancel_at_cycle_end) {
    return NextResponse.json({ success: true, cancelAtCycleEnd: true, currentPeriodEnd: current.current_period_end, alreadyScheduled: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const id = current.razorpay_subscription_id;
  const remote = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(id));
  if (!remote.ok) return problem(remote.error, remote.status);
  if (remote.data.notes?.user_id !== user.id || remote.data.notes?.billing_scope !== "user") return problem("The current subscription does not match this account.", 403);
  // Cancel an already-scheduled plan change first. A customer who cancels
  // renewal should not accidentally receive a different tier at cycle end.
  if (remote.data.has_scheduled_changes) {
    const scheduleCancel = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(id) + "/cancel_scheduled_changes", { method: "POST" });
    if (!scheduleCancel.ok) return problem("Could not cancel the scheduled plan change: " + scheduleCancel.error, scheduleCancel.status);
    const { error: clearPendingError } = await admin.from("developer_subscriptions").update({
      pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("razorpay_subscription_id", id);
    if (clearPendingError) return problem("Razorpay cancelled the scheduled plan change, but Eidren could not reconcile it. Refresh billing and contact support.", 500);
  } else if (current.pending_plan_slug) {
    const remotePlan = remote.data.plan_id === process.env.RAZORPAY_PRO_PLAN_ID?.trim() ? "pro"
      : remote.data.plan_id === process.env.RAZORPAY_BUSINESS_PLAN_ID?.trim() ? "business" : null;
    if (remotePlan && remotePlan === current.pending_plan_slug && remotePlan !== current.plan_slug) {
      const { error: reconcileError } = await admin.from("developer_subscriptions").update({
        plan_slug: remotePlan, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("razorpay_subscription_id", id);
      if (reconcileError) return problem("The provider already changed the plan, but Eidren could not reconcile it. Contact support before cancelling.", 500);
      await admin.from("api_keys").update({ plan_slug: remotePlan }).eq("user_id", user.id).is("workspace_id", null).is("revoked_at", null);
    }
  }

  if (["cancelled", "completed", "expired"].includes(remote.data.status)) {
    const { error: updateError } = await admin.from("developer_subscriptions").update({
      status: "cancelled", cancel_at_cycle_end: false, pending_plan_slug: null, pending_started_at: null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("razorpay_subscription_id", id);
    if (updateError) return problem("Razorpay says the subscription has ended, but Eidren could not save that state.", 500);
    await admin.from("api_keys").update({ plan_slug: "free" }).eq("user_id", user.id).is("workspace_id", null).is("revoked_at", null);
    return NextResponse.json({ success: true, cancelled: true, currentPeriodEnd: current.current_period_end });
  }

  const periodEndIsFuture = !!current.current_period_end && Date.parse(current.current_period_end) > Date.now();
  const cancelAtCycleEnd = periodEndIsFuture &&
    !["cancelled", "completed", "expired"].includes(remote.data.status);
  const cancellation = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(id) + "/cancel", {
    method: "POST", body: { cancel_at_cycle_end: cancelAtCycleEnd },
  });
  if (!cancellation.ok) return problem(cancellation.error, cancellation.status);

  const returnedStatus = cancellation.data.status || remote.data.status;
  const immediate = !cancelAtCycleEnd || ["cancelled", "completed", "expired"].includes(returnedStatus);
  const { error: updateError } = await admin.from("developer_subscriptions").update({
    status: immediate ? "cancelled" : current.status,
    cancel_at_cycle_end: !immediate,
    pending_plan_slug: null,
    pending_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("user_id", user.id).eq("razorpay_subscription_id", id);
  if (updateError) return problem("Razorpay accepted the cancellation, but Eidren could not save the status. Please refresh billing and contact support.", 500);

  if (immediate) {
    await admin.from("api_keys").update({ plan_slug: "free" }).eq("user_id", user.id).is("workspace_id", null).is("revoked_at", null);
    await writeAuditLog({ userId: user.id, action: "billing.subscription.cancelled", resourceType: "subscription", resourceId: id, metadata: { provider: "razorpay_subscriptions", source: "user_request" } });
    await emitDeveloperEvent({ userId: user.id, type: "billing.subscription.cancelled", data: { plan: current.plan_slug, provider: "razorpay_subscriptions" } });
    return NextResponse.json({ success: true, cancelled: true, currentPeriodEnd: current.current_period_end });
  }
  await writeAuditLog({ userId: user.id, action: "billing.subscription.cancellation_scheduled", resourceType: "subscription", resourceId: id, metadata: { provider: "razorpay_subscriptions", currentPeriodEnd: current.current_period_end } });
  await emitDeveloperEvent({ userId: user.id, type: "billing.subscription.cancellation_scheduled", data: { plan: current.plan_slug, period_end: current.current_period_end, provider: "razorpay_subscriptions" } });
  return NextResponse.json({ success: true, cancelled: false, cancelAtCycleEnd: true, currentPeriodEnd: current.current_period_end }, { headers: { "Cache-Control": "no-store" } });
}
