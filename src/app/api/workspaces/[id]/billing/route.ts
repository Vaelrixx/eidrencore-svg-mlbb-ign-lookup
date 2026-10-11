import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS } from "@/lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const [{ data: subscription, error: subscriptionError }, { data: databasePlans, error: plansError }] = await Promise.all([
    admin.from("developer_workspace_subscriptions")
      .select("plan_slug,status,current_period_start,current_period_end,pending_order_id,pending_plan_slug,pending_started_at,razorpay_subscription_id,pending_razorpay_subscription_id,cancel_at_cycle_end,last_payment_at")
      .eq("workspace_id", id).maybeSingle(),
    admin.from("developer_plans").select("slug,name,price_paise,monthly_limit,enabled,description").order("price_paise"),
  ]);
  if (subscriptionError || plansError) return NextResponse.json({ error: "Could not load workspace billing. Please retry." }, { status: 503 });
  const plans = databasePlans?.length ? databasePlans : PLAN_FALLBACKS;
  const periodIsCurrent = !!subscription?.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const periodStatusAllowsAccess = subscription?.status === "active" || subscription?.status === "pending";
  const periodCurrent = periodStatusAllowsAccess && periodIsCurrent;
  const effectivePlan = periodCurrent ? subscription?.plan_slug || "free" : "free";
  const plan = plans.find(item => item.slug === effectivePlan) || PLAN_FALLBACKS[0];
  const { data: keys, error: keysError } = await admin.from("api_keys").select("id").eq("workspace_id", id);
  if (keysError) return NextResponse.json({ error: "Could not load workspace usage. Please retry." }, { status: 503 });
  const keyIds = (keys || []).map(key => key.id);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  let monthlyUsage = 0;
  if (keyIds.length) {
    const { data: usage, error: usageError } = await admin.from("developer_api_usage").select("request_count").in("api_key_id", keyIds).eq("month_start", monthStart);
    if (usageError) return NextResponse.json({ error: "Could not load workspace usage. Please retry." }, { status: 503 });
    monthlyUsage = (usage || []).reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  }

  const hasRecurringSubscription = !!subscription?.razorpay_subscription_id &&
    ["active", "pending"].includes(subscription?.status || "");
  const pendingKind = subscription?.pending_razorpay_subscription_id
    ? "subscription"
    : subscription?.pending_order_id
      ? "one_time"
      : subscription?.razorpay_subscription_id && subscription.pending_plan_slug
        ? "plan_change"
        : null;
  const checkoutPending = !!pendingKind || !!(!subscription?.razorpay_subscription_id && subscription?.pending_plan_slug);
  const status = periodCurrent && subscription?.status === "pending"
    ? "past_due"
    : subscription?.status === "active" && !periodIsCurrent
      ? "expired"
      : subscription?.status || "active";

  return NextResponse.json({
    subscription: subscription ? {
      plan: subscription.plan_slug,
      status,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      checkoutPending,
      pendingPlan: subscription.pending_plan_slug,
      pendingKind,
      hasRecurringSubscription,
      cancelAtCycleEnd: !!subscription.cancel_at_cycle_end,
      lastPaymentAt: subscription.last_payment_at || null,
    } : {
      plan: "free", status: "active", currentPeriodStart: null, currentPeriodEnd: null,
      checkoutPending: false, pendingPlan: null, pendingKind: null,
      hasRecurringSubscription: false, cancelAtCycleEnd: false, lastPaymentAt: null,
    },
    effectivePlan,
    monthlyUsage,
    monthlyLimit: Number(plan.monthly_limit || 100),
    plans,
    currentRole: role,
    recurringConfigured: Boolean(
      process.env.RAZORPAY_KEY_ID?.trim() &&
      process.env.RAZORPAY_KEY_SECRET?.trim() &&
      process.env.RAZORPAY_PRO_PLAN_ID?.trim() &&
      process.env.RAZORPAY_BUSINESS_PLAN_ID?.trim()
    ),
  }, { headers: { "Cache-Control": "no-store" } });
}
