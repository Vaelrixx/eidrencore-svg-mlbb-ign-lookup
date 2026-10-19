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

test("single Teen Patti Gold route retains the broker primary and adds gated Coda secondary", () => {
  const start = routesSrc.indexOf("async function lookupTeenPattiGoldWithDirectLeg(");
  const end = routesSrc.indexOf("/**\n * Free Fire direct leg", start);
  assert.ok(start >= 0 && end > start, "single Teen Patti Gold chain must remain defined");
  const chain = routesSrc.slice(start, end);
  assert.ok(chain.includes('lookupRapidApiGame("teen-patti-gold", input)'), "broker stays primary");
  assert.ok(chain.includes('lookupCodashopDirect("teen-patti-gold", playerId, "")'), "Coda leg is additive");
  assert.ok(routesSrc.includes("lookupTeenPattiGoldWithDirectLeg(input as RapidApiGameInput)"), "route dispatch uses the chain");
});

test("bulk Teen Patti Gold route mirrors the broker-plus-Coda chain", () => {
  const start = bulkSrc.indexOf("async function lookupTeenPattiGoldWithDirectLegs(");
  const end = bulkSrc.indexOf("// Mirrors the single route: Enka", start);
  assert.ok(start >= 0 && end > start, "bulk Teen Patti Gold chain must remain defined");
  const chain = bulkSrc.slice(start, end);
  assert.ok(chain.includes('lookupRapidApiGame("teen-patti-gold", input)'), "bulk broker stays primary");
  assert.ok(chain.includes('lookupCodashopDirect("teen-patti-gold", input.playerId, "")'), "bulk Coda leg is additive");
  assert.ok(bulkSrc.includes("lookup: async (input) => lookupTeenPattiGoldWithDirectLegs(input)"), "bulk registry uses the chain");
});
