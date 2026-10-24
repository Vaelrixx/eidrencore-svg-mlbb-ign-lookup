import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Routes run under Next.js, so wiring is pinned by source-text assertions
// (same convention as ledger-health-separation.test.mjs): the terminal
// attempt's diagnostic reason must reach persistLookupLog on every
// non-success outcome, and the rollup must count quota rows separately.
test("single route threads terminal diagnostics into lookup logs", () => {
  const src = readFileSync(new URL("../src/app/api/lookup/id-game-route.ts", import.meta.url), "utf8");
  // loggedError takes the reason positionally and forwards it to persistLookupLog.
  assert.ok(src.includes("failureReason?: string"));
  assert.ok(src.includes("source: config.publicSource, failureReason }"));
  const occurrences = src.split("attempt.diagnostic?.reason").length - 1;
  assert.equal(occurrences, 3);
});

test("bulk route threads terminal diagnostics into per-item logs", () => {
  const src = readFileSync(new URL("../src/app/api/lookup/bulk/route.ts", import.meta.url), "utf8");
  const occurrences = src.split("failureReason: attempt.diagnostic?.reason").length - 1;
  assert.equal(occurrences, 3);
});

test("status rollup separates quota exhaustion from the error rate", () => {
  const src = readFileSync(new URL("../src/app/api/lookup/status/route.ts", import.meta.url), "utf8");
  assert.ok(src.includes('.select("status,source,failure_reason")'));
  assert.ok(src.includes('row.failure_reason === "quota_exhausted"'));
  assert.ok(src.includes("quotaExhausted:"));
  assert.ok(src.includes("quotaExhaustedChecks:"));
});
