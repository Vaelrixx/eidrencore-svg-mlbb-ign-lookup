import test from "node:test";
import assert from "node:assert/strict";
import { createProviderCache } from "../src/app/api/lookup/providers/provider-cache.mjs";
import {
  fetchSupercellPathWithFallback,
  supercellBasesFor,
} from "../src/app/api/lookup/providers/supercell-fallback.mjs";
import {
  classifyProfileResponse,
  lookupSupercellProfile,
} from "../src/app/api/lookup/providers/supercell-profile.mjs";

function jsonResponse(status, payload) {
  return { status, json: async () => payload };
}

// --- provider-cache ---

test("cache returns stored values until the TTL expires", () => {
  let t = 1000;
  const cache = createProviderCache({ clock: () => t });
  cache.set("k", { kind: "success" }, 60);
  assert.deepEqual(cache.get("k"), { kind: "success" });
  t += 59_999;
  assert.deepEqual(cache.get("k"), { kind: "success" });
  t += 1;
  assert.equal(cache.get("k"), undefined);
});

test("getOrLoad coalesces concurrent loaders into one call", async () => {
  const cache = createProviderCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { kind: "success" };
  };
  const [a, b, c] = await Promise.all([
    cache.getOrLoad("k", 60, loader),
    cache.getOrLoad("k", 60, loader),
    cache.getOrLoad("k", 60, loader),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(c.cached, true);
  const again = await cache.getOrLoad("k", 60, loader);
  assert.equal(calls, 1);
  assert.equal(again.cached, true);
});

test("cache evicts entries past the max size", () => {
  const cache = createProviderCache({ maxEntries: 2 });
  cache.set("a", 1, 60);
  cache.set("b", 2, 60);
  cache.set("c", 3, 60);
  assert.equal(cache.stats().entries, 2);
  assert.equal(cache.get("c"), 3);
});

// --- supercell-fallback base resolution ---

test("default chain is official primary with proxy secondary", () => {
  const bases = supercellBasesFor("brawl-stars", {});
  assert.deepEqual(bases, ["https://api.brawlstars.com", "https://bsproxy.royaleapi.dev"]);
  assert.deepEqual(supercellBasesFor("clash-of-clans", {}), [
    "https://api.clashofclans.com",
    "https://cocproxy.royaleapi.dev",
  ]);
  assert.deepEqual(supercellBasesFor("clash-royale", {}), [
    "https://api.clashroyale.com",
    "https://proxy.royaleapi.dev",
  ]);
});

test("legacy proxy-primary config fails over to official", () => {
  const bases = supercellBasesFor("brawl-stars", { BRAWL_STARS_API_BASE: "https://bsproxy.royaleapi.dev/" });
  assert.deepEqual(bases, ["https://bsproxy.royaleapi.dev", "https://api.brawlstars.com"]);
});

test("explicit fallback base wins and identical bases collapse", () => {
  assert.deepEqual(
    supercellBasesFor("clash-royale", {
      CLASH_ROYALE_API_BASE: "https://primary.example",
      CLASH_ROYALE_API_FALLBACK_BASE: "https://secondary.example/",
    }),
    ["https://primary.example", "https://secondary.example"],
  );
  assert.deepEqual(
    supercellBasesFor("clash-royale", {
      CLASH_ROYALE_API_BASE: "https://same.example",
      CLASH_ROYALE_API_FALLBACK_BASE: "https://same.example/",
    }),
    ["https://same.example"],
  );
  assert.equal(supercellBasesFor("unknown-game", {}), null);
});

// --- fetch with fallback ---

test("primary success never touches the secondary", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return jsonResponse(200, { name: "N" });
  };
  const env = { BRAWL_STARS_API_KEY: "k" };
  const result = await fetchSupercellPathWithFallback("brawl-stars", "/v1/players/%232PP", { fetchImpl, env });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.failedOver, false);
  assert.deepEqual(seen, ["https://api.brawlstars.com/v1/players/%232PP"]);
});

