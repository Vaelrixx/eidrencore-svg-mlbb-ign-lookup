import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

function response(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Compile the example client once and import the emitted JS. */
async function loadClient(t) {
  const dir = await mkdtemp(join(tmpdir(), "eidren-client-"));
  t.after(() => import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true })));
  await execFileAsync("npx", ["tsc", "examples/typescript/eidren-client.ts", "--outDir", dir, "--module", "nodenext", "--target", "es2022", "--skipLibCheck"], { cwd: new URL("..", import.meta.url).pathname });
  return import(pathToFileURL(join(dir, "eidren-client.js")).href);
}

test("client source stays in sync with the documented game slugs", async () => {
  const source = await readFile(new URL("../examples/typescript/eidren-client.ts", import.meta.url), "utf8");
  for (const slug of ["brawl-stars", "clash-of-clans", "clash-royale"]) {
    assert.match(source, new RegExp(`"${slug}": "/api/lookup/${slug}"`));
  }
  assert.match(source, /lookupMlbb\(playerId: string, zoneId: string\)/);
});

test("each Supercell helper posts the tag to its own endpoint", async (t) => {
  const { createEidrenClient } = await loadClient(t);
  const seen = [];
  const client = createEidrenClient("eid_unit-test-key", {
    baseUrl: "https://example.test",
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), auth: init?.headers?.Authorization, body: JSON.parse(init.body) });
      return response(200, { success: true, data: { nickname: "ValidNickname", tag: "#2PP", source: "test" } });
    },
  });
  const bs = await client.lookupBrawlStars("2pp");
  const coc = await client.lookupClashOfClans("#2PP");
  const cr = await client.lookupClashRoyale("#C0G20PR2");
  assert.equal(bs.nickname, "ValidNickname");
  assert.equal(coc.tag, "#2PP");
  assert.equal(cr.nickname, "ValidNickname");
  assert.deepEqual(seen.map((s) => s.url), [
    "https://example.test/api/lookup/brawl-stars",
    "https://example.test/api/lookup/clash-of-clans",
    "https://example.test/api/lookup/clash-royale",
  ]);
  assert.ok(seen.every((s) => s.auth === "Bearer eid_unit-test-key"));
  assert.deepEqual(seen[0].body, { tag: "2pp" });
});

test("game picker rejects unknown slugs before fetching", async (t) => {
  const { createEidrenClient } = await loadClient(t);
  let fetchCalled = false;
  const client = createEidrenClient("eid_unit-test-key", {
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("unexpected fetch");
    },
  });
  assert.throws(() => client.lookupSupercell("free-fire", "#2PP"), /Unknown Supercell game/);
  assert.equal(fetchCalled, false);
});

test("clan, history, and rankings helpers post to their own endpoints", async (t) => {
  const { createEidrenClient } = await loadClient(t);
  const seen = [];
  const client = createEidrenClient("eid_unit-test-key", {
    baseUrl: "https://example.test",
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), body: JSON.parse(init.body) });
      const path = String(url);
      if (path.endsWith("/club") || path.endsWith("/clan")) {
        return response(200, { success: true, data: { name: "Test Group", tag: "#2PP", group: "clan", details: {}, source: "test" } });
      }
      if (path.endsWith("/battles")) {
        return response(200, { success: true, data: { tag: "#2PP", battles: [], count: 0, source: "test" } });
      }
      if (path.endsWith("/warlog")) {
        return response(200, { success: true, data: { tag: "#2PP", wars: [], count: 0, source: "test" } });
      }
      return response(200, { success: true, data: { locationId: "global", entries: [], count: 0, source: "test" } });
    },
  });
  await client.lookupBrawlStarsClub("#2PP");
  await client.lookupClashOfClansClan("#2PP");
  await client.lookupClashRoyaleClan("#C0G20PR2");
  await client.lookupBrawlStarsBattles("#2PP");
  await client.lookupClashOfClansWarlog("#2PP");
  await client.lookupClashRoyaleBattles("#C0G20PR2");
  await client.lookupClashRoyaleRankings();
  await client.lookupRankings("brawl-stars", "global");
  assert.deepEqual(seen.map((s) => s.url), [
    "https://example.test/api/lookup/brawl-stars/club",
    "https://example.test/api/lookup/clash-of-clans/clan",
    "https://example.test/api/lookup/clash-royale/clan",
    "https://example.test/api/lookup/brawl-stars/battles",
    "https://example.test/api/lookup/clash-of-clans/warlog",
    "https://example.test/api/lookup/clash-royale/battles",
    "https://example.test/api/lookup/clash-royale/rankings",
    "https://example.test/api/lookup/brawl-stars/rankings",
  ]);
  assert.deepEqual(seen[0].body, { tag: "#2PP" });
  assert.deepEqual(seen[6].body, { locationId: "global" });
});

test("named helpers work when destructured from the client", async (t) => {
  const { createEidrenClient } = await loadClient(t);
  const client = createEidrenClient("eid_unit-test-key", {
    fetchImpl: async () => response(200, { success: true, data: { nickname: "Name", tag: "#2PP", source: "test" } }),
  });
  const { lookupBrawlStars } = client;
  assert.equal((await lookupBrawlStars("#2PP")).nickname, "Name");
});

test("errors carry status, code, request id, and retry hints", async (t) => {
  const { createEidrenClient, EidrenApiError } = await loadClient(t);
  const client = createEidrenClient("eid_unit-test-key", {
    fetchImpl: async (url) => {
      if (String(url).endsWith("/brawl-stars")) {
        return response(404, { success: false, error: "No Brawl Stars account was found for that player tag.", code: "BS_PLAYER_NOT_FOUND" }, { "X-Lookup-Request-Id": "req-123" });
      }
      return response(429, { success: false, error: "Rate limited.", code: "SERVICE_RATE_LIMIT" }, { "X-Lookup-Request-Id": "req-456", "Retry-After": "30" });
    },
  });
  const notFound = await client.lookupBrawlStars("#QQQQQQQQ").then(
    () => assert.fail("expected a throw"),
    (error) => error,
  );
  assert.ok(notFound instanceof EidrenApiError);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.code, "BS_PLAYER_NOT_FOUND");
  assert.equal(notFound.requestId, "req-123");
  assert.equal(notFound.retryable, false);

  const limited = await client.lookupClashRoyale("#C0G20PR2").then(
    () => assert.fail("expected a throw"),
    (error) => error,
  );
  assert.ok(limited instanceof EidrenApiError);
  assert.equal(limited.status, 429);
  assert.equal(limited.code, "SERVICE_RATE_LIMIT");
  assert.equal(limited.retryAfterSeconds, 30);
  assert.equal(limited.retryable, true);

  const quotaClient = createEidrenClient("eid_unit-test-key", {
    fetchImpl: async () => response(429, { success: false, error: "Quota reached.", code: "API_QUOTA_EXCEEDED" }),
  });
  const quotaError = await quotaClient.lookupClashRoyale("#C0G20PR2").then(
    () => assert.fail("expected a throw"),
    (error) => error,
  );
  assert.equal(quotaError.retryable, false);
});

test("client rejects malformed keys without fetching", async (t) => {
  const { createEidrenClient } = await loadClient(t);
  assert.throws(() => createEidrenClient("not-a-key"), /starts with eid_/);
  assert.throws(() => createEidrenClient(""), /valid Eidren API key/);
});
