import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const orderId = typeof body?.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const paymentId = typeof body?.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const signature = typeof body?.razorpay_signature === "string" ? body.razorpay_signature : "";
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!secret || !keyId || !orderId || !paymentId || !signature) return NextResponse.json({ error: "Missing payment verification details." }, { status: 400 });
  const expected = createHmac("sha256", secret).update(orderId + "|" + paymentId).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "hex"); } catch { return NextResponse.json({ error: "Invalid payment signature." }, { status: 400 }); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Payment signature did not verify." }, { status: 400 });
  const admin = createAdminClient();
  const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id,name").eq("id", id).maybeSingle();
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  let role = workspace.owner_user_id === user.id ? "owner" : null;
  if (!role) {
    const { data: member } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", id).eq("user_id", user.id).maybeSingle();
    role = member?.role || null;
  }
  if (!["owner", "admin"].includes(role || "")) return NextResponse.json({ error: "Only workspace owners and admins can manage billing." }, { status: 403 });
  const { data: subscription } = await admin.from("developer_workspace_subscriptions").select("plan_slug,status,current_period_end,pending_order_id,pending_plan_slug,razorpay_order_id,razorpay_payment_id").eq("workspace_id", id).maybeSingle();
  if (!subscription) return NextResponse.json({ error: "Workspace checkout not found." }, { status: 404 });
  if (subscription.razorpay_order_id === orderId && subscription.razorpay_payment_id === paymentId && subscription.status === "active") return NextResponse.json({ success: true, plan: subscription.plan_slug, duplicate: true });
  if (subscription.pending_order_id !== orderId || !subscription.pending_plan_slug) return NextResponse.json({ error: "Checkout order does not belong to this workspace or is no longer pending." }, { status: 403 });
  const paymentResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
    headers: { Authorization: "Basic " + Buffer.from(keyId + ":" + secret).toString("base64") },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const payment = await paymentResponse.json().catch(() => null);
  if (!paymentResponse.ok || payment?.order_id !== orderId || payment?.status !== "captured") return NextResponse.json({ error: "Payment is not captured yet." }, { status: 409 });
  const now = Date.now();
  const previousEnd = subscription.current_period_end ? Date.parse(subscription.current_period_end) : 0;
  const periodStart = subscription.plan_slug === subscription.pending_plan_slug ? Math.max(now, Number.isFinite(previousEnd) ? previousEnd : 0) : now;
  const periodEnd = new Date(periodStart + 30 * 86400000).toISOString();
  const { data: activated, error } = await admin.from("developer_workspace_subscriptions").update({
    plan_slug: subscription.pending_plan_slug,
    status: "active",
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    current_period_start: new Date(periodStart).toISOString(),
    current_period_end: periodEnd,
    pending_order_id: null,
    pending_plan_slug: null,
    pending_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", id).eq("pending_order_id", orderId).select("workspace_id,plan_slug").maybeSingle();
  if (error) return NextResponse.json({ error: "Payment was verified, but workspace plan activation failed." }, { status: 500 });
  if (!activated) {
    const { data: current } = await admin.from("developer_workspace_subscriptions").select("status,plan_slug,razorpay_order_id,razorpay_payment_id").eq("workspace_id", id).maybeSingle();
    if (current?.status === "active" && current.razorpay_order_id === orderId && current.razorpay_payment_id === paymentId) return NextResponse.json({ success: true, plan: current.plan_slug, duplicate: true });
    return NextResponse.json({ error: "Workspace checkout is no longer pending." }, { status: 409 });
  }
  await admin.from("api_keys").update({ plan_slug: activated.plan_slug }).eq("workspace_id", id).is("revoked_at", null);
  await writeAuditLog({ userId: user.id, workspaceId: id, action: "billing.workspace_subscription.activated", resourceType: "workspace_subscription", resourceId: id, metadata: { plan: activated.plan_slug, paymentId } });
  await emitDeveloperEvent({ userId: user.id, workspaceId: id, type: "billing.subscription.activated", data: { workspace_id: id, plan: activated.plan_slug, payment_id: paymentId, period_end: periodEnd } });
  return NextResponse.json({ success: true, plan: activated.plan_slug, periodEnd });
}
