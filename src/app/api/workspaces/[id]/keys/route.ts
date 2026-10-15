import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, newApiKey, hashApiKey, PLAN_FALLBACKS } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";

async function workspaceAccess(workspaceId: string, userId: string) {
  const admin = createAdminClient();
  const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return { admin, role: null as string | null, ownerUserId: null as string | null };
  if (workspace.owner_user_id === userId) return { admin, role: "owner", ownerUserId: workspace.owner_user_id };
  const { data: membership } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  return { admin, role: membership?.role || null, ownerUserId: workspace.owner_user_id };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const { admin, role } = await workspaceAccess(id, user.id);
  if (!role) return NextResponse.json({ error: "Workspace not found or access denied." }, { status: 404 });
  const { data, error } = await admin.from("api_keys").select("id,name,key_prefix,plan_slug,created_at,last_used_at,revoked_at,user_id").eq("workspace_id", id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load workspace API keys." }, { status: 500 });
  return NextResponse.json({ keys: data || [], currentRole: role }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (name.length < 2) return NextResponse.json({ error: "API key name must be at least 2 characters." }, { status: 400 });
  const { admin, role, ownerUserId } = await workspaceAccess(id, user.id);
  if (!role) return NextResponse.json({ error: "Workspace not found or access denied." }, { status: 404 });
  if (!["owner", "admin"].includes(role)) return NextResponse.json({ error: "Only workspace owners and admins can create keys." }, { status: 403 });
  const { data: subscription } = await admin.from("developer_workspace_subscriptions").select("plan_slug,status,current_period_end").eq("workspace_id", id).maybeSingle();
  const paidIsCurrent = subscription?.status === "active" && !!subscription.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const planSlug = paidIsCurrent ? subscription.plan_slug : "free";
  const { data: plan } = await admin.from("developer_plans").select("monthly_limit").eq("slug", planSlug).maybeSingle();
  const generated = newApiKey();
  const { data: rows, error } = await admin.rpc("create_developer_api_key", {
    p_actor_user_id: user.id,
    p_user_id: ownerUserId || user.id,
    p_workspace_id: id,
    p_name: name,
    p_key_hash: hashApiKey(generated.value),
    p_key_prefix: generated.prefix,
    p_plan_slug: planSlug,
  });
  const data = Array.isArray(rows) ? rows[0] : rows;
  if (error?.message?.includes("active_api_key_limit_reached")) {
    return NextResponse.json({ error: "A workspace can have up to 10 active API keys." }, { status: 409 });
  }
  if (error || !data) return NextResponse.json({ error: "Could not create workspace API key." }, { status: 500 });
  await writeAuditLog({ userId: user.id, workspaceId: id, action: "api.key.created", resourceType: "api_key", resourceId: data.id, metadata: { name, prefix: data.key_prefix, plan: data.plan_slug } });
  await emitDeveloperEvent({ userId: user.id, workspaceId: id, type: "api.key.created", data: { key_id: data.id, name: data.name, key_prefix: data.key_prefix, plan: data.plan_slug, workspace_id: id } });
  return NextResponse.json({ key: generated.value, record: data, monthlyLimit: Number(plan?.monthly_limit ?? PLAN_FALLBACKS[0].monthly_limit) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
