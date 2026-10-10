import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (token.length < 32 || token.length > 200) return NextResponse.json({ error: "Invitation token is invalid." }, { status: 400 });
  if (!user.email) return NextResponse.json({ error: "Your sign-in provider did not supply an email address." }, { status: 400 });
  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: invite } = await admin.from("developer_workspace_invites").select("id,workspace_id,email,role,expires_at,accepted_at").eq("token_hash", tokenHash).maybeSingle();
  if (!invite || invite.accepted_at || Date.parse(invite.expires_at) <= Date.now() || invite.email.toLowerCase() !== user.email.toLowerCase()) return NextResponse.json({ error: "Invitation is expired, already used, or addressed to another email." }, { status: 403 });
  const acceptedAt = new Date().toISOString();
  const { data: claimedInvite, error: claimError } = await admin.from("developer_workspace_invites").update({ accepted_at: acceptedAt }).eq("id", invite.id).is("accepted_at", null).gt("expires_at", acceptedAt).select("id").maybeSingle();
  if (claimError || !claimedInvite) return NextResponse.json({ error: "Invitation was already used or expired. Request a new invitation." }, { status: 409 });
  const { error: memberError } = await admin.from("developer_workspace_members").upsert({ workspace_id: invite.workspace_id, user_id: user.id, role: invite.role, joined_at: acceptedAt }, { onConflict: "workspace_id,user_id" });
  if (memberError) {
    await admin.from("developer_workspace_invites").update({ accepted_at: null }).eq("id", invite.id).eq("accepted_at", acceptedAt);
    return NextResponse.json({ error: "Could not join workspace." }, { status: 500 });
  }
  await writeAuditLog({ userId: user.id, workspaceId: invite.workspace_id, action: "workspace.invitation.accepted", resourceType: "workspace_invite", resourceId: invite.id });
  return NextResponse.json({ success: true, workspaceId: invite.workspace_id });
}
