import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, newApiKey, hashApiKey, PLAN_FALLBACKS } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("api_keys").select("id,name,key_prefix,plan_slug,created_at,last_used_at,revoked_at").eq("user_id", user.id).is("workspace_id", null).neq("key_prefix", "eid_playground").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load API keys." }, { status: 500 });
  return NextResponse.json({ keys: data || [] }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "Give this key a name." }, { status: 400 });
  const admin = createAdminClient();
  const { data: subscription } = await admin.from("developer_subscriptions").select("plan_slug,status,current_period_end").eq("user_id", user.id).maybeSingle();
  const paidIsCurrent = subscription?.status === "active" && !!subscription.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const planSlug = paidIsCurrent ? subscription.plan_slug : "free";
  const { data: plan } = await admin.from("developer_plans").select("monthly_limit").eq("slug", planSlug).maybeSingle();
  const { count } = await admin.from("api_keys").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("workspace_id", null).neq("key_prefix", "eid_playground").is("revoked_at", null);
  if ((count || 0) >= 10) return NextResponse.json({ error: "You can have up to 10 active API keys." }, { status: 409 });
  const generated = newApiKey();
  const { data, error } = await admin.from("api_keys").insert({ user_id: user.id, name, key_hash: hashApiKey(generated.value), key_prefix: generated.prefix, plan_slug: planSlug }).select("id,name,key_prefix,plan_slug,created_at").single();
  if (error || !data) return NextResponse.json({ error: "Could not create API key." }, { status: 500 });
  await writeAuditLog({ userId: user.id, action: "api.key.created", resourceType: "api_key", resourceId: data.id, metadata: { name, prefix: data.key_prefix, plan: data.plan_slug } });
  await emitDeveloperEvent({ userId: user.id, type: "api.key.created", data: { key_id: data.id, name: data.name, key_prefix: data.key_prefix, plan: data.plan_slug } });
  return NextResponse.json({ key: generated.value, record: data, monthlyLimit: Number(plan?.monthly_limit ?? PLAN_FALLBACKS[0].monthly_limit) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
