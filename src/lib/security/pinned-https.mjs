import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isPublicWebhookAddress } from "./webhook-url.mjs";

export function createPinnedLookup(address, family = isIP(address)) {
  if (!address || (family !== 4 && family !== 6) || isIP(address) !== family || !isPublicWebhookAddress(address, family)) {
    throw new TypeError("A validated public IPv4 or IPv6 address is required.");
  }

  return (_hostname, options, callback) => {
    const record = { address, family };
    if (options && typeof options === "object" && options.all) callback(null, [record]);
    else callback(null, address, family);
  };
}

/**
 * POST JSON to a resolved webhook URL while pinning DNS to the validated IP.
 * The original URL hostname remains intact for TLS certificate/SNI and Host
 * validation; redirects are not followed because node:https does not follow.
 */
export function postHttpsJsonPinned(target, headers, body, timeoutMs = 5000, requestImpl = httpsRequest) {
  if (!target?.url || !target?.address) throw new TypeError("A resolved safe webhook target is required.");

  return new Promise((resolve, reject) => {
    let settled = false;
    const request = requestImpl(target.url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": String(Buffer.byteLength(body)),
      },
      lookup: createPinnedLookup(target.address, target.family),
      agent: false,
      timeout: timeoutMs,
    }, response => {
      const status = response.statusCode || 0;
      settled = true;
      response.on?.("error", () => undefined);
      response.destroy?.();
      resolve({ status, ok: status >= 200 && status < 300 });
    });

    request.on("error", error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.on("timeout", () => {
      const error = new Error("Webhook request timed out.");
      error.name = "TimeoutError";
      request.destroy(error);
    });
    request.end(body);
  });
}
