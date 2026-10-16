#!/usr/bin/env node
/**
 * Production regression sweep: exercises every live-verified lookup mode
 * against the deployed backend and fails non-zero on any mismatch.
 *
 * Env: PROD_BASE_URL (required), EIDREN_MONITOR_KEY (Bearer eid_... required).
 * Read-only lookups only; no keys created, nothing written except the
 * service's own request logs. Never prints the key or nicknames on failure —
 * only route, expected vs actual status/code.
 *
 * Modes pinned (samples last verified live 2026-10-17):
 * - CODM nickname / shortId / bogus-404 / numeric-degraded
 * - FF weapons + sensitivity (no-auth tools)
 * - PUBG Lite-vs-Global routing + Global anchor
 * - MLBB + PUBG anchors, health endpoint
 */

const BASE = (process.env.PROD_BASE_URL || "").replace(/\/$/, "");
const KEY = (process.env.EIDREN_MONITOR_KEY || "").trim();
if (!BASE || !KEY.startsWith("eid_")) {
  console.error("usage: PROD_BASE_URL=https://... EIDREN_MONITOR_KEY=eid_... node scripts/prod-regression.mjs");
  process.exit(2);
}

const results = [];
async function check(name, method, path, body, expect) {
  const init = { method, headers: {}, signal: AbortSignal.timeout(60000) };
  if (body !== null) {
    init.headers = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
    init.body = JSON.stringify(body);
  }
  let status;
  let code;
  try {
    const res = await fetch(`${BASE}${path}`, init);
    status = res.status;
    const payload = await res.json().catch(() => ({}));
    code = typeof payload.code === "string" ? payload.code : (payload.success ? "OK" : "");
  } catch (error) {
    results.push({ name, pass: false, detail: `fetch failed: ${error.cause?.code || error.message}` });
    return;
  }
  const pass = status === expect.status && (expect.code === undefined || code === expect.code);
  results.push({ name, pass, detail: pass ? `HTTP ${status}` : `want ${expect.status}/${expect.code || "*"} got ${status}/${code || "?"}` });
}

await check("health ok", "GET", "/api/health", null, { status: 200 });
await check("CODM nickname", "POST", "/api/lookup/call-of-duty-mobile", { playerId: "ShadowHex" }, { status: 200 });
await check("CODM shortId", "POST", "/api/lookup/call-of-duty-mobile", { playerId: "6QKPNM" }, { status: 200 });
await check("CODM bogus 404", "POST", "/api/lookup/call-of-duty-mobile", { playerId: "ZzZzNoSuchPlayer9x8y7z" }, { status: 404, code: "CODM_PLAYER_NOT_FOUND" });
await check("CODM numeric degraded", "POST", "/api/lookup/call-of-duty-mobile", { playerId: "8370310025568788000" }, { status: 502, code: "SERVICE_UNAVAILABLE" });
await check("FF weapons", "GET", "/api/lookup/free-fire/weapons", null, { status: 200 });
await check("FF sensitivity", "GET", "/api/lookup/free-fire/tools/sensitivity?tier=balanced", null, { status: 200 });
await check("Lite ID on Global 404", "POST", "/api/lookup/pubg-mobile", { playerId: "7228395004" }, { status: 404, code: "PUBG_PLAYER_NOT_FOUND" });
await check("Lite ID on Lite", "POST", "/api/lookup/pubg-lite", { playerId: "7228395004" }, { status: 200 });
await check("Global anchor", "POST", "/api/lookup/pubg-mobile", { playerId: "5204837417" }, { status: 200 });
await check("MLBB anchor", "POST", "/api/lookup", { playerId: "1114917746", zoneId: "13486" }, { status: 200 });

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name} — ${r.detail}`);
  if (!r.pass) failed++;
}
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
