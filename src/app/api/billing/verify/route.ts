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

async function verifyRecurringCheckout(userId: string, payment: Record<string, unknown>) {
  const subscriptionId = typeof payment.razorpay_subscription_id === "string" ? payment.razorpay_subscription_id : "";
  const paymentId = typeof payment.razorpay_payment_id === "string" ? payment.razorpay_payment_id : "";
  const signature = typeof payment.razorpay_signature === "string" ? payment.razorpay_signature : "";
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !subscriptionId || !paymentId || !signature) return problem("Missing subscription verification details.", 400);

  const admin = createAdminClient();
  const { data: local, error: lookupError } = await admin.from("developer_subscriptions")
    .select("user_id,plan_slug,status,current_period_end,pending_plan_slug,pending_razorpay_subscription_id,razorpay_subscription_id,cancel_at_cycle_end")
    .eq("user_id", userId).maybeSingle();
  if (lookupError) return problem("Could not load your subscription. Please retry.", 503);
  const isPending = local?.pending_razorpay_subscription_id === subscriptionId;
  const isCurrent = local?.razorpay_subscription_id === subscriptionId;
  if (!local || (!isPending && !isCurrent)) return problem("This subscription does not belong to your account or is no longer pending.", 403);
  if (!verifySubscriptionPaymentSignature(subscriptionId, paymentId, signature, secret)) {
    return problem("Subscription payment signature did not verify.", 400);
  }

  const remote = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(subscriptionId));
  if (!remote.ok) return problem(remote.error, remote.status);
  if (remote.data.id !== subscriptionId || remote.data.notes?.user_id !== userId || remote.data.notes?.billing_scope !== "user") {
    return problem("Razorpay subscription metadata did not match this account.", 403);
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
      return problem("Razorpay reports this subscription as " + remote.data.status + ". Refresh billing before trying again.", 409);
    }
    return NextResponse.json({
      success: true,
      activated: false,
      status: remote.data.status,
      message: "Payment authorization was verified. Eidren will activate your plan when Razorpay confirms the subscription.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (isCurrent && local.status === "active") {
    return NextResponse.json({ success: true, activated: true, plan: local.plan_slug, duplicate: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date().toISOString();
  const nextPlan = isPending ? local.pending_plan_slug : local.plan_slug;
  if (nextPlan !== "pro" && nextPlan !== "business") return problem("The pending paid plan could not be identified.", 409);
  const periodEnd = razorpayEpochToIso(remote.data.current_end) || razorpayEpochToIso(remote.data.charge_at) || local.current_period_end;
  let query = admin.from("developer_subscriptions").update({
    plan_slug: nextPlan,
    status: "active",
    razorpay_subscription_id: subscriptionId,
    pending_razorpay_subscription_id: null,
    pending_plan_slug: null,
    pending_started_at: null,
    current_period_end: periodEnd,
    last_payment_at: now,
    cancel_at_cycle_end: isPending ? false : local.cancel_at_cycle_end,
    updated_at: now,
  }).eq("user_id", userId);
  query = isPending ? query.eq("pending_razorpay_subscription_id", subscriptionId) : query.eq("razorpay_subscription_id", subscriptionId);
  const { data: activated, error } = await query.select("plan_slug,current_period_end").maybeSingle();
  if (error) return problem("Payment authorization was verified, but the subscription update failed. Please contact support.", 500);
  if (!activated) {
    const { data: latest } = await admin.from("developer_subscriptions")
      .select("plan_slug,status,razorpay_subscription_id").eq("user_id", userId).maybeSingle();
    if (latest?.status === "active" && latest.razorpay_subscription_id === subscriptionId) {
      return NextResponse.json({ success: true, activated: true, plan: latest.plan_slug, duplicate: true });
    }
    return problem("Subscription state changed during verification. Refresh billing and retry.", 409);
  }

  await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("user_id", userId).is("revoked_at", null);
  await writeAuditLog({ userId, action: "billing.subscription.activated", resourceType: "subscription", resourceId: subscriptionId, metadata: { plan: activated.plan_slug, paymentId, source: "razorpay_subscription_checkout" } });
  await emitDeveloperEvent({ userId, type: "billing.subscription.activated", data: { plan: activated.plan_slug, payment_id: paymentId, period_end: activated.current_period_end, provider: "razorpay_subscriptions" } });
  return NextResponse.json({ success: true, activated: true, plan: activated.plan_slug, periodEnd: activated.current_period_end }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return problem("Sign in required.", 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return problem("Missing payment verification details.", 400);

  if (typeof body.razorpay_subscription_id === "string") {
    return verifyRecurringCheckout(user.id, body as Record<string, unknown>);
  }

  // Compatibility path for checkouts created before recurring billing was enabled.
  const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return problem("Missing payment verification details.", 400);

  const expected = createHmac("sha256", secret).update(orderId + "|" + paymentId).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "hex"); } catch { return problem("Invalid payment signature.", 400); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return problem("Payment signature did not verify.", 400);

  const admin = createAdminClient();
  const { data: subscription } = await admin.from("developer_subscriptions")
    .select("plan_slug,razorpay_order_id,razorpay_payment_id,status,current_period_end,pending_order_id,pending_plan_slug")
    .eq("user_id", user.id).maybeSingle();
  if (!subscription) return problem("Checkout order does not belong to this account.", 403);
  if (subscription.razorpay_order_id === orderId && subscription.razorpay_payment_id === paymentId && subscription.status === "active") {
    return NextResponse.json({ success: true, plan: subscription.plan_slug, duplicate: true });
  }
  if (subscription.pending_order_id !== orderId || !subscription.pending_plan_slug) {
    return problem("Checkout order does not belong to this account or is no longer pending.", 403);
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) return problem("Razorpay is not configured.", 503);
  const paymentResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
    headers: { Authorization: "Basic " + Buffer.from(keyId + ":" + secret).toString("base64") },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const paymentRecord = await paymentResponse.json().catch(() => null);
  if (!paymentResponse.ok || paymentRecord?.order_id !== orderId || paymentRecord?.status !== "captured") {
    return problem("Payment is not captured yet.", 409);
  }
  if (subscription.razorpay_order_id === orderId && subscription.razorpay_payment_id && subscription.razorpay_payment_id !== paymentId) {
    return problem("Checkout order already has a different payment.", 409);
  }

  const now = Date.now();
  const previousEnd = subscription.current_period_end ? Date.parse(subscription.current_period_end) : 0;
  const periodStart = subscription.plan_slug === subscription.pending_plan_slug ? Math.max(now, Number.isFinite(previousEnd) ? previousEnd : 0) : now;
  const periodEnd = new Date(periodStart + 30 * 86400000).toISOString();
  const { data: activated, error } = await admin.from("developer_subscriptions").update({
    plan_slug: subscription.pending_plan_slug, status: "active", razorpay_order_id: orderId, razorpay_payment_id: paymentId,
    current_period_end: periodEnd, pending_order_id: null, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString(),
  }).eq("user_id", user.id).eq("pending_order_id", orderId).select("user_id,plan_slug").maybeSingle();
  if (error) return problem("Payment was verified, but the plan could not be activated. Contact support.", 500);
  if (!activated) {
    const { data: current } = await admin.from("developer_subscriptions").select("status,razorpay_payment_id,razorpay_order_id,plan_slug").eq("user_id", user.id).maybeSingle();
    if (current?.status === "active" && current.razorpay_order_id === orderId && current.razorpay_payment_id === paymentId) {
      return NextResponse.json({ success: true, plan: current.plan_slug, duplicate: true });
    }
    return problem("Checkout order is no longer pending.", 409);
  }
  await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("user_id", user.id).is("revoked_at", null);
  await writeAuditLog({ userId: user.id, action: "billing.subscription.activated", resourceType: "subscription", resourceId: orderId, metadata: { plan: activated.plan_slug, paymentId } });
  await emitDeveloperEvent({ userId: user.id, type: "billing.subscription.activated", data: { plan: activated.plan_slug, payment_id: paymentId, period_end: periodEnd } });
  return NextResponse.json({ success: true, activated: true, plan: activated.plan_slug, periodEnd });
}
