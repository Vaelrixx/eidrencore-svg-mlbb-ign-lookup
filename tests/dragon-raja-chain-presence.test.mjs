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

test("single Dragon Raja route retains the broker primary and adds gated Coda secondary", () => {
  const start = routesSrc.indexOf("async function lookupDragonRajaWithDirectLeg(");
  const end = routesSrc.indexOf("/**\n * Free Fire direct leg", start);
  assert.ok(start >= 0 && end > start, "single Dragon Raja chain must remain defined");
  const chain = routesSrc.slice(start, end);
  assert.ok(chain.includes('lookupRapidApiGame("dragon-raja", input)'), "broker stays primary");
  assert.ok(chain.includes('lookupCodashopInitpay("dragon-raja", playerId)'), "Coda leg is additive");
  assert.ok(routesSrc.includes("lookupDragonRajaWithDirectLeg(input as RapidApiGameInput)"), "route dispatch uses the chain");
});

test("bulk Dragon Raja route mirrors the broker-plus-Coda chain", () => {
  const start = bulkSrc.indexOf("async function lookupDragonRajaWithDirectLegs(");
  const end = bulkSrc.indexOf("// Mirrors the single route: Enka", start);
  assert.ok(start >= 0 && end > start, "bulk Dragon Raja chain must remain defined");
  const chain = bulkSrc.slice(start, end);
  assert.ok(chain.includes('lookupRapidApiGame("dragon-raja", input)'), "bulk broker stays primary");
  assert.ok(chain.includes('lookupCodashopInitpay("dragon-raja", input.playerId)'), "bulk Coda leg is additive");
  assert.ok(bulkSrc.includes("lookup: async (input) => lookupDragonRajaWithDirectLegs(input)"), "bulk registry uses the chain");
});

test("Dragon Raja Coda entry remains disabled unless its explicit flag is true", () => {
  assert.ok(providerSrc.includes('enabledEnv: "CODASHOP_DRAGON_RAJA_ENABLED"'));
  assert.ok(providerSrc.includes('env[config.enabledEnv] !== "true"'));
});
