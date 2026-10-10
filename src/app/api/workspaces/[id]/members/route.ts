import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
async function membership(admin: ReturnType<typeof createAdminClient>, workspaceId: string, userId: string) {
  const { data: workspace } = await admin.from("developer_workspaces").select("id,owner_user_id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return { workspace: null, role: null as string | null };
  const { data: member } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  return { workspace, role: workspace.owner_user_id === userId ? "owner" : member?.role || null };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const access = await membership(admin, id, user.id);
  if (!access.role) return NextResponse.json({ error: "Workspace not found or access denied." }, { status: 404 });
  const { data: members } = await admin.from("developer_workspace_members").select("user_id,role,joined_at").eq("workspace_id", id).order("joined_at");
  const { data: invites } = await admin.from("developer_workspace_invites").select("id,email,role,expires_at,created_at").eq("workspace_id", id).is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });
  return NextResponse.json({ members: members || [], invites: invites || [], currentRole: access.role, ownerUserId: access.workspace?.owner_user_id, memberCount: (members || []).length }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role === "admin" ? "admin" : "member";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const admin = createAdminClient();
  const access = await membership(admin, id, user.id);
  if (!["owner", "admin"].includes(access.role || "")) return NextResponse.json({ error: "Only workspace owners and admins can invite members." }, { status: 403 });
  const { count } = await admin.from("developer_workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", id);
  if ((count || 0) >= 25) return NextResponse.json({ error: "A workspace can have up to 25 members." }, { status: 409 });
  const { data: existing } = await admin.from("developer_workspace_invites").select("id").eq("workspace_id", id).eq("email", email).is("accepted_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (existing) return NextResponse.json({ error: "There is already an active invitation for that email." }, { status: 409 });
  const token = randomBytes(32).toString("base64url");
  const { data: invite, error } = await admin.from("developer_workspace_invites").insert({ workspace_id: id, email, role, token_hash: createHash("sha256").update(token).digest("hex"), invited_by: user.id }).select("id,email,role,expires_at,created_at").single();
  if (error || !invite) return NextResponse.json({ error: "Could not create workspace invitation." }, { status: 500 });
  await writeAuditLog({ userId: user.id, workspaceId: id, action: "workspace.member.invited", resourceType: "workspace_invite", resourceId: invite.id, metadata: { email, role } });
  const origin = new URL(request.url).origin;
  return NextResponse.json({ invite, inviteUrl: origin + "/dashboard/workspaces/accept?token=" + encodeURIComponent(token) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const targetUserId = typeof body?.userId === "string" ? body.userId : "";
  if (!targetUserId) return NextResponse.json({ error: "Member user ID is required." }, { status: 400 });
  const admin = createAdminClient();
  const access = await membership(admin, id, user.id);
  if (!["owner", "admin"].includes(access.role || "")) return NextResponse.json({ error: "Only workspace owners and admins can remove members." }, { status: 403 });
  if (targetUserId === access.workspace?.owner_user_id) return NextResponse.json({ error: "The workspace owner cannot be removed." }, { status: 409 });
  const { error } = await admin.from("developer_workspace_members").delete().eq("workspace_id", id).eq("user_id", targetUserId);
  if (error) return NextResponse.json({ error: "Could not remove workspace member." }, { status: 500 });
  await writeAuditLog({ userId: user.id, workspaceId: id, action: "workspace.member.removed", resourceType: "workspace_member", resourceId: targetUserId });
  return NextResponse.json({ success: true });
}
