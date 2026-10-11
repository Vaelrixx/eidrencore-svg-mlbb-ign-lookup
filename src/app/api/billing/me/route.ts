import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS, ensureDeveloperAccount } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const admin = createAdminClient();
  const { data: subscription, error: subscriptionError } = await admin.from("developer_subscriptions")
    .select("plan_slug,status,current_period_end,razorpay_subscription_id,pending_razorpay_subscription_id,pending_plan_slug,pending_order_id,cancel_at_cycle_end,last_payment_at")
    .eq("user_id", user.id).maybeSingle();
  if (subscriptionError) return NextResponse.json({ error: "Could not load billing status. Please retry." }, { status: 503 });
  if (!subscription) await ensureDeveloperAccount(user.id);

  const periodIsCurrent = !!subscription?.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const paidIsCurrent = periodIsCurrent && ["active", "past_due"].includes(subscription?.status || "");
  const plan = paidIsCurrent ? subscription!.plan_slug : "free";
  const { data: planRow } = await admin.from("developer_plans").select("monthly_limit").eq("slug", plan).maybeSingle();
  const { data: keys } = await admin.from("api_keys").select("id").eq("user_id", user.id).is("workspace_id", null).is("revoked_at", null);
  const keyIds = (keys || []).map(key => key.id);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  let monthlyUsage = 0;
  if (keyIds.length) {
    const { data: usage } = await admin.from("developer_api_usage").select("request_count").in("api_key_id", keyIds).eq("month_start", monthStart);
    monthlyUsage = (usage || []).reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  }
  const fallback = PLAN_FALLBACKS.find(item => item.slug === plan);
  const hasRecurringSubscription = !!subscription?.razorpay_subscription_id &&
    ["active", "past_due", "pending"].includes(subscription?.status || "");
  const pendingKind = subscription?.pending_razorpay_subscription_id
    ? "subscription"
    : subscription?.pending_order_id
      ? "one_time"
      : subscription?.razorpay_subscription_id && subscription.pending_plan_slug
        ? "plan_change"
        : null;
  const checkoutPending = !!pendingKind || !!(!subscription?.razorpay_subscription_id && subscription?.pending_plan_slug);
  const publicStatus = paidIsCurrent && subscription?.status === "past_due"
    ? "past_due"
    : subscription?.status === "active" && !periodIsCurrent
      ? "expired"
      : subscription?.status || "free";

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    plan,
    status: publicStatus,
    currentPeriodEnd: subscription?.current_period_end || null,
    monthlyUsage,
    monthlyLimit: Number(planRow?.monthly_limit ?? fallback?.monthly_limit ?? 100),
    hasRecurringSubscription,
    cancelAtCycleEnd: !!subscription?.cancel_at_cycle_end,
    checkoutPending,
    pendingPlan: subscription?.pending_plan_slug || null,
    pendingKind,
    lastPaymentAt: subscription?.last_payment_at || null,
  }, { headers: { "Cache-Control": "no-store" } });
}
