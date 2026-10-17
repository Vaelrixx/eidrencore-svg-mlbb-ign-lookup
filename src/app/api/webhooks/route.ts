import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { encryptWebhookSecret, isSafeWebhookUrl, writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
const ALLOWED_EVENTS = ["api.key.created", "api.key.revoked", "billing.subscription.activated", "workspace.member.invited", "workspace.member.removed", "lookup.bulk.completed"];
export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const admin = createAdminClient();
  const [{ data: personal, error }, { data: memberships }] = await Promise.all([
    admin.from("developer_webhook_endpoints").select("id,name,url,events,enabled,created_at,updated_at,workspace_id").eq("user_id", user.id).is("workspace_id", null).order("created_at", { ascending: false }),
    admin.from("developer_workspace_members").select("workspace_id,role").eq("user_id", user.id),
  ]);
  if (error) return NextResponse.json({ error: "Could not load webhook endpoints." }, { status: 500 });
  const workspaceIds = (memberships || []).filter(item => ["owner", "admin"].includes(item.role)).map(item => item.workspace_id);
  let shared: Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; created_at: string; updated_at: string; workspace_id: string | null }> = [];
  if (workspaceIds.length) {
    const result = await admin.from("developer_webhook_endpoints").select("id,name,url,events,enabled,created_at,updated_at,workspace_id").in("workspace_id", workspaceIds).order("created_at", { ascending: false });
    if (result.error) return NextResponse.json({ error: "Could not load workspace webhook endpoints." }, { status: 500 });
    shared = (result.data || []) as Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; created_at: string; updated_at: string; workspace_id: string | null }>;
  }
  const endpoints = [...(personal || []), ...shared].sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)));
  const ids = endpoints.map(endpoint => endpoint.id);
  let deliveries: Array<Record<string, unknown>> = [];
  if (ids.length) {
    const result = await admin.from("developer_webhook_deliveries").select("id,endpoint_id,event_id,event_type,response_status,response_ms,attempt,delivered,error_code,created_at").in("endpoint_id", ids).order("created_at", { ascending: false }).limit(50);
    deliveries = (result.data || []) as Array<Record<string, unknown>>;
  }
  let queue: Array<Record<string, unknown>> = [];
  if (ids.length) {
    const result = await admin.from("developer_webhook_outbox").select("id,endpoint_id,event_id,event_type,attempt,max_attempts,available_at,delivered_at,dead_lettered_at,last_error,created_at").in("endpoint_id", ids).order("created_at", { ascending: false }).limit(100);
    queue = (result.data || []) as Array<Record<string, unknown>>;
  }
  return NextResponse.json({ endpoints, deliveries, queue, supportedEvents: ALLOWED_EVENTS }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!process.env.APP_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY.length < 32) return NextResponse.json({ error: "Webhook secret encryption is not configured. Set APP_ENCRYPTION_KEY in the server environment." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const events = Array.isArray(body?.events) ? [...new Set(body.events.filter((event: unknown): event is string => typeof event === "string" && ALLOWED_EVENTS.includes(event)))] : [];
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (name.length < 2) return NextResponse.json({ error: "Webhook name must be at least 2 characters." }, { status: 400 });
  if (url.length > 2048 || !(await isSafeWebhookUrl(url))) return NextResponse.json({ error: "Webhook URL must be a public HTTPS URL. Local/private network targets are not allowed." }, { status: 400 });
  if (!events.length) return NextResponse.json({ error: "Select at least one supported event." }, { status: 400 });
  const admin = createAdminClient();
  let workspaceOwnerId: string | null = null;
  if (workspaceId) {
    const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id").eq("id", workspaceId).maybeSingle();
    if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    workspaceOwnerId = workspace.owner_user_id;
    let role = workspace.owner_user_id === user.id ? "owner" : null;
    if (!role) {
      const { data: member } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
      role = member?.role || null;
    }
    if (!["owner", "admin"].includes(role || "")) return NextResponse.json({ error: "Only workspace owners and admins can create shared webhook endpoints." }, { status: 403 });
  }
  let countQuery = admin.from("developer_webhook_endpoints").select("id", { count: "exact", head: true });
  countQuery = workspaceId ? countQuery.eq("workspace_id", workspaceId) : countQuery.eq("user_id", user.id).is("workspace_id", null);
  const { count } = await countQuery;
  if ((count || 0) >= 10) return NextResponse.json({ error: "You can configure up to 10 webhook endpoints in this scope." }, { status: 409 });
  const secret = "whsec_" + randomBytes(32).toString("base64url");
  const { data, error } = await admin.from("developer_webhook_endpoints").insert({
    user_id: workspaceOwnerId || user.id, workspace_id: workspaceId || null, name, url, events, secret_hash: createHash("sha256").update(secret).digest("hex"),
    secret_ciphertext: encryptWebhookSecret(secret), enabled: true,
  }).select("id,name,url,events,enabled,created_at,workspace_id").single();
  if (error || !data) return NextResponse.json({ error: "Could not create webhook endpoint." }, { status: 500 });
  await writeAuditLog({ userId: user.id, workspaceId: workspaceId || null, action: "webhook.created", resourceType: "webhook_endpoint", resourceId: data.id, metadata: { name, events } });
  return NextResponse.json({ endpoint: data, secret }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
