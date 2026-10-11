import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";
import { razorpayApi, razorpayEpochToIso, razorpaySubscriptionStartIsFuture, verifySubscriptionPaymentSignature, type RazorpaySubscription } from "@/lib/razorpay-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function problem(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return problem("Sign in required.", 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return problem("Missing payment verification details.", 400);

  const admin = createAdminClient();
  const { data: workspace } = await admin.from("developer_workspaces")
    .select("id,owner_user_id,name").eq("id", id).maybeSingle();
  if (!workspace) return problem("Workspace not found.", 404);
  let role = workspace.owner_user_id === user.id ? "owner" : null;
  if (!role) {
    const { data: member } = await admin.from("developer_workspace_members")
      .select("role").eq("workspace_id", id).eq("user_id", user.id).maybeSingle();
    role = member?.role || null;
  }
  if (!["owner", "admin"].includes(role || "")) return problem("Only workspace owners and admins can manage billing.", 403);

  const subscriptionId = typeof body.razorpay_subscription_id === "string" ? body.razorpay_subscription_id : "";
  if (subscriptionId) {
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || !paymentId || !signature) return problem("Missing subscription verification details.", 400);

    const { data: local, error: lookupError } = await admin.from("developer_workspace_subscriptions")
      .select("workspace_id,plan_slug,status,current_period_start,current_period_end,pending_plan_slug,pending_razorpay_subscription_id,razorpay_subscription_id,cancel_at_cycle_end")
      .eq("workspace_id", id).maybeSingle();
    if (lookupError) return problem("Could not load workspace subscription. Please retry.", 503);
    const isPending = local?.pending_razorpay_subscription_id === subscriptionId;
    const isCurrent = local?.razorpay_subscription_id === subscriptionId;
    if (!local || (!isPending && !isCurrent)) return problem("This subscription does not belong to this workspace or is no longer pending.", 403);
    if (!verifySubscriptionPaymentSignature(subscriptionId, paymentId, signature, secret)) return problem("Subscription payment signature did not verify.", 400);

    const remote = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(subscriptionId));
    if (!remote.ok) return problem(remote.error, remote.status);
    if (remote.data.id !== subscriptionId || remote.data.notes?.user_id !== user.id ||
        remote.data.notes?.workspace_id !== id || remote.data.notes?.billing_scope !== "workspace") {
      return problem("Razorpay subscription metadata did not match this workspace.", 403);
    }
    if (isPending && razorpaySubscriptionStartIsFuture(remote.data.start_at, remote.data.current_start)) {
    return NextResponse.json({
      success: true,
      activated: false,
      status: remote.data.status,
      message: "Authorization was verified. Your current paid term remains active until the scheduled recurring start date.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (remote.data.status !== "active") {
      if (["cancelled", "completed", "expired"].includes(remote.data.status)) {
        return problem("Razorpay reports this subscription as " + remote.data.status + ". Refresh workspace billing before trying again.", 409);
      }
      return NextResponse.json({
        success: true, activated: false, status: remote.data.status,
        message: "Subscription authorization was verified. Eidren will activate workspace access when Razorpay confirms the subscription.",
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (isCurrent && local.status === "active" && !local.pending_plan_slug) {
      return NextResponse.json({ success: true, activated: true, plan: local.plan_slug, duplicate: true });
    }
    if (remote.data.has_scheduled_changes) {
      return NextResponse.json({
        success: true, activated: false, scheduled: true,
        message: "Razorpay accepted a scheduled billing change. Workspace access will update when that change takes effect.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    let nextPlan = isPending ? local.pending_plan_slug : local.plan_slug;
    if (!isPending && local.pending_plan_slug) {
      const proId = process.env.RAZORPAY_PRO_PLAN_ID?.trim();
      const businessId = process.env.RAZORPAY_BUSINESS_PLAN_ID?.trim();
      if (remote.data.plan_id === proId) nextPlan = "pro";
      else if (remote.data.plan_id === businessId) nextPlan = "business";
      else return problem("Razorpay's active plan does not match the scheduled workspace plan. Contact support before retrying.", 409);
    }
    if (nextPlan !== "pro" && nextPlan !== "business") return problem("The pending paid workspace plan could not be identified.", 409);

    const now = new Date().toISOString();
    const periodStart = razorpayEpochToIso(remote.data.current_start) || local.current_period_start || now;
    const periodEnd = razorpayEpochToIso(remote.data.current_end) || razorpayEpochToIso(remote.data.charge_at) || local.current_period_end;
    let update = admin.from("developer_workspace_subscriptions").update({
      plan_slug: nextPlan,
      status: "active",
      razorpay_subscription_id: subscriptionId,
      pending_razorpay_subscription_id: null,
      pending_plan_slug: null,
      pending_started_at: null,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      last_payment_at: now,
      cancel_at_cycle_end: isPending ? false : local.cancel_at_cycle_end,
      updated_at: now,
    }).eq("workspace_id", id);
    update = isPending ? update.eq("pending_razorpay_subscription_id", subscriptionId) : update.eq("razorpay_subscription_id", subscriptionId);
    const { data: activated, error } = await update.select("plan_slug,current_period_start,current_period_end").maybeSingle();
    if (error) return problem("Subscription was verified, but workspace billing could not be updated. Please contact support.", 500);
    if (!activated) {
      const { data: latest } = await admin.from("developer_workspace_subscriptions")
        .select("plan_slug,status,razorpay_subscription_id").eq("workspace_id", id).maybeSingle();
      if (latest?.status === "active" && latest.razorpay_subscription_id === subscriptionId) {
        return NextResponse.json({ success: true, activated: true, plan: latest.plan_slug, duplicate: true });
      }
      return problem("Workspace billing state changed during verification. Refresh and retry.", 409);
    }
    await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("workspace_id", id).is("revoked_at", null);
    await writeAuditLog({ userId: user.id, workspaceId: id, action: "billing.workspace_subscription.activated", resourceType: "workspace_subscription", resourceId: subscriptionId, metadata: { plan: activated.plan_slug, paymentId, source: "razorpay_subscription_checkout" } });
    await emitDeveloperEvent({ userId: user.id, workspaceId: id, type: "billing.subscription.activated", data: { workspace_id: id, plan: activated.plan_slug, payment_id: paymentId, period_end: activated.current_period_end, provider: "razorpay_subscriptions" } });
    return NextResponse.json({ success: true, activated: true, plan: activated.plan_slug, periodEnd: activated.current_period_end });
  }

  // Compatibility path for one-time Orders created before recurring billing was enabled.
  const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!secret || !keyId || !orderId || !paymentId || !signature) return problem("Missing payment verification details.", 400);
  const expected = createHmac("sha256", secret).update(orderId + "|" + paymentId).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "hex"); } catch { return problem("Invalid payment signature.", 400); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return problem("Payment signature did not verify.", 400);

  const { data: subscription } = await admin.from("developer_workspace_subscriptions")
    .select("plan_slug,status,current_period_end,pending_order_id,pending_plan_slug,razorpay_order_id,razorpay_payment_id")
    .eq("workspace_id", id).maybeSingle();
  if (!subscription) return problem("Workspace checkout not found.", 404);
  if (subscription.razorpay_order_id === orderId && subscription.razorpay_payment_id === paymentId && subscription.status === "active") {
    return NextResponse.json({ success: true, plan: subscription.plan_slug, duplicate: true });
  }
  if (subscription.pending_order_id !== orderId || !subscription.pending_plan_slug) return problem("Checkout order does not belong to this workspace or is no longer pending.", 403);

  const paymentResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
    headers: { Authorization: "Basic " + Buffer.from(keyId + ":" + secret).toString("base64") },
    cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  const payment = await paymentResponse.json().catch(() => null);
  if (!paymentResponse.ok || payment?.order_id !== orderId || payment?.status !== "captured") return problem("Payment is not captured yet.", 409);
  const now = Date.now();
  const previousEnd = subscription.current_period_end ? Date.parse(subscription.current_period_end) : 0;
  const periodStart = subscription.plan_slug === subscription.pending_plan_slug ? Math.max(now, Number.isFinite(previousEnd) ? previousEnd : 0) : now;
  const periodEnd = new Date(periodStart + 30 * 86400000).toISOString();
  const { data: activated, error } = await admin.from("developer_workspace_subscriptions").update({
    plan_slug: subscription.pending_plan_slug, status: "active", razorpay_order_id: orderId, razorpay_payment_id: paymentId,
    current_period_start: new Date(periodStart).toISOString(), current_period_end: periodEnd,
    pending_order_id: null, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
  }).eq("workspace_id", id).eq("pending_order_id", orderId).select("workspace_id,plan_slug").maybeSingle();
  if (error) return problem("Payment was verified, but workspace plan activation failed.", 500);
  if (!activated) {
    const { data: current } = await admin.from("developer_workspace_subscriptions").select("status,plan_slug,razorpay_order_id,razorpay_payment_id").eq("workspace_id", id).maybeSingle();
    if (current?.status === "active" && current.razorpay_order_id === orderId && current.razorpay_payment_id === paymentId) return NextResponse.json({ success: true, plan: current.plan_slug, duplicate: true });
    return problem("Workspace checkout is no longer pending.", 409);
  }
  await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("workspace_id", id).is("revoked_at", null);
  await writeAuditLog({ userId: user.id, workspaceId: id, action: "billing.workspace_subscription.activated", resourceType: "workspace_subscription", resourceId: orderId, metadata: { plan: activated.plan_slug, paymentId } });
  await emitDeveloperEvent({ userId: user.id, workspaceId: id, type: "billing.subscription.activated", data: { workspace_id: id, plan: activated.plan_slug, payment_id: paymentId, period_end: periodEnd } });
  return NextResponse.json({ success: true, activated: true, plan: activated.plan_slug, periodEnd });
}
