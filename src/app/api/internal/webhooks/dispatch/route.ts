import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret, isSafeWebhookUrl } from "@/lib/developer-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ATTEMPTS = 8;

type Job = {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
};

function authorized(request: Request) {
  const secret = process.env.WEBHOOK_WORKER_SECRET;
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secret || !supplied) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function retryDelaySeconds(attempt: number) {
  return Math.min(15 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60);
}

export async function POST(request: Request) {
  if (!process.env.WEBHOOK_WORKER_SECRET) return NextResponse.json({ error: "Worker secret is not configured." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const batchSize = Math.min(25, Math.max(1, Number.isInteger(body?.batchSize) ? body.batchSize : 10));
  const admin = createAdminClient();
  const lockToken = randomUUID();
  const { data, error } = await admin.rpc("claim_developer_webhook_jobs", { p_batch_size: batchSize, p_lock_token: lockToken });
  if (error) {
    console.error("[webhook-worker] claim failed", error.message);
    return NextResponse.json({ error: "Could not claim webhook jobs." }, { status: 500 });
  }
  const jobs = (data || []) as Job[];
  let delivered = 0;
  let retried = 0;
  let deadLettered = 0;
  let skipped = 0;

  for (const job of jobs) {
    const started = Date.now();
    const attemptNumber = job.attempt + 1;
    let responseStatus: number | null = null;
    let errorCode: string | null = null;
    let success = false;
    let retryable = true;

    const { data: endpoint, error: endpointError } = await admin.from("developer_webhook_endpoints")
      .select("id,url,secret_ciphertext,enabled")
      .eq("id", job.endpoint_id)
      .maybeSingle();

    if (endpointError || !endpoint || !endpoint.enabled) {
      errorCode = !endpoint ? "endpoint_missing" : endpointError ? "endpoint_lookup_failed" : "endpoint_disabled";
      retryable = !!endpointError;
    } else {
      try {
        if (!(await isSafeWebhookUrl(endpoint.url))) {
          errorCode = "unsafe_url";
          retryable = false;
        } else {
          const secret = decryptWebhookSecret(endpoint.secret_ciphertext);
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const rawBody = JSON.stringify(job.payload);
          const signature = createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
          const response = await fetch(endpoint.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Eidren-Webhooks/1.0",
              "Eidren-Event-Id": job.event_id,
              "Eidren-Event": job.event_type,
              "Eidren-Signature": "t=" + timestamp + ",v1=" + signature,
            },
            body: rawBody,
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
          });
          responseStatus = response.status;
          success = response.ok;
          retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (!success) errorCode = "http_" + response.status;
          if (response.body) await response.body.cancel().catch(() => undefined);
        }
      } catch (error) {
        errorCode = error instanceof Error && error.name === "TimeoutError" ? "timeout" : error instanceof Error && error.message === "Invalid encrypted webhook secret." ? "secret_decryption_failed" : "delivery_network_error";
        retryable = errorCode === "timeout" || errorCode === "delivery_network_error";
      }
    }

    const now = new Date().toISOString();
    const { error: deliveryError } = await admin.from("developer_webhook_deliveries").upsert({
      endpoint_id: job.endpoint_id,
      event_id: job.event_id,
      event_type: job.event_type,
      response_status: responseStatus,
      response_ms: Date.now() - started,
      attempt: attemptNumber,
      delivered: success,
      error_code: errorCode,
    }, { onConflict: "endpoint_id,event_id,attempt", ignoreDuplicates: true });
    if (deliveryError) {
      console.error("[webhook-worker] delivery log failed", deliveryError.message);
      // Keep the lease so the row can be reclaimed after timeout rather than losing delivery history.
      skipped++;
      continue;
    }

    if (success) {
      const { error: updateError } = await admin.from("developer_webhook_outbox").update({
        delivered_at: now, response_status: responseStatus, response_ms: Date.now() - started,
        attempt: attemptNumber, locked_at: null, lock_token: null, last_error: null,
      }).eq("id", job.id).eq("lock_token", lockToken).is("delivered_at", null);
      if (updateError) skipped++; else delivered++;
      continue;
    }

    const shouldRetry = retryable && attemptNumber < Math.min(job.max_attempts || MAX_ATTEMPTS, MAX_ATTEMPTS);
    const delaySeconds = retryDelaySeconds(attemptNumber);
    const { error: updateError } = await admin.from("developer_webhook_outbox").update({
      attempt: attemptNumber,
      available_at: shouldRetry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : now,
      locked_at: null,
      lock_token: null,
      last_error: (errorCode || "delivery_failed").slice(0, 120),
      response_status: responseStatus,
      response_ms: Date.now() - started,
      ...(shouldRetry ? {} : { dead_lettered_at: now }),
    }).eq("id", job.id).eq("lock_token", lockToken).is("delivered_at", null);
    if (updateError) skipped++;
    else if (shouldRetry) retried++;
    else deadLettered++;
  }

  return NextResponse.json({ claimed: jobs.length, delivered, retried, deadLettered, skipped, batchSize }, { headers: { "Cache-Control": "no-store" } });
}
