import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCodashopResponse,
  lookupCodashopDirect,
  CODASHOP_GAMES,
} from "../src/app/api/lookup/providers/codashop-direct.mjs";
import { classifyGoPayGamesResponse, isEchoedIdentity as isEchoedMlbb } from "../src/app/api/lookup/providers/gopay-games.mjs";
import { classifyGoPayGameFallbackResponse } from "../src/app/api/lookup/providers/gopay-game-fallback.mjs";
import { classifyFreeFireResponse } from "../src/app/api/lookup/providers/gopay-free-fire.mjs";
import { classifyFcMobileResponse } from "../src/app/api/lookup/providers/gopay-fc-mobile.mjs";
import {
  calculateWinRate,
  lossesToFloor,
  winsToTarget,
} from "../src/app/api/lookup/tools/win-rate.mjs";
import {
  datasetMeta,
  heroDetail,
  listHeroes,
  searchHeroes,
} from "../src/app/api/lookup/tools/mlbb-heroes.mjs";
import {
  datasetMeta as ffWeaponMeta,
  filterWeapons,
  listWeapons,
  searchWeapons,
} from "../src/app/api/lookup/tools/ff-weapons.mjs";
import {
  normalizeTier,
  sensitivityPreset,
  sensitivityTiers,
} from "../src/app/api/lookup/tools/ff-sensitivity.mjs";

function jsonResponse(status, payload) {
  return { status, json: async () => payload };
}

// --- CodaShop direct ---

test("codashop table ships only live-verified games", () => {
  assert.deepEqual(Object.keys(CODASHOP_GAMES), ["mobile-legends"]);
  assert.equal(CODASHOP_GAMES["mobile-legends"].voucherTypeName, "9177-MOBILE_LEGENDS");
});

test("codashop success decodes plus-encoded usernames", () => {
  assert.deepEqual(
    classifyCodashopResponse(200, { result: { username: "Outrageous+Dominance", timestamp: "1" } }),
    { kind: "success", nickname: "Outrageous Dominance", source: "codashop_direct" },
  );
});

test("codashop not-found keys on verified error codes", () => {
  assert.deepEqual(
    classifyCodashopResponse(200, { success: false, errorCode: "1003", errorMsg: "1003: Error_Role_Null" }),
    { kind: "not_found" },
  );
  assert.deepEqual(
    classifyCodashopResponse(200, { success: false, errorCode: "-100", errorMsg: "-100: Error_InvalidZoneId" }),
    { kind: "not_found" },
  );
  assert.equal(classifyCodashopResponse(429, {}).kind, "rate_limited");
  assert.equal(classifyCodashopResponse(200, {}).kind, "unavailable");
  assert.equal(
    classifyCodashopResponse(200, { success: false, errorCode: "9999", errorMsg: "weird" }).kind,
    "unavailable",
  );
});

test("codashop lookup posts the store validate shape", async () => {
  let seenUrl = "";
  let seenBody = null;
  const fetchImpl = async (url, init) => {
    seenUrl = String(url);
    seenBody = JSON.parse(init.body);
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Content-Type"], "application/json");
    return jsonResponse(200, { result: { username: "Some+Player" } });
  };
  const attempt = await lookupCodashopDirect("mobile-legends", "1114917746", "13486", { fetchImpl, env: {} });
  assert.deepEqual(attempt, { kind: "success", nickname: "Some Player", source: "codashop_direct" });
  assert.equal(seenUrl, "https://order-sg.codashop.com/validate");
  assert.deepEqual(seenBody, {
    country: "PH",
    voucherTypeName: "9177-MOBILE_LEGENDS",
    whiteLabelId: "",
    deviceId: "eidren-server-001",
    userId: "1114917746",
    zoneId: "13486",
  });
  assert.ok(!JSON.stringify(attempt).includes("1114917746"));
});

test("codashop lookup rejects unverified games and bad input without fetching", async () => {
  let fetchCalled = false;
  const fetchImpl = async () => {
    fetchCalled = true;
    return jsonResponse(200, {});
  };
  assert.deepEqual(
    (await lookupCodashopDirect("free-fire", "1", "", { fetchImpl, env: {} })).kind,
    "unavailable",
  );
  assert.deepEqual(
    (await lookupCodashopDirect("mobile-legends", "", "", { fetchImpl, env: {} })).kind,
    "unavailable",
  );
  assert.deepEqual(
    (await lookupCodashopDirect("mobile-legends", "1", "", { fetchImpl, env: {} })).kind,
    "unavailable",
  );
  assert.equal(fetchCalled, false);
});

// --- GoPay echo guard ---

test("echoed identities degrade to unavailable on every GoPay leg", () => {
  const echoMlbb = { message: "Success", data: { username: "111491774613486" } };
  assert.equal(classifyGoPayGamesResponse(201, echoMlbb, "111491774613486").kind, "unavailable");
  assert.equal(classifyGoPayGamesResponse(201, echoMlbb, "111491774613486").diagnostic.reason, "unrecognized_response");

  const echoFf = { message: "Success", data: { username: "1958604115" } };
  assert.equal(classifyFreeFireResponse(201, echoFf, "1958604115").kind, "unavailable");

  const echoPubg = { message: "Success", data: { username: "5204837417" } };
  assert.equal(classifyGoPayGameFallbackResponse(201, echoPubg, "5204837417").kind, "unavailable");

  const echoFc = { message: "Success", data: { username: "123456789" } };
  assert.equal(classifyFcMobileResponse(201, echoFc, "123456789").kind, "unavailable");
});

