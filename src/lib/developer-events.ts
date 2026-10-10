import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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

function isPublicIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export async function isSafeWebhookUrl(raw: string): Promise<boolean> {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") return false;
    const kind = isIP(host);
    if (kind === 6) return false; // Reject IPv6 literals to avoid ambiguous mapped/private address forms.
    if (kind === 4) return isPublicIpv4(host);
    const records = await lookup(host, { all: true, verbatim: true });
    return records.length > 0 && records.every(record => isIP(record.address) === 4 && isPublicIpv4(record.address));
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
      if (!(await isSafeWebhookUrl(endpoint.url))) throw new Error("unsafe_url");
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