test("primary 500 fails over to the proxy and returns its result", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.startsWith("https://api.brawlstars.com")) return jsonResponse(500, { reason: "oops" });
    return jsonResponse(200, { name: "Recovered" });
  };
  const result = await fetchSupercellPathWithFallback("brawl-stars", "/v1/players/%232PP", {
    fetchImpl,
    env: { BRAWL_STARS_API_KEY: "k" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.attempts, 2);
  assert.equal(result.failedOver, true);
  assert.deepEqual(result.payload, { name: "Recovered" });
  assert.deepEqual(seen, [
    "https://api.brawlstars.com/v1/players/%232PP",
    "https://bsproxy.royaleapi.dev/v1/players/%232PP",
  ]);
});

test("primary 403 fails over but 429 does not", async () => {
  const forbiddenFetch = async (url) => (url.startsWith("https://api.brawlstars.com")
    ? jsonResponse(403, { reason: "accessDenied" })
    : jsonResponse(200, { name: "ViaProxy" }));
  const forbidden = await fetchSupercellPathWithFallback("brawl-stars", "/v1/x", {
    fetchImpl: forbiddenFetch,
    env: { BRAWL_STARS_API_KEY: "k" },
  });
  assert.equal(forbidden.failedOver, true);
  assert.equal(forbidden.status, 200);

  let calls = 0;
  const throttledFetch = async () => {
    calls += 1;
    return jsonResponse(429, { reason: "throttled" });
  };
  const throttled = await fetchSupercellPathWithFallback("brawl-stars", "/v1/x", {
    fetchImpl: throttledFetch,
    env: { BRAWL_STARS_API_KEY: "k" },
  });
  assert.equal(throttled.failedOver, false);
  assert.equal(throttled.attempts, 1);
  assert.equal(calls, 1);
  assert.equal(throttled.status, 429);
});

