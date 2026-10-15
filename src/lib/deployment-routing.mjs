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
