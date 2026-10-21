import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Cached identity-ledger hits are successful for users but must never count
// as provider-health samples. Each route logs them under the dedicated
// eidren_identity_ledger label (which no health bucket reads); the per-game
// source stays reserved for real upstream checks. The MLBB single route is
// covered separately by PR #105.
const routes = [
  {
    file: "../src/app/api/lookup/id-game-route.ts",
    healthSource: "source: config.publicSource })",
  },
  {
    file: "../src/app/api/lookup/bulk/route.ts",
    healthSource: "source: entry.publicSource })",
  },
  {
    file: "../src/app/api/lookup/game-route.ts",
    healthSource: "config.logSource",
  },
];

for (const route of routes) {
  test(`${route.file} logs ledger hits outside provider health`, () => {
    const src = readFileSync(new URL(route.file, import.meta.url), "utf8");
    const start = src.indexOf("if (ledgerHit) {");
    const end = src.indexOf("const attempt = await observeProvider", start);
    assert.ok(start >= 0 && end > start, "ledger-hit region must be bounded");
    const region = src.slice(start, end);
    assert.ok(region.includes('source: "eidren_identity_ledger"'));
    assert.ok(!region.includes(route.healthSource));
  });
}
