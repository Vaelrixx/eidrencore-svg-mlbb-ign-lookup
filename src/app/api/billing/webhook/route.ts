import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";

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
  if (typeof event.event !== "string" || !["payment.captured", "order.paid"].includes(event.event)) return NextResponse.json({ received: true });
  const payment = event?.payload?.payment?.entity;
  const order = event?.payload?.order?.entity;
  const orderId = payment?.order_id || order?.id;
  const paymentId = payment?.id;
  if (!orderId || !paymentId) return NextResponse.json({ received: true });
  const admin = createAdminClient();
  const { data: sub } = await admin.from("developer_subscriptions")
    .select("user_id,plan_slug,status,current_period_end,pending_order_id,pending_plan_slug,razorpay_order_id,razorpay_payment_id")
    .eq("pending_order_id", orderId).maybeSingle();
  if (payment?.status && payment.status !== "captured") return NextResponse.json({ received: true });
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
    await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("user_id", activated.user_id).is("revoked_at", null);
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
