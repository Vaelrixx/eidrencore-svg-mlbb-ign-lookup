import "server-only";

const DEFAULT_APP_ORIGIN = "https://nexus-mlbb-ign-lookup-production.up.railway.app";

export function getPublicAppOrigin(requestUrl?: string) {
  const configured = process.env.APP_URL?.trim();
  if (!configured && requestUrl) {
    try {
      const requestOrigin = new URL(requestUrl);
      if (requestOrigin.hostname === "localhost" || requestOrigin.hostname === "127.0.0.1") return requestOrigin.origin;
    } catch { /* Fall back to the configured production origin. */ }
  }

  const candidate = configured || DEFAULT_APP_ORIGIN;
  const parsed = new URL(candidate);
  const localHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password) {
    throw new Error("APP_URL must be an HTTPS origin (HTTP is allowed only for localhost).");
  }
  return parsed.origin;
}
