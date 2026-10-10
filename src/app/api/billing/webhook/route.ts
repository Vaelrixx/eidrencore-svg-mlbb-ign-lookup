import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RazorpayWebhookEvent = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string } };
    order?: { entity?: { id?: string } };
  };
};
export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!secret || !signature) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const raw = await request.text();
  const expected = createHmac("sha256", secret).update(raw).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "hex"); } catch { return NextResponse.json({ error: "Invalid signature." }, { status: 400 }); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  let event: RazorpayWebhookEvent;
  try { event = JSON.parse(raw) as RazorpayWebhookEvent; } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!["payment.captured", "order.paid"].includes(event?.event)) return NextResponse.json({ received: true });
  const payment = event?.payload?.payment?.entity;
  const order = event?.payload?.order?.entity;
  const orderId = payment?.order_id || order?.id;
  const paymentId = payment?.id;
  if (!orderId || !paymentId) return NextResponse.json({ received: true });
  const admin = createAdminClient();
  const { data: sub } = await admin.from("developer_subscriptions").select("user_id,plan_slug,razorpay_order_id").eq("razorpay_order_id", orderId).maybeSingle();
  if (!sub) return NextResponse.json({ received: true });
  if (payment?.status && payment.status !== "captured") return NextResponse.json({ received: true });
  const { error } = await admin.from("developer_subscriptions").update({ status: "active", razorpay_payment_id: paymentId, current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), updated_at: new Date().toISOString() }).eq("user_id", sub.user_id).eq("razorpay_order_id", orderId);
  if (error) return NextResponse.json({ error: "Could not update subscription." }, { status: 500 });
  await admin.from("api_keys").update({ plan_slug: sub.plan_slug }).eq("user_id", sub.user_id).is("revoked_at", null);
  return NextResponse.json({ received: true });
}
