import test from "node:test";
import assert from "node:assert/strict";
import { createContentSecurityPolicy } from "../src/lib/security/content-security-policy.mjs";

test("CSP authorizes Next inline scripts only with the per-request nonce", () => {
  const nonce = "a".repeat(32);
  const policy = createContentSecurityPolicy(nonce);
  const scriptSrc = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src "));

  assert.equal(scriptSrc, `script-src 'self' 'nonce-${nonce}'`);
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
});

test("CSP nonce validation rejects malformed values", () => {
  assert.throws(() => createContentSecurityPolicy("' ; script-src *"), TypeError);
  assert.throws(() => createContentSecurityPolicy("short"), TypeError);
});
