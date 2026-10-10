import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS } from "@/lib/platform";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const slug = typeof body?.plan === "string" ? body.plan : "";
  if (!["pro", "business"].includes(slug)) return NextResponse.json({ error: "Choose a paid workspace plan." }, { status: 400 });
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return NextResponse.json({ error: "Razorpay is not configured." }, { status: 503 });
  const admin = createAdminClient();
  const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id,name").eq("id", id).maybeSingle();
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  let role = workspace.owner_user_id === user.id ? "owner" : null;
  if (!role) {
    const { data: member } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", id).eq("user_id", user.id).maybeSingle();
    role = member?.role || null;
  }
  if (!["owner", "admin"].includes(role || "")) return NextResponse.json({ error: "Only workspace owners and admins can manage billing." }, { status: 403 });
  const { data: plan } = await admin.from("developer_plans").select("slug,name,price_paise,enabled").eq("slug", slug).maybeSingle();
  const fallback = PLAN_FALLBACKS.find(item => item.slug === slug);
  const price = Number(plan?.price_paise ?? fallback?.price_paise ?? 0);
  if (!(plan?.enabled ?? fallback?.enabled ?? false) || price < 100) return NextResponse.json({ error: "This paid plan is not enabled." }, { status: 409 });
  const { data: current } = await admin.from("developer_workspace_subscriptions").select("status,pending_order_id,pending_plan_slug,pending_started_at,plan_slug,current_period_end").eq("workspace_id", id).maybeSingle();
  if (current?.pending_order_id) {
    if (current.pending_plan_slug !== slug) return NextResponse.json({ error: "A different workspace plan checkout is pending. Resume or finish it first." }, { status: 409 });
    const existingResponse = await fetch("https://api.razorpay.com/v1/orders/" + encodeURIComponent(current.pending_order_id), {
      headers: { Authorization: "Basic " + Buffer.from(keyId + ":" + secret).toString("base64") },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const existingOrder = await existingResponse.json().catch(() => null);
    if (!existingResponse.ok || !existingOrder?.id) return NextResponse.json({ error: "Could not retrieve the pending workspace order." }, { status: 502 });
    if (existingOrder.status === "paid") return NextResponse.json({ error: "This workspace order is already paid. Refresh billing status in a moment." }, { status: 409 });
    if (existingOrder.notes?.workspace_id !== id || existingOrder.notes?.plan_slug !== slug) return NextResponse.json({ error: "Pending checkout metadata did not match this workspace." }, { status: 409 });
    return NextResponse.json({ keyId, orderId: existingOrder.id, amount: existingOrder.amount || price, currency: existingOrder.currency || "INR", name: "Eidren Developer Platform", description: (plan?.name || fallback?.name || slug) + " workspace plan", prefill: { email: user.email || "" } }, { headers: { "Cache-Control": "no-store" } });
  }
  const now = new Date().toISOString();
  const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(keyId + ":" + secret).toString("base64"), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: price, currency: "INR", receipt: "eidren_ws_" + id.slice(0, 8) + "_" + Date.now(), notes: { workspace_id: id, user_id: user.id, plan_slug: slug } }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const order = await orderResponse.json().catch(() => null);
  if (!orderResponse.ok || !order?.id) return NextResponse.json({ error: "Razorpay could not create a workspace order." }, { status: 502 });
  const pending = { status: current?.status === "active" && !!current.current_period_end && Date.parse(current.current_period_end) > Date.now() ? "active" : "pending", pending_order_id: order.id, pending_plan_slug: slug, pending_started_at: now, updated_at: now };
  const { error } = current
    ? await admin.from("developer_workspace_subscriptions").update(pending).eq("workspace_id", id)
    : await admin.from("developer_workspace_subscriptions").insert({ workspace_id: id, plan_slug: "free", ...pending });
  if (error) return NextResponse.json({ error: "Could not save workspace checkout state." }, { status: 500 });
  return NextResponse.json({ keyId, orderId: order.id, amount: price, currency: "INR", name: "Eidren Developer Platform", description: (plan?.name || fallback?.name || slug) + " workspace plan", prefill: { email: user.email || "" } }, { headers: { "Cache-Control": "no-store" } });
}