test("network failure fails over; missing config does not", async () => {
  const flaky = async (url) => {
    if (url.startsWith("https://api.brawlstars.com")) throw new Error("boom");
    return jsonResponse(200, { name: "ViaProxy" });
  };
  const recovered = await fetchSupercellPathWithFallback("brawl-stars", "/v1/x", {
    fetchImpl: flaky,
    env: { BRAWL_STARS_API_KEY: "k" },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.failedOver, true);

  let fetchCalled = false;
  const missing = await fetchSupercellPathWithFallback("brawl-stars", "/v1/x", {
    fetchImpl: async () => {
      fetchCalled = true;
      return jsonResponse(200, {});
    },
    env: { BRAWL_STARS_API_KEY: "" },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.attempts, 1);
  assert.equal(missing.failedOver, false);
  assert.deepEqual(missing.attempt, { kind: "unavailable", diagnostic: { reason: "missing_config" } });
  assert.equal(fetchCalled, false);
});

// --- profile adapter ---

test("profile classification mirrors the nickname adapter", () => {
  assert.deepEqual(
    classifyProfileResponse(200, { tag: "#2PP", name: "N" }, "s"),
    { kind: "success", nickname: "N", source: "s" },
  );
  assert.deepEqual(classifyProfileResponse(404, { reason: "notFound" }, "s"), { kind: "not_found" });
  assert.deepEqual(classifyProfileResponse(429, {}, "s"), {
    kind: "rate_limited",
    diagnostic: { reason: "http_error", statusCode: 429 },
  });
  assert.deepEqual(classifyProfileResponse(500, null, "s"), {
    kind: "unavailable",
    diagnostic: { reason: "http_error", statusCode: 500 },
  });
});

test("brawl stars profiles summarize progression and counts", async () => {
  const payload = {
    tag: "#2PP",
    name: "StarPlayer",
    trophies: 50000,
    highestTrophies: 55000,
    expLevel: 120,
    "3vs3Victories": 9000,
    brawlers: [{ id: 1 }, { id: 2 }],
    starPowers: [{ id: 1 }],
    gadgets: [],
    club: { tag: "#CLUB", name: "MyClub" },
  };
  const fetchImpl = async () => jsonResponse(200, payload);
  const attempt = await lookupSupercellProfile("brawl-stars", "#2pp", {
    fetchImpl,
    env: { BRAWL_STARS_API_KEY: "k" },
    cache: createProviderCache(),
  });
  assert.equal(attempt.kind, "success");
  assert.deepEqual(attempt.profile, {
    name: "StarPlayer",
    tag: "#2PP",
    trophies: 50000,
    level: 120,
    wins: 9000,
    club: { name: "MyClub", tag: "#CLUB" },
    highestTrophies: 55000,
    brawlerCount: 2,
    starPowerCount: 1,
    gadgetCount: 0,
  });
  assert.equal(attempt.cached, false);
});

test("clash profiles use game-specific fields", async () => {
  const coc = {
    tag: "#2PP", name: "Chief", trophies: 6000, townHallLevel: 16, warStars: 1500,
    troops: [{}, {}], heroes: [{}], achievements: [{}, {}, {}], clan: { tag: "#C", name: "War" },
  };
  const cr = {
    tag: "#C0G20PR2", name: "Royale", trophies: 8000, expLevel: 55, wins: 3000,
    challengeCardsWon: 10, tournamentCardsWon: 4, cards: [{}, {}], clan: { tag: "#D", name: "Deck" },
  };
  const cocAttempt = await lookupSupercellProfile("clash-of-clans", "#2pp", {
    fetchImpl: async () => jsonResponse(200, coc),
    env: { CLASH_OF_CLANS_API_KEY: "k" },
    cache: createProviderCache(),
  });
  assert.equal(cocAttempt.profile.townHallLevel, 16);
  assert.equal(cocAttempt.profile.warStars, 1500);
  assert.equal(cocAttempt.profile.troopCount, 2);
  assert.equal(cocAttempt.profile.heroCount, 1);
  assert.equal(cocAttempt.profile.achievementCount, 3);

  const crAttempt = await lookupSupercellProfile("clash-royale", "#c0g20pr2", {
    fetchImpl: async () => jsonResponse(200, cr),
    env: { CLASH_ROYALE_API_KEY: "k" },
    cache: createProviderCache(),
  });
  assert.equal(crAttempt.profile.challengeCardsWon, 10);
  assert.equal(crAttempt.profile.cardCount, 2);
  assert.equal(crAttempt.profile.club.name, "Deck");
});

test("profiles cache per game and tag and never leak credentials", async () => {
  let calls = 0;
  const cache = createProviderCache();
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.ok(!String(url).includes("secret-key"));
    assert.equal(init.headers.Authorization, "Bearer secret-key");
    return jsonResponse(200, { tag: "#2PP", name: "Cached" });
  };
  const env = { BRAWL_STARS_API_KEY: "secret-key" };
  const first = await lookupSupercellProfile("brawl-stars", "#2PP", { fetchImpl, env, cache });
  const second = await lookupSupercellProfile("brawl-stars", "2pp", { fetchImpl, env, cache });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.deepEqual(second.profile.name, "Cached");
  assert.ok(!JSON.stringify(second).includes("secret-key"));

  const other = await lookupSupercellProfile("clash-royale", "#2PP", {
    fetchImpl,
    env: { ...env, CLASH_ROYALE_API_KEY: "secret-key" },
    cache,
  });
  assert.equal(other.cached, false);
  assert.equal(calls, 2);
});

test("profile lookup fails over on proxy outage and reports not_found", async () => {
  const fetchImpl = async (url) => (url.startsWith("https://api.brawlstars.com")
    ? jsonResponse(503, { reason: "down" })
    : jsonResponse(200, { tag: "#2PP", name: "Recovered" }));
  const recovered = await lookupSupercellProfile("brawl-stars", "#2PP", {
    fetchImpl,
    env: { BRAWL_STARS_API_KEY: "k" },
    cache: createProviderCache(),
  });
  assert.equal(recovered.kind, "success");
  assert.equal(recovered.profile.name, "Recovered");

  const missing = await lookupSupercellProfile("brawl-stars", "#2PP", {
    fetchImpl: async () => jsonResponse(404, { reason: "notFound" }),
    env: { BRAWL_STARS_API_KEY: "k" },
    cache: createProviderCache(),
  });
  assert.deepEqual(missing, { kind: "not_found" });
});
