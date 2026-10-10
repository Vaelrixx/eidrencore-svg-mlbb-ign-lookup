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
  const { data: endpoint } = await admin.from("developer_webhook_endpoints").select("id,name").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!endpoint) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  const { data: failed, error: readError } = await admin.from("developer_webhook_outbox").select("id").eq("endpoint_id", id).is("delivered_at", null).not("dead_lettered_at", "is", null).limit(50);
  if (readError) return NextResponse.json({ error: "Could not load dead-lettered deliveries." }, { status: 500 });
  const ids = (failed || []).map(job => job.id);
  if (!ids.length) return NextResponse.json({ success: true, requeued: 0 });
  const { data, error } = await admin.from("developer_webhook_outbox").update({
    attempt: 0, available_at: new Date().toISOString(), locked_at: null, lock_token: null,
    dead_lettered_at: null, last_error: null, response_status: null, response_ms: null,
  }).in("id", ids).eq("endpoint_id", id).is("delivered_at", null).not("dead_lettered_at", "is", null).select("id");
  if (error) return NextResponse.json({ error: "Could not requeue dead-lettered deliveries." }, { status: 500 });
  await writeAuditLog({ userId: user.id, action: "webhook.deliveries.replayed", resourceType: "webhook_endpoint", resourceId: id, metadata: { count: data?.length || 0 } });
  return NextResponse.json({ success: true, requeued: data?.length || 0 });
}
