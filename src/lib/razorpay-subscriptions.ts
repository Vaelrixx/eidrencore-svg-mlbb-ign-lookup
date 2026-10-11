import "server-only";

import {
  razorpayEpochToIso,
  razorpaySubscriptionStartIsFuture,
  razorpayUserStatus,
  razorpayWorkspaceStatus,
  verifySubscriptionPaymentSignature,
  verifyRazorpayWebhookSignature,
  razorpayPlanMatchesCatalog,
} from "./razorpay-subscription-utils.mjs";

export { razorpayEpochToIso, razorpaySubscriptionStartIsFuture, razorpayUserStatus, razorpayWorkspaceStatus, verifySubscriptionPaymentSignature, verifyRazorpayWebhookSignature, razorpayPlanMatchesCatalog };

export type PaidPlanSlug = "pro" | "business";
export type RazorpayApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: null; error: string };

export type RazorpayPlan = {
  id: string;
  period: string;
  interval: number;
  item?: { active?: boolean; amount?: number; currency?: string; name?: string };
};

export type RazorpaySubscription = {
  id: string;
  status: string;
  plan_id: string;
  short_url?: string | null;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  end_at?: number | null;
  paid_count?: number;
  total_count?: number;
  remaining_count?: number;
  has_scheduled_changes?: boolean;
  change_scheduled_at?: string | null;
  notes?: Record<string, string>;
};

export type RazorpayPayment = {
  id: string;
  status?: string;
  subscription_id?: string | null;
};

function credentials() {
  return {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
  };
}

export function recurringPlanId(slug: string) {
  if (slug === "pro") return process.env.RAZORPAY_PRO_PLAN_ID?.trim() || "";
  if (slug === "business") return process.env.RAZORPAY_BUSINESS_PLAN_ID?.trim() || "";
  return "";
}

export function publicRazorpayKeyId() {
  return credentials().keyId;
}

/** A small typed REST client; never logs or returns credentials. */
export async function razorpayApi<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: Record<string, unknown> } = {},
): Promise<RazorpayApiResult<T>> {
  const { keyId, keySecret } = credentials();
  if (!keyId || !keySecret) {
    return { ok: false, status: 503, data: null, error: "Razorpay server credentials are not configured." };
  }

  try {
    const response = await fetch("https://api.razorpay.com/v1" + path, {
      method: options.method || "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64"),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== "object") {
      const error = response.status === 401
        ? "Razorpay rejected the configured API credentials."
        : response.status === 403
          ? "Razorpay rejected this subscription operation. Check that Subscriptions is enabled for these credentials."
          : "Razorpay could not complete the request (HTTP " + response.status + ").";
      return { ok: false, status: response.status || 502, data: null, error };
    }
    return { ok: true, status: response.status, data: data as T };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      data: null,
      error: isTimeout ? "Razorpay did not respond in time. Please retry." : "Razorpay is temporarily unreachable. Please retry.",
    };
  }
}

/** Fails closed unless the merchant plan matches the in-app price and monthly cadence. */
export async function validateRecurringPlan(slug: PaidPlanSlug, expectedPricePaise: number, displayName: string) {
  const planId = recurringPlanId(slug);
  const envName = slug === "pro" ? "RAZORPAY_PRO_PLAN_ID" : "RAZORPAY_BUSINESS_PLAN_ID";
  if (!planId) {
    return {
      ok: false as const,
      status: 503,
      error: "Recurring billing for " + displayName + " is not configured. Set " + envName + " to the matching monthly Razorpay plan ID.",
    };
  }

  const result = await razorpayApi<RazorpayPlan>("/plans/" + encodeURIComponent(planId));
  if (!result.ok) return { ok: false as const, status: result.status, error: result.error };

  const plan = result.data;
  if (!razorpayPlanMatchesCatalog(plan, { id: planId, pricePaise: expectedPricePaise })) {
    return {
      ok: false as const,
      status: 409,
      error: "The configured Razorpay plan for " + displayName + " does not match the enabled INR monthly price. Check the plan ID, amount, currency and billing interval before accepting payments.",
    };
  }

  return { ok: true as const, planId, plan };
}

/** Create a subscription bounded to Razorpay's documented 100-year maximum duration. */
export async function createRazorpaySubscription(input: {
  planId: string;
  userId: string;
  planSlug: PaidPlanSlug;
  workspaceId?: string;
  startAt?: number;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expireBy = input.startAt && input.startAt > nowSeconds + 120
    ? Math.min(nowSeconds + 24 * 60 * 60, input.startAt - 60)
    : nowSeconds + 24 * 60 * 60;

  return razorpayApi<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: {
      plan_id: input.planId,
      total_count: 1200,
      quantity: 1,
      customer_notify: true,
      expire_by: Math.max(nowSeconds + 60, expireBy),
      ...(input.startAt && input.startAt > nowSeconds + 60 ? { start_at: input.startAt } : {}),
      notes: {
        provider: "eidren",
        billing_scope: input.workspaceId ? "workspace" : "user",
        user_id: input.userId,
        plan_slug: input.planSlug,
        ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
      },
    },
  });
}
