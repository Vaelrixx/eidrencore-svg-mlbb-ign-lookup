import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, PLAN_FALLBACKS } from "@/lib/platform";
import { createRazorpaySubscription, publicRazorpayKeyId, razorpayApi, validateRecurringPlan, type RazorpaySubscription } from "@/lib/razorpay-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanRow = { slug: string; name: string; price_paise: number; enabled: boolean };
type Reservation = {
  result: string;
  pending_subscription_id?: string | null;
  pending_order_id?: string | null;
  pending_plan_slug?: string | null;
  current_subscription_id?: string | null;
  current_plan_slug?: string | null;
  current_period_end?: string | null;
  current_status?: string | null;
};

function problem(message: string, status = 409) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function releaseReservation(admin: ReturnType<typeof createAdminClient>, userId: string, slug: string) {
  const { data: current } = await admin.from("developer_subscriptions")
    .select("status,pending_plan_slug")
    .eq("user_id", userId).eq("pending_plan_slug", slug)
    .is("pending_razorpay_subscription_id", null).is("pending_order_id", null)
    .maybeSingle();
  if (!current) return;
  await admin.from("developer_subscriptions").update({
    pending_plan_slug: null,
    pending_started_at: null,
    status: current.status === "pending" ? "free" : current.status,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("pending_plan_slug", slug).is("pending_razorpay_subscription_id", null);
}

async function resumeOneTimeOrder(input: {
  userId: string; slug: string; name: string; price: number; orderId: string; email: string; keyId: string;
}) {
  const order = await razorpayApi<{ id: string; status?: string; amount?: number; currency?: string; notes?: Record<string, string> }>(
    "/orders/" + encodeURIComponent(input.orderId),
  );
  if (!order.ok || !order.data.id) return problem("Could not resume the earlier one-time checkout. Refresh billing or contact support.", 502);
  if (order.data.notes?.user_id !== input.userId || order.data.notes?.plan_slug !== input.slug) {
    return problem("The pending one-time order does not match this account and plan.");
  }
  if (order.data.status === "paid") return problem("This older checkout is already paid. Refresh billing; if your plan is not active, contact support.");
  return NextResponse.json({
    mode: "one_time",
    keyId: input.keyId,
    orderId: order.data.id,
    amount: order.data.amount || input.price,
    currency: order.data.currency || "INR",
    name: "Eidren Developer Platform",
    description: input.name + " one-time checkout (existing pending order)",
    prefill: { email: input.email },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return problem("Sign in required.", 401);

  const body = await request.json().catch(() => null);
  const slug = typeof body?.plan === "string" ? body.plan : "";
  if (slug !== "pro" && slug !== "business") return problem("Choose a paid plan.", 400);

  const admin = createAdminClient();
  const { data: planRow } = await admin.from("developer_plans")
    .select("slug,name,price_paise,enabled").eq("slug", slug).maybeSingle();
  const fallback = PLAN_FALLBACKS.find(item => item.slug === slug);
  const plan: PlanRow = {
    slug,
    name: planRow?.name || fallback?.name || slug,
    price_paise: Number(planRow?.price_paise ?? fallback?.price_paise ?? 0),
    enabled: Boolean(planRow?.enabled ?? fallback?.enabled ?? false),
  };
  if (!plan.enabled || plan.price_paise < 100) return problem("This paid plan is not enabled.", 409);
  const keyId = publicRazorpayKeyId();
  if (!keyId) return problem("Razorpay public key ID is not configured.", 503);

  const { data: reservationData, error: reservationError } = await admin.rpc(
    "reserve_developer_recurring_checkout",
    { p_user_id: user.id, p_plan_slug: slug },
  );
  if (reservationError) {
    console.error("[billing] checkout reservation failed", reservationError.code || "unknown");
    return problem("Billing is temporarily unavailable. Please retry.", 503);
  }
  const reservation = (Array.isArray(reservationData) ? reservationData[0] : reservationData) as Reservation | null;
  if (!reservation?.result) return problem("Could not reserve checkout. Refresh billing and retry.", 503);

  switch (reservation.result) {
    case "invalid_request":
      return problem("Invalid checkout request.", 400);
    case "plan_unavailable":
      return problem("This paid plan is not enabled.", 409);
    case "legacy_order_pending":
      if (!reservation.pending_order_id) return problem("An older checkout is pending. Refresh billing or contact support.");
      if (reservation.pending_plan_slug !== slug) return problem("Another plan's one-time checkout is pending. Complete that checkout first.");
      if (!keyId) return problem("Razorpay public key ID is not configured.", 503);
      return resumeOneTimeOrder({ userId: user.id, slug, name: plan.name, price: plan.price_paise, orderId: reservation.pending_order_id, email: user.email || "", keyId });
    case "another_checkout_pending":
      return problem("A different subscription checkout is pending. Resume or cancel that checkout first.");
    case "checkout_initializing":
      return problem("Checkout is already being prepared. Retry in a few seconds.");
    case "already_subscribed":
      return NextResponse.json({ mode: "already_active", plan: reservation.current_plan_slug, currentPeriodEnd: reservation.current_period_end });
    case "cancellation_scheduled":
      return problem("Your current subscription is scheduled to cancel at the end of its billing period. You can subscribe again after it ends.");
    case "plan_change_pending":
      return NextResponse.json({ mode: "plan_change_pending", plan: reservation.pending_plan_slug, currentPeriodEnd: reservation.current_period_end });
    case "another_plan_change_pending":
      return problem("A different plan change is already scheduled. Wait for it to take effect before requesting another change.");
    case "subscription_needs_attention":
      return problem("Your existing recurring subscription needs attention. Resolve its payment status or cancel it in Razorpay before changing plans.");
    case "resume_subscription": {
      if (!reservation.pending_subscription_id) return problem("The pending subscription is missing. Contact support.", 503);
      const existing = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(reservation.pending_subscription_id));
      if (!existing.ok) return problem(existing.error, existing.status);
      if (existing.data.notes?.user_id !== user.id || existing.data.notes?.billing_scope !== "user") {
        return problem("Pending subscription metadata did not match this account.", 409);
      }
      if (["active", "cancelled", "completed", "expired"].includes(existing.data.status)) {
        return problem("Razorpay has already moved this subscription to " + existing.data.status + ". Refresh billing while its webhook is processed.");
      }
      if (!keyId) return problem("Razorpay public key ID is not configured.", 503);
      return NextResponse.json({
        mode: "subscription", keyId, subscriptionId: existing.data.id,
        name: "Eidren Developer Platform", description: plan.name + " monthly subscription",
        prefill: { email: user.email || "" },
        startsAt: existing.data.start_at ? new Date(existing.data.start_at * 1000).toISOString() : null,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    case "change_plan": {
      const configured = await validateRecurringPlan(slug, plan.price_paise, plan.name);
      if (!configured.ok) return problem(configured.error, configured.status);
      if (!reservation.current_subscription_id) return problem("The current subscription could not be identified.", 503);
      const current = await razorpayApi<RazorpaySubscription>("/subscriptions/" + encodeURIComponent(reservation.current_subscription_id));
      if (!current.ok) return problem(current.error, current.status);
      if (current.data.notes?.user_id !== user.id || current.data.notes?.billing_scope !== "user") return problem("The current subscription does not match this account.", 409);
      if (current.data.status !== "active") return problem("The current Razorpay subscription is not active. Refresh billing and retry.");

      const now = new Date().toISOString();
      const { data: reservedChange, error: reserveError } = await admin.from("developer_subscriptions")
        .update({ pending_plan_slug: slug, pending_started_at: now, updated_at: now })
        .eq("user_id", user.id).eq("razorpay_subscription_id", current.data.id)
        .eq("status", "active").eq("cancel_at_cycle_end", false).is("pending_plan_slug", null)
        .select("user_id").maybeSingle();
      if (reserveError || !reservedChange) return problem("A billing change is already pending. Refresh billing and retry.");
      const remainingCount = Math.max(1, Number(current.data.remaining_count ?? ((current.data.total_count || 1200) - (current.data.paid_count || 0))));
      const changed = await razorpayApi<RazorpaySubscription>(
        "/subscriptions/" + encodeURIComponent(current.data.id),
        { method: "PATCH", body: { plan_id: configured.planId, remaining_count: remainingCount, schedule_change_at: "cycle_end", customer_notify: true } },
      );
      if (!changed.ok) {
        // A timeout/5xx is ambiguous: Razorpay may have scheduled the change
        // even if our request never received the response. Keep the local
        // pending marker so the lifecycle webhook can reconcile the provider.
        if (changed.status < 500) {
          await admin.from("developer_subscriptions").update({ pending_plan_slug: null, pending_started_at: null, updated_at: new Date().toISOString() })
            .eq("user_id", user.id).eq("razorpay_subscription_id", current.data.id).eq("pending_plan_slug", slug);
        }
        return problem(changed.error, changed.status);
      }
      return NextResponse.json({ mode: "plan_change_scheduled", plan: slug, currentPeriodEnd: reservation.current_period_end }, { headers: { "Cache-Control": "no-store" } });
    }
    case "reserved":
      break;
    default:
      return problem("Billing state needs attention. Refresh billing or contact support.", 409);
  }

  const configured = await validateRecurringPlan(slug, plan.price_paise, plan.name);
  if (!configured.ok) {
    await releaseReservation(admin, user.id, slug);
    return problem(configured.error, configured.status);
  }

  const currentPeriodEnd = reservation.current_period_end ? Date.parse(reservation.current_period_end) : 0;
  const startAt = reservation.current_status === "active" && Number.isFinite(currentPeriodEnd) && currentPeriodEnd > Date.now()
    ? Math.floor(currentPeriodEnd / 1000)
    : undefined;

  const created = await createRazorpaySubscription({ planId: configured.planId, userId: user.id, planSlug: slug, startAt });
  if (!created.ok) {
    // A 5xx/timeout can happen after Razorpay created the subscription but
    // before the response reached us. Keep the reservation cooling down so a
    // retry cannot create a second chargeable subscription.
    if (created.status < 500) {
      await releaseReservation(admin, user.id, slug);
    }
    return problem(created.error, created.status);
  }
  if (!created.data.id || created.data.plan_id !== configured.planId) {
    if (created.data.id) await razorpayApi("/subscriptions/" + encodeURIComponent(created.data.id) + "/cancel", { method: "POST", body: { cancel_at_cycle_end: false } });
    await releaseReservation(admin, user.id, slug);
    return problem("Razorpay returned an invalid subscription response.", 502);
  }

  const { data: saved, error: saveError } = await admin.from("developer_subscriptions").update({
    pending_razorpay_subscription_id: created.data.id,
    updated_at: new Date().toISOString(),
  }).eq("user_id", user.id).eq("pending_plan_slug", slug)
    .is("pending_razorpay_subscription_id", null).is("pending_order_id", null)
    .select("user_id").maybeSingle();

  if (saveError || !saved) {
    await razorpayApi("/subscriptions/" + encodeURIComponent(created.data.id) + "/cancel", { method: "POST", body: { cancel_at_cycle_end: false } });
    await releaseReservation(admin, user.id, slug);
    return problem("Checkout changed while the subscription was being created. Refresh billing and retry.", 409);
  }

  if (!keyId) return problem("Razorpay public key ID is not configured.", 503);
  return NextResponse.json({
    mode: "subscription", keyId, subscriptionId: created.data.id,
    name: "Eidren Developer Platform", description: plan.name + " recurring monthly subscription",
    prefill: { email: user.email || "" },
    startsAt: startAt ? new Date(startAt * 1000).toISOString() : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
