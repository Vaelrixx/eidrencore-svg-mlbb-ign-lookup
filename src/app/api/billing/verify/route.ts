import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const orderId = typeof body?.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const paymentId = typeof body?.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const signature = typeof body?.razorpay_signature === "string" ? body.razorpay_signature : "";
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return NextResponse.json({ error: "Missing payment verification details." }, { status: 400 });
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "hex"); } catch { return NextResponse.json({ error: "Invalid payment signature." }, { status: 400 }); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Payment signature did not verify." }, { status: 400 });
  const admin = createAdminClient();
  const { data: subscription } = await admin.from("developer_subscriptions").select("plan_slug,razorpay_order_id,razorpay_payment_id,status,current_period_end,pending_order_id,pending_plan_slug").eq("user_id", user.id).maybeSingle();
  if (!subscription) return NextResponse.json({ error: "Checkout order does not belong to this account." }, { status: 403 });
  if (subscription.razorpay_order_id === orderId && subscription.razorpay_payment_id === paymentId && subscription.status === "active") return NextResponse.json({ success: true, plan: subscription.plan_slug, duplicate: true });
  if (subscription.pending_order_id !== orderId || !subscription.pending_plan_slug) return NextResponse.json({ error: "Checkout order does not belong to this account or is no longer pending." }, { status: 403 });
  const keyId = process.env.RAZORPAY_KEY_ID;
  const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64") }, cache: "no-store" });
  const payment = await paymentResponse.json().catch(() => null);
  if (!paymentResponse.ok || payment?.order_id !== orderId || payment?.status !== "captured") return NextResponse.json({ error: "Payment is not captured yet." }, { status: 409 });
  if (subscription.status === "active" && subscription.razorpay_payment_id === paymentId) return NextResponse.json({ success: true, plan: subscription.plan_slug, duplicate: true });
  if (subscription.razorpay_order_id === orderId && subscription.razorpay_payment_id && subscription.razorpay_payment_id !== paymentId) return NextResponse.json({ error: "Checkout order already has a different payment." }, { status: 409 });
  const now = Date.now();
  const previousEnd = subscription.current_period_end ? Date.parse(subscription.current_period_end) : 0;
  const periodStart = subscription.plan_slug === subscription.pending_plan_slug ? Math.max(now, Number.isFinite(previousEnd) ? previousEnd : 0) : now;
  const periodEnd = new Date(periodStart + 30 * 86400000).toISOString();
  const { data: activated, error } = await admin.from("developer_subscriptions").update({ plan_slug: subscription.pending_plan_slug, status: "active", razorpay_order_id: orderId, razorpay_payment_id: paymentId, current_period_end: periodEnd, pending_order_id: null, pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("pending_order_id", orderId).select("user_id,plan_slug").maybeSingle();
  if (error) return NextResponse.json({ error: "Payment was verified, but the plan could not be activated. Contact support." }, { status: 500 });
  if (!activated) {
    const { data: current } = await admin.from("developer_subscriptions").select("status,razorpay_payment_id").eq("user_id", user.id).eq("razorpay_order_id", orderId).maybeSingle();
    if (current?.status === "active" && current.razorpay_payment_id === paymentId) return NextResponse.json({ success: true, plan: subscription.plan_slug, duplicate: true });
    return NextResponse.json({ error: "Checkout order is no longer pending." }, { status: 409 });
  }
  await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("user_id", user.id).is("revoked_at", null);
  await writeAuditLog({ userId: user.id, action: "billing.subscription.activated", resourceType: "subscription", resourceId: orderId, metadata: { plan: activated.plan_slug, paymentId } });
  await emitDeveloperEvent({ userId: user.id, type: "billing.subscription.activated", data: { plan: activated.plan_slug, payment_id: paymentId, period_end: periodEnd } });
  return NextResponse.json({ success: true, plan: activated.plan_slug, periodEnd });
}
