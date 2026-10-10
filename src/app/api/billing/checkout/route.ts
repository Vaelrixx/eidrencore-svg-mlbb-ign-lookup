import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS } from "@/lib/platform";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const slug = typeof body?.plan === "string" ? body.plan : "";
  if (!["pro", "business"].includes(slug)) return NextResponse.json({ error: "Choose a paid plan." }, { status: 400 });
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return NextResponse.json({ error: "Razorpay is not configured yet. Add server-side Razorpay credentials to enable paid checkout." }, { status: 503 });
  const admin = createAdminClient();
  const { data: plan } = await admin.from("developer_plans").select("slug,name,price_paise,enabled").eq("slug", slug).maybeSingle();
  const fallback = PLAN_FALLBACKS.find(p => p.slug === slug);
  const price = Number(plan?.price_paise ?? fallback?.price_paise ?? 0);
  const enabled = plan?.enabled ?? fallback?.enabled ?? false;
  if (!enabled || price < 100) return NextResponse.json({ error: "This paid plan is not enabled yet. Set its price and enable it in the developer_plans table." }, { status: 409 });
  const { data: current } = await admin.from("developer_subscriptions").select("plan_slug,status,current_period_end,pending_order_id,pending_plan_slug,pending_started_at").eq("user_id", user.id).maybeSingle();
  if (current?.pending_order_id) {
    if (current.pending_plan_slug !== slug) return NextResponse.json({ error: "A different plan checkout is pending. Resume or finish that checkout first." }, { status: 409 });
    const existingResponse = await fetch("https://api.razorpay.com/v1/orders/" + encodeURIComponent(current.pending_order_id), {
      headers: { Authorization: "Basic " + Buffer.from(keyId + ":" + secret).toString("base64") },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const existingOrder = await existingResponse.json().catch(() => null);
    if (!existingResponse.ok || !existingOrder?.id) return NextResponse.json({ error: "Could not retrieve the pending checkout order." }, { status: 502 });
    if (existingOrder.status === "paid") return NextResponse.json({ error: "This order is already paid. Refresh your billing status in a moment." }, { status: 409 });
    if (existingOrder.notes?.user_id !== user.id || existingOrder.notes?.plan_slug !== slug) return NextResponse.json({ error: "Pending checkout metadata did not match this account." }, { status: 409 });
    return NextResponse.json({ keyId, orderId: existingOrder.id, amount: existingOrder.amount || price, currency: existingOrder.currency || "INR", name: "Eidren Developer Platform", description: (plan?.name || fallback?.name || slug) + " monthly plan", prefill: { email: user.email || "" } }, { headers: { "Cache-Control": "no-store" } });
  }
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(keyId + ":" + secret).toString("base64"), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: price, currency: "INR", receipt: "eidren_" + user.id.slice(0, 8) + "_" + Date.now(), notes: { user_id: user.id, plan_slug: slug } }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const order = await response.json().catch(() => null);
  if (!response.ok || !order?.id) return NextResponse.json({ error: "Razorpay could not create an order." }, { status: 502 });
  const active = current?.status === "active" && !!current.current_period_end && Date.parse(current.current_period_end) > Date.now();
  const pending = { status: active ? "active" : "pending", pending_order_id: order.id, pending_plan_slug: slug, pending_started_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const { error } = current
    ? await admin.from("developer_subscriptions").update(pending).eq("user_id", user.id)
    : await admin.from("developer_subscriptions").insert({ user_id: user.id, plan_slug: "free", ...pending });
  if (error) return NextResponse.json({ error: "Could not save checkout state." }, { status: 500 });
  return NextResponse.json({ keyId, orderId: order.id, amount: price, currency: "INR", name: "Eidren Developer Platform", description: `${plan?.name || fallback?.name || slug} monthly plan`, prefill: { email: user.email || "" } }, { headers: { "Cache-Control": "no-store" } });
}