test("real nicknames still succeed and echo matching ignores separators", () => {
  const real = { message: "Success", data: { username: "Agus๛haji" } };
  assert.deepEqual(classifyGoPayGameFallbackResponse(201, real, "5204837417"), {
    kind: "success",
    nickname: "Agus๛haji",
    source: "gopay_games_validation",
  });
  assert.equal(isEchoedMlbb("5204 837417", "5204837417"), true);
  assert.equal(isEchoedMlbb("Agus", "5204837417"), false);
  assert.equal(isEchoedMlbb("x", ""), false);
});

// --- Win-rate calculator ---

test("wins-to-target math matches hand calculation", () => {
  // 500 matches at 52% = 260 wins. To reach 55%: (55*500-100*260)/45 = 1500/45 = 33.34 → 34.
  assert.deepEqual(winsToTarget(500, 52, 55), { winsNeeded: 34, projectedMatches: 534, target: 55 });
  assert.deepEqual(winsToTarget(500, 52, 50).winsNeeded, 0);
  assert.equal(winsToTarget(500, 52, 100).impossible, true);
});

test("losses-to-floor math matches hand calculation", () => {
  // 500 matches at 52% = 260 wins. Drop to 50%: 100*260/50-500 = 20.
  assert.deepEqual(lossesToFloor(500, 52, 50), { lossesUntil: 20, projectedMatches: 520, floor: 50 });
  assert.deepEqual(lossesToFloor(500, 52, 60).lossesUntil, 0);
  assert.equal(lossesToFloor(500, 52, 0).impossible, true);
});

test("calculator validates inputs and caps list sizes", () => {
  assert.equal(calculateWinRate(-1, 50).ok, false);
  assert.equal(calculateWinRate(100, 101).ok, false);
  const result = calculateWinRate(100, 50, { targets: [55, 60, 70, 80, 90, 95], floors: [45] });
  assert.equal(result.ok, true);
  assert.equal(result.targets.length, 5);
  assert.equal(result.currentWins, 50);
  assert.equal(result.currentLosses, 50);
});

// --- Owned hero dataset ---

test("hero dataset ships 133 heroes with relations", () => {
  const heroes = listHeroes();
  assert.equal(heroes.length, 133);
  assert.deepEqual(heroes[0], { id: 1, name: "Miya", slug: "miya" });
  assert.ok(datasetMeta().attribution.includes("Rone Arena"));
});

test("hero detail resolves relations to names", () => {
  const miya = heroDetail("miya");
  assert.equal(miya.name, "Miya");
  assert.ok(miya.counters.length > 0);
  assert.ok(miya.counters.every((c) => typeof c.name === "string" && c.name.length > 0));
  assert.deepEqual(heroDetail(1).name, "Miya");
  assert.deepEqual(heroDetail("Miya").id, 1);
  assert.equal(heroDetail("no-such-hero"), null);
  assert.equal(heroDetail(""), null);
});

test("hero search is case-insensitive substring with a cap", () => {
  const hits = searchHeroes("MIY");
  assert.ok(hits.some((h) => h.name === "Miya"));
  assert.ok(searchHeroes("a").length <= 20);
  assert.deepEqual(searchHeroes(""), []);
  assert.deepEqual(searchHeroes("zzzzzz"), []);
});

// --- Owned FF weapon dataset ---

test("weapon dataset ships roster facts with class/ammo/slot", () => {
  const weapons = listWeapons();
  assert.ok(weapons.length >= 50);
  assert.equal(weapons.length, ffWeaponMeta().count);
  assert.ok(weapons.every((w) => w.name && w.class && w.ammo && w.slot));
  assert.ok(ffWeaponMeta().attribution.includes("Garena"));
  const names = weapons.map((w) => w.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("weapon filters and search work case-insensitively", () => {
  const smgs = filterWeapons({ class: "SMG" });
  assert.ok(smgs.length > 0);
  assert.ok(smgs.every((w) => w.class === "smg"));
  const ars = filterWeapons({ ammo: "ar" });
  assert.ok(ars.length > 0);
  assert.ok(ars.every((w) => w.ammo === "AR"));
  const hits = searchWeapons("mp");
  assert.ok(hits.some((w) => w.name === "MP40"));
  assert.ok(searchWeapons("a").length <= 20);
  assert.deepEqual(searchWeapons(""), []);
});

// --- Sensitivity presets ---

test("sensitivity presets cover three tiers on the 0-200 scale", () => {
  assert.deepEqual(sensitivityTiers(), ["low", "balanced", "aggressive"]);
  for (const tier of sensitivityTiers()) {
    const preset = sensitivityPreset(tier);
    assert.equal(preset.ok, true);
    assert.deepEqual(Object.keys(preset.values).sort(), ["freeLook", "general", "redDot", "scope2x", "scope4x", "sniper"]);
    assert.ok(Object.values(preset.values).every((v) => Number.isInteger(v) && v >= 0 && v <= 200));
    assert.ok(preset.notes.length > 0);
    assert.ok(preset.disclaimer.includes("Starting presets only"));
  }
});

test("tier normalization accepts aliases and rejects unknown tiers", () => {
  assert.equal(normalizeTier("mid"), "balanced");
  assert.equal(normalizeTier("FLAGSHIP"), "aggressive");
  assert.equal(normalizeTier("beginner"), "low");
  assert.equal(normalizeTier(""), null);
  assert.equal(normalizeTier("ultra"), null);
  assert.equal(sensitivityPreset("ultra").ok, false);
});
