import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS } from "@/lib/platform";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const admin = createAdminClient();
  const { data: subscription } = await admin.from("developer_subscriptions").select("plan_slug,status,current_period_end").eq("user_id", user.id).maybeSingle();
  const paidIsCurrent = subscription?.status === "active" && !!subscription.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const plan = paidIsCurrent ? subscription.plan_slug : "free";
  const { data: planRow } = await admin.from("developer_plans").select("monthly_limit").eq("slug", plan).maybeSingle();
  const { data: keys } = await admin.from("api_keys").select("id").eq("user_id", user.id).is("revoked_at", null);
  const keyIds = (keys || []).map(key => key.id);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0,10);
  let monthlyUsage = 0;
  if (keyIds.length) {
    const { data: usage } = await admin.from("developer_api_usage").select("request_count").in("api_key_id", keyIds).eq("month_start", monthStart);
    monthlyUsage = (usage || []).reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  }
  const fallback = PLAN_FALLBACKS.find(item => item.slug === plan);
  return NextResponse.json({ user: { id: user.id, email: user.email }, plan, status: paidIsCurrent ? "active" : subscription?.status === "active" ? "expired" : subscription?.status || "free", currentPeriodEnd: subscription?.current_period_end || null, monthlyUsage, monthlyLimit: Number(planRow?.monthly_limit ?? fallback?.monthly_limit ?? 100) }, { headers: { "Cache-Control": "no-store" } });
}
