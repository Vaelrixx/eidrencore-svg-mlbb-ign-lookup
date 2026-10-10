import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

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

function decryptWebhookSecret(value: string) {
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

function isSafeWebhookUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|fe80:)/i.test(host)) return false;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return true;
  } catch { return false; }
}

export async function emitDeveloperEvent(input: { userId: string; workspaceId?: string | null; type: string; data: Record<string, unknown> }) {
  const admin = createAdminClient();
  const { data: endpoints, error } = await admin.from("developer_webhook_endpoints")
    .select("id,url,secret_ciphertext,events")
    .eq("user_id", input.userId).eq("enabled", true);
  if (error || !endpoints?.length) return;
  const eventId = randomUUID();
  const payload = JSON.stringify({ id: eventId, type: input.type, created_at: new Date().toISOString(), data: input.data });
  await Promise.all(endpoints.filter(endpoint => Array.isArray(endpoint.events) && endpoint.events.includes(input.type)).map(async endpoint => {
    const started = Date.now();
    let responseStatus: number | null = null;
    let errorCode: string | null = null;
    let delivered = false;
    try {
      if (!isSafeWebhookUrl(endpoint.url)) throw new Error("unsafe_url");
      const secret = decryptWebhookSecret(endpoint.secret_ciphertext);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", secret).update(timestamp + "." + payload).digest("hex");
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Eidren-Webhooks/1.0", "Eidren-Event-Id": eventId, "Eidren-Event": input.type, "Eidren-Signature": "t=" + timestamp + ",v1=" + signature },
        body: payload,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(2500),
      });
      responseStatus = response.status;
      delivered = response.ok;
      if (!response.ok) errorCode = "http_" + response.status;
    } catch (error) {
      errorCode = error instanceof Error && error.name === "TimeoutError" ? "timeout" : error instanceof Error ? error.message.slice(0, 80) : "delivery_failed";
    }
    await admin.from("developer_webhook_deliveries").insert({
      endpoint_id: endpoint.id, event_id: eventId, event_type: input.type,
      response_status: responseStatus, response_ms: Date.now() - started,
      attempt: 1, delivered, error_code: errorCode,
    });
  }));
}

export async function recordDeveloperRequest(input: { userId: string; apiKeyId: string; requestId: string; status: number; responseMs: number }) {
  try {
    const admin = createAdminClient();
    await admin.from("developer_api_request_logs").insert({
      user_id: input.userId, api_key_id: input.apiKeyId, request_id: input.requestId,
      endpoint: "/api/lookup", http_status: input.status, response_ms: Math.max(0, input.responseMs),
    });
  } catch (error) {
    console.error("[developer-request-log] write failed", error instanceof Error ? error.message : "unknown");
  }
}
