import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS } from "@/lib/platform";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id").eq("id", id).maybeSingle();
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  let role = workspace.owner_user_id === user.id ? "owner" : null;
  if (!role) {
    const { data: member } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", id).eq("user_id", user.id).maybeSingle();
    role = member?.role || null;
  }
  if (!role) return NextResponse.json({ error: "Workspace not found or access denied." }, { status: 404 });
  if (!["owner", "admin"].includes(role)) return NextResponse.json({ error: "Only workspace owners and admins can view billing." }, { status: 403 });
  const [{ data: subscription }, { data: databasePlans }] = await Promise.all([
    admin.from("developer_workspace_subscriptions").select("plan_slug,status,current_period_start,current_period_end,pending_order_id,pending_plan_slug,pending_started_at").eq("workspace_id", id).maybeSingle(),
    admin.from("developer_plans").select("slug,name,price_paise,monthly_limit,enabled,description").order("price_paise"),
  ]);
  const plans = databasePlans?.length ? databasePlans : PLAN_FALLBACKS;
  const periodCurrent = subscription?.status === "active" && !!subscription.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const effectivePlan = periodCurrent ? subscription?.plan_slug || "free" : "free";
  const plan = plans.find(item => item.slug === effectivePlan) || PLAN_FALLBACKS[0];
  const { data: keys } = await admin.from("api_keys").select("id").eq("workspace_id", id).is("revoked_at", null);
  const keyIds = (keys || []).map(key => key.id);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  let monthlyUsage = 0;
  if (keyIds.length) {
    const { data: usage } = await admin.from("developer_api_usage").select("request_count").in("api_key_id", keyIds).eq("month_start", monthStart);
    monthlyUsage = (usage || []).reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  }
  return NextResponse.json({
    subscription: subscription ? { plan: subscription.plan_slug, status: periodCurrent ? "active" : subscription.status === "pending" ? "pending" : "expired", currentPeriodStart: subscription.current_period_start, currentPeriodEnd: subscription.current_period_end, checkoutPending: !!subscription.pending_order_id, pendingPlan: subscription.pending_plan_slug } : { plan: "free", status: "active", currentPeriodStart: null, currentPeriodEnd: null, checkoutPending: false, pendingPlan: null },
    effectivePlan,
    monthlyUsage,
    monthlyLimit: Number(plan.monthly_limit || 100),
    plans,
    currentRole: role,
  }, { headers: { "Cache-Control": "no-store" } });
}
