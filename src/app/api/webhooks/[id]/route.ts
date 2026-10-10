import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { writeAuditLog } from "@/lib/developer-events";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data, error } = await admin.from("developer_webhook_endpoints").delete().eq("id", id).eq("user_id", user.id).select("id,name").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not delete webhook endpoint." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  await writeAuditLog({ userId: user.id, action: "webhook.deleted", resourceType: "webhook_endpoint", resourceId: id, metadata: { name: data.name } });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("developer_webhook_endpoints").update({ enabled: body.enabled, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id).select("id,enabled").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update webhook endpoint." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  await writeAuditLog({ userId: user.id, action: body.enabled ? "webhook.enabled" : "webhook.disabled", resourceType: "webhook_endpoint", resourceId: id });
  return NextResponse.json({ endpoint: data });
}
