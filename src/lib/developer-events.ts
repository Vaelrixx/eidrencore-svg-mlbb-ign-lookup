import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
export { isSafeWebhookUrl } from "./security/webhook-url.mjs";

function encryptionKey() {
  const configured = process.env.APP_ENCRYPTION_KEY;
  if (!configured || configured.length < 32) throw new Error("APP_ENCRYPTION_KEY must be configured with at least 32 characters.");
  return createHash("sha256").update(configured).digest();
}

export function encryptWebhookSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptWebhookSecret(value: string) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) throw new Error("Invalid encrypted webhook secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export async function writeAuditLog(input: { userId: string; action: string; resourceType: string; resourceId?: string | null; workspaceId?: string | null; metadata?: Record<string, unknown> }) {
  try {
    const admin = createAdminClient();
    await admin.from("developer_audit_logs").insert({
      user_id: input.userId,
      workspace_id: input.workspaceId || null,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId || null,
      metadata: input.metadata || {},
    });
  } catch (error) {
    console.error("[developer-audit] write failed", error instanceof Error ? error.message : "unknown");
  }
}

export async function emitDeveloperEvent(input: { userId: string; workspaceId?: string | null; type: string; data: Record<string, unknown> }) {
  try {
    const admin = createAdminClient();
    let query = admin.from("developer_webhook_endpoints")
      .select("id,user_id,workspace_id,events")
      .eq("enabled", true);
    if (input.workspaceId) query = query.or("user_id.eq." + input.userId + ",workspace_id.eq." + input.workspaceId);
    else query = query.eq("user_id", input.userId).is("workspace_id", null);
    const { data: endpoints, error } = await query;
    if (error || !endpoints?.length) {
      if (error) console.error("[developer-webhook-outbox] endpoint lookup failed", error.message);
      return;
    }
    const matching = endpoints.filter(endpoint =>
      Array.isArray(endpoint.events) &&
      endpoint.events.includes(input.type) &&
      (input.workspaceId
        ? endpoint.workspace_id === input.workspaceId || (!endpoint.workspace_id && endpoint.user_id === input.userId)
        : !endpoint.workspace_id && endpoint.user_id === input.userId)
    );
    if (!matching.length) return;
    const eventId = randomUUID();
    const payload = { id: eventId, type: input.type, created_at: new Date().toISOString(), data: input.data };
    const { error: insertError } = await admin.from("developer_webhook_outbox").insert(
      matching.map(endpoint => ({
        endpoint_id: endpoint.id,
        event_id: eventId,
        event_type: input.type,
        payload,
        max_attempts: 8,
        available_at: new Date().toISOString(),
      }))
    );
    if (insertError) console.error("[developer-webhook-outbox] enqueue failed", insertError.message);
  } catch (error) {
    console.error("[developer-webhook-outbox] enqueue failed", error instanceof Error ? error.message : "unknown");
  }
}

export async function recordDeveloperRequest(input: { userId: string; apiKeyId: string; workspaceId?: string | null; requestId: string; status: number; responseMs: number; endpoint?: string }) {
  try {
    const admin = createAdminClient();
    await admin.from("developer_api_request_logs").insert({
      user_id: input.userId, api_key_id: input.apiKeyId, workspace_id: input.workspaceId || null, request_id: input.requestId,
      endpoint: input.endpoint || "/api/lookup", http_status: input.status, response_ms: Math.max(0, input.responseMs),
    });
  } catch (error) {
    console.error("[developer-request-log] write failed", error instanceof Error ? error.message : "unknown");
  }
}
