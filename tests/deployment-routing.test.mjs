import test from "node:test";
import assert from "node:assert/strict";
import {
  createRailwayFrontendRewrites,
  isBackendBlockedPagePath,
  isRailwayBackendEnvironment,
  resolveRailwayBackendOrigin,
  shouldBlockPageOnBackend,
} from "../src/lib/deployment-routing.mjs";

const railwayOrigin = "https://nexus-mlbb-ign-lookup-production.up.railway.app";

test("local and Railway deployments keep their in-process API routes", () => {
  assert.deepEqual(createRailwayFrontendRewrites({ backendOrigin: "", isVercel: false }), []);
});

test("Vercel refuses to build without the Railway API origin", () => {
  assert.throws(
    () => createRailwayFrontendRewrites({ backendOrigin: "", isVercel: true }),
    /RAILWAY_BACKEND_ORIGIN is required on Vercel/,
  );
});

test("Vercel rewrites every API route and the OAuth callback before Next route handlers", () => {
  assert.deepEqual(
    createRailwayFrontendRewrites({ backendOrigin: railwayOrigin, isVercel: true }),
    {
      beforeFiles: [
        { source: "/api/:path*", destination: `${railwayOrigin}/api/:path*` },
        { source: "/auth/callback", destination: `${railwayOrigin}/auth/callback` },
      ],
    },
  );
});

test("backend origin validation accepts only the configured HTTPS Railway origin", () => {
  assert.equal(resolveRailwayBackendOrigin(` ${railwayOrigin} `), railwayOrigin);
  for (const value of [
    "http://nexus-mlbb-ign-lookup-production.up.railway.app",
    "https://user:pass@nexus-mlbb-ign-lookup-production.up.railway.app",
    `${railwayOrigin}/api`,
    `${railwayOrigin}?redirect=elsewhere`,
    "https://attacker.example",
    "not a URL",
  ]) {
    assert.throws(() => resolveRailwayBackendOrigin(value));
  }
});

test("Railway backend detection is explicit and never matches Vercel or local", () => {
  assert.equal(isRailwayBackendEnvironment({ RAILWAY_ENVIRONMENT_NAME: "production" }), true);
  assert.equal(isRailwayBackendEnvironment({}), false);
  assert.equal(isRailwayBackendEnvironment({ VERCEL: "1", RAILWAY_ENVIRONMENT_NAME: "production" }), false);
  assert.equal(isRailwayBackendEnvironment({ VERCEL_ENV: "production" }), false);
});

test("backend blocks every human-facing page but never API or auth exchange routes", () => {
  for (const path of ["/", "/login", "/login?mode=signup", "/dashboard", "/dashboard/keys", "/playground", "/forgot-password", "/reset-password", "/auth/telegram/complete"]) {
    assert.equal(isBackendBlockedPagePath(path.split("?")[0]), true, path);
  }
  for (const path of ["/api/lookup", "/api/billing/plans", "/api/auth/telegram/callback", "/auth/callback", "/_next/static/app.js", "/favicon.ico"]) {
    assert.equal(isBackendBlockedPagePath(path), false, path);
  }
});

test("page blocking applies on Railway only, never on Vercel or locally", () => {
  const railwayEnv = { RAILWAY_ENVIRONMENT_NAME: "production" };
  assert.equal(shouldBlockPageOnBackend("/", railwayEnv), true);
  assert.equal(shouldBlockPageOnBackend("/dashboard", railwayEnv), true);
  assert.equal(shouldBlockPageOnBackend("/api/lookup", railwayEnv), false);
  assert.equal(shouldBlockPageOnBackend("/", {}), false);
  assert.equal(shouldBlockPageOnBackend("/dashboard", {}), false);
  assert.equal(shouldBlockPageOnBackend("/dashboard", { VERCEL_ENV: "production" }), false);
});
