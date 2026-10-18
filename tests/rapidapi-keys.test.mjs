import test from "node:test";
import assert from "node:assert/strict";
import { rapidApiKeys } from "../src/app/api/lookup/providers/rapidapi-keys.mjs";
import { lookupRapidApi } from "../src/app/api/lookup/providers/rapidapi.mjs";
import { lookupRapidApiGame } from "../src/app/api/lookup/providers/rapidapi-games.mjs";

const ENV_KEYS = ["RAPIDAPI_KEY_NEW", "RAPIDAPI_KEY", "RAPIDAPI_APP_TOKEN"];
function saveEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}
function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

 test("new RapidAPI key is primary; existing key and legacy token remain ordered fallbacks", () => {
  const saved = saveEnv();
  process.env.RAPIDAPI_KEY_NEW = " fresh ";
  process.env.RAPIDAPI_KEY = "old";
  process.env.RAPIDAPI_APP_TOKEN = "old";
  try {
    assert.deepEqual(rapidApiKeys(), ["fresh", "old"]);
    assert.deepEqual(rapidApiKeys({ apiKey: "test-override" }), ["test-override"]);
  } finally {
    restoreEnv(saved);
  }
});

test("MLBB lookup falls through a rate-limited fresh key to the existing key", async () => {
  const saved = saveEnv();
  const previousFetch = globalThis.fetch;
  const seenKeys = [];
  process.env.RAPIDAPI_KEY_NEW = "fresh-key";
  process.env.RAPIDAPI_KEY = "existing-key";
  delete process.env.RAPIDAPI_APP_TOKEN;
  globalThis.fetch = async (_url, init) => {
    seenKeys.push(init.headers["x-rapidapi-key"]);
    if (seenKeys.length === 1) return new Response("{}", { status: 429 });
    return new Response(JSON.stringify({ error: false, status: 200, msg: "id_found", data: { username: "MLBBPlayer" } }), { status: 200 });
  };
  try {
    const result = await lookupRapidApi("1114917746", "13486");
    assert.deepEqual(seenKeys, ["fresh-key", "existing-key"]);
    assert.deepEqual(result, { kind: "success", nickname: "MLBBPlayer", source: "rapidapi_id_game_checker" });
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(saved);
  }
});

test("RapidAPI game lookup falls through a rate-limited fresh key to the existing key", async () => {
  const saved = saveEnv();
  const seenKeys = [];
  process.env.RAPIDAPI_KEY_NEW = "fresh-key";
  process.env.RAPIDAPI_KEY = "existing-key";
  delete process.env.RAPIDAPI_APP_TOKEN;
  try {
    const result = await lookupRapidApiGame("honor-of-kings", { playerId: "17960996468644334037" }, {
      fetchImpl: async (_url, init) => {
        seenKeys.push(init.headers["x-rapidapi-key"]);
        if (seenKeys.length === 1) return new Response("{}", { status: 429 });
        return new Response(JSON.stringify({ error: false, status: 200, msg: "id_found", data: { username: "HoKPlayer" } }), { status: 200 });
      },
    });
    assert.deepEqual(seenKeys, ["fresh-key", "existing-key"]);
    assert.deepEqual(result, { kind: "success", nickname: "HoKPlayer", source: "rapidapi_id_game_checker" });
  } finally {
    restoreEnv(saved);
  }
});

test("RapidAPI returns not-found immediately instead of trying fallback credentials", async () => {
  const saved = saveEnv();
  const previousFetch = globalThis.fetch;
  const seenKeys = [];
  process.env.RAPIDAPI_KEY_NEW = "fresh-key";
  process.env.RAPIDAPI_KEY = "existing-key";
  globalThis.fetch = async (_url, init) => {
    seenKeys.push(init.headers["x-rapidapi-key"]);
    return new Response(JSON.stringify({ error: true, status: 404, msg: "id_not_found" }), { status: 404 });
  };
  try {
    assert.deepEqual(await lookupRapidApi("1114917746", "13486"), { kind: "not_found" });
    assert.deepEqual(seenKeys, ["fresh-key"]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(saved);
  }
});
