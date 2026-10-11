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

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return problem("Sign in required.", 401);
  const { id: workspaceId } = await context.params;
  const admin = createAdminClient();
  const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return problem("Workspace not found.", 404);
  let role = workspace.owner_user_id === user.id ? "owner" : null;
  if (!role) {
    const { data: member } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    role = member?.role || null;
  }
  if (!["owner", "admin"].includes(role || "")) return problem("Only workspace owners and admins can manage billing.", 403);

  const { data: current, error } = await admin.from("developer_workspace_subscriptions")
    .select("workspace_id,plan_slug,status,current_period_end,razorpay_subscription_id,pending_razorpay_subscription_id,pending_plan_slug,pending_order_id,cancel_at_cycle_end")
    .eq("workspace_id", workspaceId).maybeSingle();
  if (error) return problem("Could not load workspace billing state. Please retry.", 503);
  if (!current) return problem("No workspace subscription was found.", 404);

  if (current.pending_razorpay_subscription_id) {
    const pendingId = current.pending_razorpay_subscription_id;
    const remote = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(pendingId));
    if (!remote.ok) return problem(remote.error, remote.status);
    if (remote.data.notes?.user_id !== user.id || remote.data.notes?.workspace_id !== workspaceId || remote.data.notes?.billing_scope !== "workspace") {
      return problem("The pending subscription does not match this workspace.", 403);
    }
    if (!["cancelled", "completed", "expired"].includes(remote.data.status)) {
      const cancelled = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(pendingId) + "/cancel", {
        method: "POST", body: { cancel_at_cycle_end: false },
      });
      if (!cancelled.ok) return problem(cancelled.error, cancelled.status);
    }
    const restorePaidPeriod = ["active", "pending"].includes(current.status) && !!current.current_period_end && Date.parse(current.current_period_end) > Date.now();
    const { error: updateError } = await admin.from("developer_workspace_subscriptions").update({
      pending_razorpay_subscription_id: null,
      pending_plan_slug: null,
      pending_started_at: null,
      status: restorePaidPeriod ? "active" : "expired",
      updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspaceId).eq("pending_razorpay_subscription_id", pendingId);
    if (updateError) return problem("Razorpay cancelled the pending subscription, but Eidren could not save that state. Please refresh and contact support if it remains pending.", 500);
    await writeAuditLog({ userId: user.id, workspaceId, action: "billing.workspace_subscription.pending_checkout_cancelled", resourceType: "workspace_subscription", resourceId: pendingId, metadata: { provider: "razorpay_subscriptions" } });
    return NextResponse.json({ success: true, cancelled: true, pendingCheckout: true }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!current.razorpay_subscription_id) {
    if (current.pending_order_id) return problem("A one-time order checkout is pending. Close or finish that checkout before managing recurring workspace billing.");
    return problem("This workspace has no active recurring subscription to cancel.", 409);
  }
  if (current.cancel_at_cycle_end) {
    return NextResponse.json({ success: true, cancelAtCycleEnd: true, currentPeriodEnd: current.current_period_end, alreadyScheduled: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const subscriptionId = current.razorpay_subscription_id;
  const remote = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(subscriptionId));
  if (!remote.ok) return problem(remote.error, remote.status);
  if (remote.data.notes?.user_id !== user.id || remote.data.notes?.workspace_id !== workspaceId || remote.data.notes?.billing_scope !== "workspace") {
    return problem("The current subscription does not match this workspace.", 403);
  }
  // Cancel any queued plan change before scheduling cancellation at cycle end.
  if (remote.data.has_scheduled_changes) {
    const scheduleCancel = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(subscriptionId) + "/cancel_scheduled_changes", { method: "POST" });
    if (!scheduleCancel.ok) return problem("Could not cancel the scheduled workspace plan change: " + scheduleCancel.error, scheduleCancel.status);
    const { error: clearPendingError } = await admin.from("developer_workspace_subscriptions").update({
      pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspaceId).eq("razorpay_subscription_id", subscriptionId);
    if (clearPendingError) return problem("Razorpay cancelled the scheduled plan change, but Eidren could not reconcile it. Refresh billing and contact support.", 500);
  } else if (current.pending_plan_slug) {
    const remotePlan = remote.data.plan_id === process.env.RAZORPAY_PRO_PLAN_ID?.trim() ? "pro"
      : remote.data.plan_id === process.env.RAZORPAY_BUSINESS_PLAN_ID?.trim() ? "business" : null;
    if (remotePlan && remotePlan === current.pending_plan_slug && remotePlan !== current.plan_slug) {
      const { error: reconcileError } = await admin.from("developer_workspace_subscriptions").update({
        plan_slug: remotePlan, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
      }).eq("workspace_id", workspaceId).eq("razorpay_subscription_id", subscriptionId);
      if (reconcileError) return problem("The provider already changed the workspace plan, but Eidren could not reconcile it. Contact support before cancelling.", 500);
      await admin.from("api_keys").update({ plan_slug: remotePlan }).eq("workspace_id", workspaceId).is("revoked_at", null);
    }
  }

  if (["cancelled", "completed", "expired"].includes(remote.data.status)) {
    const { error: updateError } = await admin.from("developer_workspace_subscriptions").update({
      status: "cancelled", cancel_at_cycle_end: false, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspaceId).eq("razorpay_subscription_id", subscriptionId);
    if (updateError) return problem("Razorpay says the subscription has ended, but Eidren could not save that state.", 500);
    await admin.from("api_keys").update({ plan_slug: "free" }).eq("workspace_id", workspaceId).is("revoked_at", null);
    return NextResponse.json({ success: true, cancelled: true, currentPeriodEnd: current.current_period_end });
  }

  const periodEndIsFuture = !!current.current_period_end && Date.parse(current.current_period_end) > Date.now();
  const cancelAtCycleEnd = periodEndIsFuture &&
    !["cancelled", "completed", "expired"].includes(remote.data.status);
  const cancellation = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(subscriptionId) + "/cancel", {
    method: "POST", body: { cancel_at_cycle_end: cancelAtCycleEnd },
  });
  if (!cancellation.ok) return problem(cancellation.error, cancellation.status);
  const returnedStatus = cancellation.data.status || remote.data.status;
  const immediate = !cancelAtCycleEnd || ["cancelled", "completed", "expired"].includes(returnedStatus);
  const { error: updateError } = await admin.from("developer_workspace_subscriptions").update({
    status: immediate ? "cancelled" : current.status,
    cancel_at_cycle_end: !immediate,
    pending_plan_slug: null,
    pending_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", workspaceId).eq("razorpay_subscription_id", subscriptionId);
  if (updateError) return problem("Razorpay accepted the cancellation, but Eidren could not save the status. Please refresh and contact support.", 500);

  if (immediate) {
    await admin.from("api_keys").update({ plan_slug: "free" }).eq("workspace_id", workspaceId).is("revoked_at", null);
    await writeAuditLog({ userId: user.id, workspaceId, action: "billing.workspace_subscription.cancelled", resourceType: "workspace_subscription", resourceId: subscriptionId, metadata: { provider: "razorpay_subscriptions", source: "user_request" } });
    await emitDeveloperEvent({ userId: user.id, workspaceId, type: "billing.subscription.cancelled", data: { workspace_id: workspaceId, plan: current.plan_slug, provider: "razorpay_subscriptions" } });
    return NextResponse.json({ success: true, cancelled: true, currentPeriodEnd: current.current_period_end });
  }

  await writeAuditLog({ userId: user.id, workspaceId, action: "billing.workspace_subscription.cancellation_scheduled", resourceType: "workspace_subscription", resourceId: subscriptionId, metadata: { provider: "razorpay_subscriptions", currentPeriodEnd: current.current_period_end } });
  await emitDeveloperEvent({ userId: user.id, workspaceId, type: "billing.subscription.cancellation_scheduled", data: { workspace_id: workspaceId, plan: current.plan_slug, period_end: current.current_period_end, provider: "razorpay_subscriptions" } });
  return NextResponse.json({ success: true, cancelled: false, cancelAtCycleEnd: true, currentPeriodEnd: current.current_period_end }, { headers: { "Cache-Control": "no-store" } });
}
