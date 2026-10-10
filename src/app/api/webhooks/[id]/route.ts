import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { writeAuditLog } from "@/lib/developer-events";

async function endpointAccess(admin: ReturnType<typeof createAdminClient>, endpointId: string, userId: string) {
  const { data: endpoint } = await admin.from("developer_webhook_endpoints").select("id,name,user_id,workspace_id").eq("id", endpointId).maybeSingle();
  if (!endpoint) return { endpoint: null, allowed: false };
  if (!endpoint.workspace_id) return { endpoint, allowed: endpoint.user_id === userId };
  const { data: workspace } = await admin.from("developer_workspaces").select("owner_user_id").eq("id", endpoint.workspace_id).maybeSingle();
  if (workspace?.owner_user_id === userId) return { endpoint, allowed: true };
  const { data: membership } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", endpoint.workspace_id).eq("user_id", userId).maybeSingle();
  return { endpoint, allowed: ["owner", "admin"].includes(membership?.role || "") };
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const access = await endpointAccess(admin, id, user.id);
  if (!access.endpoint) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "You do not have permission to manage this webhook endpoint." }, { status: 403 });
  const { data, error } = await admin.from("developer_webhook_endpoints").delete().eq("id", id).select("id,name,workspace_id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not delete webhook endpoint." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  await writeAuditLog({ userId: user.id, workspaceId: data.workspace_id, action: "webhook.deleted", resourceType: "webhook_endpoint", resourceId: id, metadata: { name: data.name } });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  const admin = createAdminClient();
  const access = await endpointAccess(admin, id, user.id);
  if (!access.endpoint) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "You do not have permission to manage this webhook endpoint." }, { status: 403 });
  const { data, error } = await admin.from("developer_webhook_endpoints").update({ enabled: body.enabled, updated_at: new Date().toISOString() }).eq("id", id).select("id,enabled,workspace_id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update webhook endpoint." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  await writeAuditLog({ userId: user.id, workspaceId: data.workspace_id, action: body.enabled ? "webhook.enabled" : "webhook.disabled", resourceType: "webhook_endpoint", resourceId: id });
  return NextResponse.json({ endpoint: data });
}
