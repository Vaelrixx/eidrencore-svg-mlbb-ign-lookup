import test from "node:test";
import assert from "node:assert/strict";
import {
  createRailwayFrontendRewrites,
  resolveRailwayBackendOrigin,
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
