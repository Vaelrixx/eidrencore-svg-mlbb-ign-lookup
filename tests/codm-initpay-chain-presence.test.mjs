import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routesSrc = readFileSync(
  new URL("../src/app/api/lookup/rapidapi-game-routes.ts", import.meta.url),
  "utf8",
);
const bulkSrc = readFileSync(
  new URL("../src/app/api/lookup/bulk-games.mjs", import.meta.url),
  "utf8",
);
const providerSrc = readFileSync(
  new URL("../src/app/api/lookup/providers/codashop-initpay.mjs", import.meta.url),
  "utf8",
);

test("single CODM numeric path keeps broker primary, WL nicknames, gated initpay fallback", () => {
  const start = routesSrc.indexOf("async function lookupCodmSplit(");
  const end = routesSrc.indexOf("Jawaker chain", start);
  assert.ok(start >= 0 && end > start, "single CODM split chain must remain defined");
  const chain = routesSrc.slice(start, end);
  assert.ok(chain.includes('lookupRapidApiGame("cod-mobile-garena", input)'), "broker stays numeric primary");
  assert.ok(chain.includes('lookupCodashopDirect("call-of-duty-mobile", playerId, "")'), "WL stays the nickname leg");
  assert.ok(chain.includes('lookupCodashopInitpay("call-of-duty-mobile", playerId)'), "initpay is numeric-only fallback");
});

test("bulk CODM route mirrors the split plus gated numeric fallback", () => {
  const start = bulkSrc.indexOf('"call-of-duty-mobile": identityGame({');
  assert.ok(start >= 0, "bulk CODM entry must remain defined");
  const chain = bulkSrc.slice(start, start + 1600);
  assert.ok(chain.includes('lookupRapidApiGame("cod-mobile-garena", input)'), "bulk broker stays numeric primary");
  assert.ok(chain.includes('lookupCodashopDirect("call-of-duty-mobile", input.playerId, "")'), "bulk WL stays the nickname leg");
  assert.ok(chain.includes('lookupCodashopInitpay("call-of-duty-mobile", input.playerId)'), "bulk initpay is numeric-only fallback");
});

test("CODM initpay entry remains disabled unless its explicit flag is true", () => {
  assert.ok(providerSrc.includes('enabledEnv: "CODASHOP_CODM_INITPAY_ENABLED"'));
});
