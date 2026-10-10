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
  const { data: subscription } = await admin.from("developer_subscriptions").select("plan_slug,razorpay_order_id").eq("user_id", user.id).maybeSingle();
  if (!subscription || subscription.razorpay_order_id !== orderId) return NextResponse.json({ error: "Checkout order does not belong to this account." }, { status: 403 });
  const keyId = process.env.RAZORPAY_KEY_ID;
  const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64") }, cache: "no-store" });
  const payment = await paymentResponse.json().catch(() => null);
  if (!paymentResponse.ok || payment?.order_id !== orderId || payment?.status !== "captured") return NextResponse.json({ error: "Payment is not captured yet." }, { status: 409 });
  const { error } = await admin.from("developer_subscriptions").update({ status: "active", razorpay_payment_id: paymentId, current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("razorpay_order_id", orderId);
  if (error) return NextResponse.json({ error: "Payment was verified, but the plan could not be activated. Contact support." }, { status: 500 });
  await admin.from("api_keys").update({ plan_slug: subscription.plan_slug }).eq("user_id", user.id).is("revoked_at", null);
  await writeAuditLog({ userId: user.id, action: "billing.subscription.activated", resourceType: "subscription", resourceId: orderId, metadata: { plan: subscription.plan_slug, paymentId } });
  await emitDeveloperEvent({ userId: user.id, type: "billing.subscription.activated", data: { plan: subscription.plan_slug, payment_id: paymentId, period_end: new Date(Date.now() + 30 * 86400000).toISOString() } });
  return NextResponse.json({ success: true, plan: subscription.plan_slug });
}
