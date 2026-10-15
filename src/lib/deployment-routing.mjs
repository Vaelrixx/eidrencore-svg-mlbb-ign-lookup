const REQUIRED_RAILWAY_ORIGIN = "https://nexus-mlbb-ign-lookup-production.up.railway.app";

export function resolveRailwayBackendOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("RAILWAY_BACKEND_ORIGIN must be a valid HTTPS origin.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== REQUIRED_RAILWAY_ORIGIN
  ) {
    throw new Error("RAILWAY_BACKEND_ORIGIN must match the approved Railway production origin.");
  }

  return parsed.origin;
}

export function createRailwayFrontendRewrites({ backendOrigin, isVercel }) {
  const origin = resolveRailwayBackendOrigin(backendOrigin);
  if (!origin) {
    if (isVercel) {
      throw new Error("RAILWAY_BACKEND_ORIGIN is required on Vercel; API routes must remain on Railway.");
    }
    return [];
  }

  return {
    beforeFiles: [
      { source: "/api/:path*", destination: `${origin}/api/:path*` },
      { source: "/auth/callback", destination: `${origin}/auth/callback` },
    ],
  };
}

const BACKEND_ONLY_PAGE_PREFIXES = [
  "/dashboard",
  "/login",
  "/playground",
  "/forgot-password",
  "/reset-password",
];

// Served by the Vercel UI after Railway's /api/auth/telegram/callback
// finishes the token exchange. Kept out of the prefix list so the
// /auth/callback OAuth exchange route stays live on Railway.
const BACKEND_BLOCKED_PAGE_PATHS = new Set(["/auth/telegram/complete"]);

/**
 * Railway is the API backend only: it serves /api/* plus the auth exchange
 * endpoints that must run beside the secrets. Every human-facing page
 * (landing, login, dashboard, playground, password flows) is served by the
 * Vercel UI deployment. On Railway (and only there) those page routes answer
 * 404 so the UI can never be served from both platforms.
 *
 * Detection is explicit: RAILWAY_ENVIRONMENT_NAME is set by Railway on every
 * deployment, and Vercel always sets VERCEL / VERCEL_ENV. Local dev sets
 * neither, so pages keep rendering locally.
 */
export function isRailwayBackendEnvironment(env = process.env) {
  if (env.VERCEL === "1" || env.VERCEL_ENV) return false;
  return Boolean(env.RAILWAY_ENVIRONMENT_NAME);
}

export function isBackendBlockedPagePath(pathname) {
  if (pathname === "/") return true;
  if (BACKEND_BLOCKED_PAGE_PATHS.has(pathname)) return true;
  return BACKEND_ONLY_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function shouldBlockPageOnBackend(pathname, env = process.env) {
  if (!isRailwayBackendEnvironment(env)) return false;
  return isBackendBlockedPagePath(pathname);
}
