import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { emitDeveloperEvent, writeAuditLog } from "@/lib/developer-events";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const admin = createAdminClient();
  const { data, error } = await admin.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id).is("revoked_at", null).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not revoke API key." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "API key not found or already revoked." }, { status: 404 });
  await writeAuditLog({ userId: user.id, action: "api.key.revoked", resourceType: "api_key", resourceId: id });
  await emitDeveloperEvent({ userId: user.id, type: "api.key.revoked", data: { key_id: id } });
  return NextResponse.json({ success: true });
}
