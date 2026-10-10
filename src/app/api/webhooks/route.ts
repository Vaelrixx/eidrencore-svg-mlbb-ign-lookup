import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { encryptWebhookSecret, isSafeWebhookUrl, writeAuditLog } from "@/lib/developer-events";

export const runtime = "nodejs";
const ALLOWED_EVENTS = ["api.key.created", "api.key.revoked", "billing.subscription.activated", "workspace.member.invited", "workspace.member.removed"];
export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("developer_webhook_endpoints").select("id,name,url,events,enabled,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load webhook endpoints." }, { status: 500 });
  const endpoints = data || [];
  const ids = endpoints.map(endpoint => endpoint.id);
  let deliveries: Array<Record<string, unknown>> = [];
  if (ids.length) {
    const result = await admin.from("developer_webhook_deliveries").select("id,endpoint_id,event_id,event_type,response_status,response_ms,attempt,delivered,error_code,created_at").in("endpoint_id", ids).order("created_at", { ascending: false }).limit(50);
    deliveries = (result.data || []) as Array<Record<string, unknown>>;
  }
  return NextResponse.json({ endpoints, deliveries, supportedEvents: ALLOWED_EVENTS }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!process.env.APP_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY.length < 32) return NextResponse.json({ error: "Webhook secret encryption is not configured. Set APP_ENCRYPTION_KEY in the server environment." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const events = Array.isArray(body?.events) ? [...new Set(body.events.filter((event: unknown): event is string => typeof event === "string" && ALLOWED_EVENTS.includes(event)))] : [];
  if (name.length < 2) return NextResponse.json({ error: "Webhook name must be at least 2 characters." }, { status: 400 });
  if (url.length > 2048 || !(await isSafeWebhookUrl(url))) return NextResponse.json({ error: "Webhook URL must be a public HTTPS URL. Local/private network targets are not allowed." }, { status: 400 });
  if (!events.length) return NextResponse.json({ error: "Select at least one supported event." }, { status: 400 });
  const admin = createAdminClient();
  const { count } = await admin.from("developer_webhook_endpoints").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count || 0) >= 10) return NextResponse.json({ error: "You can configure up to 10 webhook endpoints." }, { status: 409 });
  const secret = "whsec_" + randomBytes(32).toString("base64url");
  const { data, error } = await admin.from("developer_webhook_endpoints").insert({
    user_id: user.id, name, url, events, secret_hash: createHash("sha256").update(secret).digest("hex"),
    secret_ciphertext: encryptWebhookSecret(secret), enabled: true,
  }).select("id,name,url,events,enabled,created_at").single();
  if (error || !data) return NextResponse.json({ error: "Could not create webhook endpoint." }, { status: 500 });
  await writeAuditLog({ userId: user.id, action: "webhook.created", resourceType: "webhook_endpoint", resourceId: data.id, metadata: { name, events } });
  return NextResponse.json({ endpoint: data, secret }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
