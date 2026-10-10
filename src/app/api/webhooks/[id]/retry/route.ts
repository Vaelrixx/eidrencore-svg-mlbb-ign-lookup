import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data: endpoint } = await admin.from("developer_webhook_endpoints").select("id,name,user_id,workspace_id").eq("id", id).maybeSingle();
  if (!endpoint) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  let allowed = endpoint.user_id === user.id && !endpoint.workspace_id;
  if (endpoint.workspace_id) {
    const { data: workspace } = await admin.from("developer_workspaces").select("owner_user_id").eq("id", endpoint.workspace_id).maybeSingle();
    if (workspace?.owner_user_id === user.id) allowed = true;
    else {
      const { data: member } = await admin.from("developer_workspace_members").select("role").eq("workspace_id", endpoint.workspace_id).eq("user_id", user.id).maybeSingle();
      allowed = ["owner", "admin"].includes(member?.role || "");
    }
  }
  if (!allowed) return NextResponse.json({ error: "You do not have permission to replay this endpoint." }, { status: 403 });
  const { data: failed, error: readError } = await admin.from("developer_webhook_outbox").select("id,replay_count").eq("endpoint_id", id).is("delivered_at", null).not("dead_lettered_at", "is", null).lt("replay_count", 100).limit(50);
  if (readError) return NextResponse.json({ error: "Could not load dead-lettered deliveries." }, { status: 500 });
  let requeued = 0;
  for (const job of failed || []) {
    const { data: updated, error } = await admin.from("developer_webhook_outbox").update({
      attempt: 0, replay_count: job.replay_count + 1, available_at: new Date().toISOString(), locked_at: null, lock_token: null,
      dead_lettered_at: null, last_error: null, response_status: null, response_ms: null,
    }).eq("id", job.id).eq("endpoint_id", id).is("delivered_at", null).not("dead_lettered_at", "is", null).select("id").maybeSingle();
    if (error) return NextResponse.json({ error: "Could not requeue dead-lettered deliveries." }, { status: 500 });
    if (updated) requeued++;
  }
  await writeAuditLog({ userId: user.id, workspaceId: endpoint.workspace_id, action: "webhook.deliveries.replayed", resourceType: "webhook_endpoint", resourceId: id, metadata: { count: requeued } });
  return NextResponse.json({ success: true, requeued });
}
