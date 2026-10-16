const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SERVER_TO_SERVER_PATHS = new Set([
  "/api/billing/webhook",
  "/api/internal/webhooks/dispatch",
]);

export function requiresSameOriginProtection(method, pathname, authorization = "") {
  const verb = String(method || "").toUpperCase();
  const path = String(pathname || "").split("?", 1)[0];
  if (!UNSAFE_METHODS.has(verb) || !path.startsWith("/api/")) return false;
  if (SERVER_TO_SERVER_PATHS.has(path)) return false;

  // Bearer API keys are the documented cross-origin integration credential,
  // and are accepted only by lookup routes. Other cookie-backed mutations
  // must originate from the configured app origin.
  const isLookupPath = path === "/api/lookup" || path.startsWith("/api/lookup/");
  return !(isLookupPath && /^Bearer\s+eid_/i.test(String(authorization).trim()));
}

function canonicalOrigin(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().toLowerCase() === "null") return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(originHeader, refererHeader, expectedOrigin) {
  const expected = canonicalOrigin(expectedOrigin);
  if (!expected) return false;
  // An explicit Origin header takes precedence; never downgrade an invalid or
  // opaque Origin to a more permissive Referer check.
  const candidate = typeof originHeader === "string" && originHeader.trim()
    ? originHeader
    : refererHeader;
  const supplied = canonicalOrigin(candidate);
  return supplied !== null && supplied === expected;
}
