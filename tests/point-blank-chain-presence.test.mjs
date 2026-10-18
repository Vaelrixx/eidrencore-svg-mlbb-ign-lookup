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

test("single Point Blank route retains the broker primary and adds gated Coda secondary", () => {
  const start = routesSrc.indexOf("async function lookupPointBlankWithDirectLeg(");
  const end = routesSrc.indexOf("/**\n * Free Fire direct leg", start);
  assert.ok(start >= 0 && end > start, "single Point Blank chain must remain defined");
  const chain = routesSrc.slice(start, end);
  assert.ok(chain.includes('lookupRapidApiGame("point-blank", input)'), "broker stays primary");
  assert.ok(chain.includes('lookupCodashopInitpay("point-blank", playerId)'), "Coda leg is additive");
  assert.ok(routesSrc.includes("lookupPointBlankWithDirectLeg(input as RapidApiGameInput)"), "route dispatch uses the chain");
});

test("bulk Point Blank route mirrors the broker-plus-Coda chain", () => {
  const start = bulkSrc.indexOf("async function lookupPointBlankWithDirectLegs(");
  const end = bulkSrc.indexOf("// Mirrors the single route: Enka", start);
  assert.ok(start >= 0 && end > start, "bulk Point Blank chain must remain defined");
  const chain = bulkSrc.slice(start, end);
  assert.ok(chain.includes('lookupRapidApiGame("point-blank", input)'), "bulk broker stays primary");
  assert.ok(chain.includes('lookupCodashopInitpay("point-blank", input.playerId)'), "bulk Coda leg is additive");
  assert.ok(bulkSrc.includes("lookup: async (input) => lookupPointBlankWithDirectLegs(input)"), "bulk registry uses the chain");
});
