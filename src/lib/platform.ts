import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";

export const PLAN_FALLBACKS = [
  { slug: "free", name: "Free", price_paise: 0, monthly_limit: 100, enabled: true, description: "Try the API with a small monthly allowance." },
  { slug: "pro", name: "Pro", price_paise: Number(process.env.RAZORPAY_PRO_PRICE_PAISE || 0), monthly_limit: Number(process.env.PLAN_PRO_MONTHLY_LIMIT || 10000), enabled: Number(process.env.RAZORPAY_PRO_PRICE_PAISE || 0) > 0, description: "For apps and bots with regular traffic." },
  { slug: "business", name: "Business", price_paise: Number(process.env.RAZORPAY_BUSINESS_PRICE_PAISE || 0), monthly_limit: Number(process.env.PLAN_BUSINESS_MONTHLY_LIMIT || 100000), enabled: Number(process.env.RAZORPAY_BUSINESS_PRICE_PAISE || 0) > 0, description: "Higher volume for production integrations." },
];

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}
export function newApiKey() {
  const secret = randomBytes(32).toString("base64url");
  return { value: `eid_${secret}`, prefix: `eid_${secret.slice(0, 8)}` };
}

export async function getUserFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    if (token.startsWith("eid_")) {
      const admin = createAdminClient();
      const { data: key, error } = await admin.from("api_keys")
        .select("id,user_id,workspace_id,plan_slug,revoked_at")
        .eq("key_hash", hashApiKey(token)).maybeSingle();
      if (error || !key || key.revoked_at) return { error: "Invalid or revoked API key.", status: 401 as const };
      const subscriptionResult = key.workspace_id
        ? await admin.from("developer_workspace_subscriptions").select("plan_slug,status,current_period_end").eq("workspace_id", key.workspace_id).maybeSingle()
        : await admin.from("developer_subscriptions").select("plan_slug,status,current_period_end").eq("user_id", key.user_id).maybeSingle();
      const subscription = subscriptionResult.data;
      const paidIsCurrent = subscription?.status === "active" && !!subscription.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
      const planSlug = paidIsCurrent ? subscription.plan_slug : "free";
      if (planSlug !== key.plan_slug) await admin.from("api_keys").update({ plan_slug: planSlug }).eq("id", key.id);
      const { data: plan } = await admin.from("developer_plans").select("monthly_limit").eq("slug", planSlug).maybeSingle();
      const fallback = PLAN_FALLBACKS.find((p) => p.slug === planSlug);
      const limit = Number(plan?.monthly_limit ?? fallback?.monthly_limit ?? 100);
      const { data: quota, error: quotaError } = key.workspace_id
        ? await admin.rpc("consume_workspace_api_quota", { p_workspace_id: key.workspace_id, p_key_id: key.id, p_monthly_limit: limit })
        : await admin.rpc("consume_developer_api_quota", { p_key_id: key.id, p_monthly_limit: limit });
      if (quotaError) return { error: "API quota service is temporarily unavailable.", status: 503 as const };
      const result = Array.isArray(quota) ? quota[0] : quota;
      if (!result?.allowed) return { error: "Monthly API key quota exceeded.", status: 429 as const, remaining: 0 };
      await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
      return { userId: key.user_id, keyId: key.id, remaining: result.remaining as number };
    }
  }
  return null;
}

export async function requireUser() {
  const supabase = await (await import("./supabase/server")).createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { user: null, supabase };
  return { user, supabase };
}
