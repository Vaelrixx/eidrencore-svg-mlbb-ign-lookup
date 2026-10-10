import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 38);

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("developer_workspaces").select("id,name,slug,owner_user_id,created_at,updated_at").eq("owner_user_id", user.id).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load workspaces." }, { status: 500 });
  const { data: memberships } = await admin.from("developer_workspace_members").select("workspace_id,role").eq("user_id", user.id);
  const memberIds = (memberships || []).map(item => item.workspace_id).filter(id => !(data || []).some(workspace => workspace.id === id));
  let joined: Array<Record<string, unknown>> = [];
  if (memberIds.length) {
    const result = await admin.from("developer_workspaces").select("id,name,slug,owner_user_id,created_at,updated_at").in("id", memberIds);
    joined = (result.data || []) as Array<Record<string, unknown>>;
  }
  const roles = new Map((memberships || []).map(item => [item.workspace_id, item.role]));
  const workspaces = [...(data || []), ...joined].map(workspace => ({ ...workspace, role: workspace.owner_user_id === user.id ? "owner" : roles.get(workspace.id) || "member" }));
  return NextResponse.json({ workspaces }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (name.length < 2) return NextResponse.json({ error: "Workspace name must be at least 2 characters." }, { status: 400 });
  const admin = createAdminClient();
  const { count } = await admin.from("developer_workspace_members").select("workspace_id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count || 0) >= 10) return NextResponse.json({ error: "You can join or own up to 10 workspaces." }, { status: 409 });
  const slug = slugify(name) + "-" + randomBytes(3).toString("hex");
  const { data: workspace, error } = await admin.from("developer_workspaces").insert({ name, slug, owner_user_id: user.id }).select("id,name,slug,owner_user_id,created_at,updated_at").single();
  if (error || !workspace) return NextResponse.json({ error: "Could not create workspace." }, { status: 500 });
  const { error: memberError } = await admin.from("developer_workspace_members").insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  if (memberError) {
    await admin.from("developer_workspaces").delete().eq("id", workspace.id).eq("owner_user_id", user.id);
    return NextResponse.json({ error: "Could not initialize workspace membership." }, { status: 500 });
  }
  await writeAuditLog({ userId: user.id, workspaceId: workspace.id, action: "workspace.created", resourceType: "workspace", resourceId: workspace.id, metadata: { name } });
  return NextResponse.json({ workspace: { ...workspace, role: "owner" } }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
