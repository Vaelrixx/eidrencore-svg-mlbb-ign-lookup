import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; keyId: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id, keyId } = await context.params;
  const admin = createAdminClient();
  const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id").eq("id", id).maybeSingle();
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  let role = workspace.owner_user_id === user.id ? "owner" : null;
  if (!role) {
    const { data: membership } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", id).eq("user_id", user.id).maybeSingle();
    role = membership?.role || null;
  }
  if (!role) return NextResponse.json({ error: "Workspace not found or access denied." }, { status: 404 });
  if (!["owner", "admin"].includes(role)) return NextResponse.json({ error: "Only workspace owners and admins can revoke keys." }, { status: 403 });
  const { data, error } = await admin.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId).eq("workspace_id", id).is("revoked_at", null).select("id,name,key_prefix").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not revoke workspace API key." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Workspace API key not found or already revoked." }, { status: 404 });
  await writeAuditLog({ userId: user.id, workspaceId: id, action: "api.key.revoked", resourceType: "api_key", resourceId: keyId, metadata: { name: data.name, prefix: data.key_prefix } });
  await emitDeveloperEvent({ userId: user.id, workspaceId: id, type: "api.key.revoked", data: { key_id: keyId, workspace_id: id } });
  return NextResponse.json({ success: true });
}
