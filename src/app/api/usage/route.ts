import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS } from "@/lib/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const admin = createAdminClient();
  const [{ data: subscription }, { data: keyRows, error: keysError }] = await Promise.all([
    admin.from("developer_subscriptions").select("plan_slug,status,current_period_end").eq("user_id", user.id).maybeSingle(),
    admin.from("api_keys").select("id,name,key_prefix,plan_slug,created_at,last_used_at,revoked_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (keysError) return NextResponse.json({ error: "Could not load usage analytics." }, { status: 500 });
  const paidIsCurrent = subscription?.status === "active" && !!subscription.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const planSlug = paidIsCurrent ? subscription.plan_slug : "free";
  const { data: planRow } = await admin.from("developer_plans").select("monthly_limit").eq("slug", planSlug).maybeSingle();
  const fallback = PLAN_FALLBACKS.find(plan => plan.slug === planSlug);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  const keyIds = (keyRows || []).map(key => key.id);
  const activeKeyIds = (keyRows || []).filter(key => !key.revoked_at).map(key => key.id);
  let monthlyUsage: number;
  let dailyRows: { usage_day: string; request_count: number; api_key_id: string }[] = [];
  const monthlyQuery = activeKeyIds.length
    ? admin.from("developer_api_usage").select("request_count").in("api_key_id", activeKeyIds).eq("month_start", monthStart)
    : Promise.resolve({ data: [], error: null });
  const dailyQuery = keyIds.length
    ? admin.from("developer_api_usage_daily").select("api_key_id,usage_day,request_count").in("api_key_id", keyIds).gte("usage_day", new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10)).order("usage_day", { ascending: true })
    : Promise.resolve({ data: [], error: null });
  const [{ data: monthlyRows }, dailyResult] = await Promise.all([monthlyQuery, dailyQuery]);
  monthlyUsage = (monthlyRows || []).reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  dailyRows = (dailyResult.data || []) as typeof dailyRows;
  const daily = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(Date.now() - (13 - index) * 86400000);
    const label = day.toISOString().slice(0, 10);
    return { date: label, requests: dailyRows.filter(row => row.usage_day === label).reduce((sum, row) => sum + Number(row.request_count || 0), 0) };
  });
  const keys = (keyRows || []).map(key => ({
    id: key.id, name: key.name, prefix: key.key_prefix, plan: key.plan_slug,
    createdAt: key.created_at, lastUsedAt: key.last_used_at, revoked: !!key.revoked_at,
  }));
  return NextResponse.json({
    plan: planSlug, monthlyUsage, monthlyLimit: Number(planRow?.monthly_limit ?? fallback?.monthly_limit ?? 100),
    activeKeys: keys.filter(key => !key.revoked).length, totalKeys: keys.length, daily, keys,
    periodStart: monthStart,
  }, { headers: { "Cache-Control": "no-store" } });
}
