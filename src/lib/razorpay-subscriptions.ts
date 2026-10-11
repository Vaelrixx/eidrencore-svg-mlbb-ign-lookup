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
  item?: { active?: boolean; amount?: number; currency?: string; name?: string; description?: string };
  notes?: Record<string, string>;
};

type RazorpayPlanCollection = { items?: RazorpayPlan[]; count?: number };

const automaticPlanInFlight = new Map<string, Promise<string | null>>();
const automaticPlanCache = new Map<string, string>();

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

/**
 * Resolve a paid plan without requiring manually copied Plan IDs.
 * Existing configured IDs remain supported; otherwise we reuse an exact match
 * or create the canonical monthly INR Plan through Razorpay's server-side API.
 * The in-process lock prevents duplicate creation from concurrent requests on
 * the same instance. Plan IDs are never exposed outside the server.
 */
async function ensureRecurringPlanId(slug: PaidPlanSlug, expectedPricePaise: number): Promise<string | null> {
  const explicitId = recurringPlanId(slug);
  if (explicitId) return explicitId;

  const cacheKey = slug + ":" + expectedPricePaise;
  const cached = automaticPlanCache.get(cacheKey);
  if (cached) return cached;

  const existing = automaticPlanInFlight.get(cacheKey);
  if (existing) return existing;

  const work = (async (): Promise<string | null> => {
    const canonicalName = slug === "pro" ? "Eidren Pro Monthly" : "Eidren Business Monthly";
    const listed = await razorpayApi<RazorpayPlanCollection>("/plans?count=100");
    if (!listed.ok) return null;

    const match = (listed.data.items || []).find(plan =>
      plan.item?.name === canonicalName &&
      razorpayPlanMatchesCatalog(plan, { id: plan.id, pricePaise: expectedPricePaise })
    );
    if (match) {
      automaticPlanCache.set(cacheKey, match.id);
      return match.id;
    }

    const created = await razorpayApi<RazorpayPlan>("/plans", {
      method: "POST",
      body: {
        period: "monthly",
        interval: 1,
        item: {
          name: canonicalName,
          amount: expectedPricePaise,
          currency: "INR",
          description: canonicalName + " for EidrenCore",
        },
        notes: {
          provider: "eidren",
          plan_slug: slug,
          billing_scope: "platform",
        },
      },
    });
    if (!created.ok || !created.data.id) return null;
    if (!razorpayPlanMatchesCatalog(created.data, { id: created.data.id, pricePaise: expectedPricePaise })) return null;
    automaticPlanCache.set(cacheKey, created.data.id);
    return created.data.id;
  })();

  automaticPlanInFlight.set(cacheKey, work);
  try {
    return await work;
  } finally {
    automaticPlanInFlight.delete(cacheKey);
  }
}

/** Fails closed unless the merchant Plan matches the in-app price and monthly cadence. */
export async function validateRecurringPlan(slug: PaidPlanSlug, expectedPricePaise: number, displayName: string) {
  const planId = await ensureRecurringPlanId(slug, expectedPricePaise);
  if (!planId) {
    return {
      ok: false as const,
      status: 503,
      error: "Could not find or automatically create the monthly Razorpay Plan for " + displayName + ". Verify the existing Razorpay API credentials and that Subscriptions is enabled.",
    };
  }

  const result = await razorpayApi<RazorpayPlan>("/plans/" + encodeURIComponent(planId));
  if (!result.ok) return { ok: false as const, status: result.status, error: result.error };

  const plan = result.data;
  if (!razorpayPlanMatchesCatalog(plan, { id: planId, pricePaise: expectedPricePaise })) {
    return {
      ok: false as const,
      status: 409,
      error: "The configured Razorpay plan for " + displayName + " does not match the enabled INR monthly price. Check the plan ID, amount, currency and monthly interval before accepting payments.",
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
