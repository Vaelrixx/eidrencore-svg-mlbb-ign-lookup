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
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64"), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: price, currency: "INR", receipt: `eidren_${user.id.slice(0, 8)}_${Date.now()}`, notes: { user_id: user.id, plan_slug: slug } }),
    cache: "no-store",
  });
  const order = await response.json().catch(() => null);
  if (!response.ok || !order?.id) return NextResponse.json({ error: "Razorpay could not create an order." }, { status: 502 });
  const { error } = await admin.from("developer_subscriptions").upsert({ user_id: user.id, plan_slug: slug, status: "pending", razorpay_order_id: order.id, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: "Could not save checkout state." }, { status: 500 });
  return NextResponse.json({ keyId, orderId: order.id, amount: price, currency: "INR", name: "Eidren Developer Platform", description: `${plan?.name || fallback?.name || slug} monthly plan`, prefill: { email: user.email || "" } }, { headers: { "Cache-Control": "no-store" } });
}
