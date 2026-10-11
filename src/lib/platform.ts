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

type QuotaKey = { id: string; user_id: string; workspace_id: string | null; plan_slug: string };

/** Resolve the key's current plan, atomically consume one request of its monthly quota and stamp last_used_at. */
async function consumeKeyQuota(admin: ReturnType<typeof createAdminClient>, key: QuotaKey) {
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
  return { userId: key.user_id, keyId: key.id, workspaceId: key.workspace_id as string | null, remaining: result.remaining as number };
}

const PLAYGROUND_KEY_PREFIX = "eid_playground";

/**
 * Signed-in playground lookups are metered like API calls so the dashboard,
 * usage charts and logs reflect them. They are attributed to one internal,
 * per-user "Playground" key whose secret is never issued, so it can never
 * authenticate a request. It is hidden from the API key list.
 */
export async function getUserFromSession(userId: string) {
  const admin = createAdminClient();
  const select = () => admin.from("api_keys").select("id,user_id,workspace_id,plan_slug,revoked_at")
    .eq("user_id", userId).is("workspace_id", null).eq("key_prefix", PLAYGROUND_KEY_PREFIX).order("created_at", { ascending: true }).limit(1).maybeSingle();
  let { data: key } = await select();
  if (!key) {
    await admin.from("api_keys").insert({ user_id: userId, name: "Playground", key_hash: hashApiKey(newApiKey().value), key_prefix: PLAYGROUND_KEY_PREFIX, plan_slug: "free" });
    ({ data: key } = await select());
  }
  if (!key) return { error: "Could not prepare your playground access.", status: 503 as const };
  return consumeKeyQuota(admin, key);
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
      return consumeKeyQuota(admin, key);
    }
  }
  return null;
}

/**
 * Idempotently provision the rows every signed-up developer needs. The
 * database trigger in 20261011160000_signup_provisioning.sql does this at
 * signup; this is the application-level safety net for users created before
 * the trigger existed or while it was unavailable. Never throws.
 */
export async function ensureDeveloperAccount(userId: string) {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("developer_subscriptions")
      .upsert({ user_id: userId, plan_slug: "free", status: "free" }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) console.error("[developer-account] provisioning failed", error.code || "unknown");
    return !error;
  } catch (error) {
    console.error("[developer-account] provisioning failed", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

/** Accept only same-site relative paths for post-login redirects. */
export function safeNextPath(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 200) return fallback;
  return value;
}

export async function requireUser() {
  const supabase = await (await import("./supabase/server")).createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { user: null, supabase };
  return { user, supabase };
}
