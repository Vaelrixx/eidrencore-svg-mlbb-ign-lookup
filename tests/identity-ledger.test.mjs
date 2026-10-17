import test from "node:test";
import assert from "node:assert/strict";
import {
  ledgerPlayerKey,
  readIdentityLedger,
  recordIdentityLedgerHit,
  writeIdentityLedger,
} from "../src/app/api/lookup/identity-ledger.mjs";

const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
};

test("ledger player key is field-order independent", () => {
  assert.equal(
    ledgerPlayerKey({ zoneId: "13486", playerId: "1114917746" }),
    "playerId=1114917746&zoneId=13486",
  );
  assert.equal(ledgerPlayerKey({ tag: "#2PP" }), "tag=#2PP");
});

test("ledger read returns the confirmed nickname row", async () => {
  let captured;
  const row = await readIdentityLedger("eidren_mlbb", "playerId=1&zoneId=2", {
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return Response.json([{ nickname: "Owned", source: "eidren_mlbb" }]);
    },
  });
  assert.equal(row.nickname, "Owned");
  assert.equal(row.source, "eidren_mlbb");
  assert.ok(captured.url.startsWith("https://example.supabase.co/rest/v1/identity_ledger?"));
  assert.ok(captured.url.includes("select=nickname%2Csource%2Cverified_at"));
  assert.equal(captured.init.method, "GET");
});

test("ledger read fails open on miss, misconfig, and database failure", async () => {
  const miss = await readIdentityLedger("eidren_mlbb", "playerId=9&zoneId=9", {
    env: baseEnv,
    fetchImpl: async () => Response.json([]),
  });
  assert.equal(miss, null);
  assert.equal(await readIdentityLedger("eidren_mlbb", "playerId=9&zoneId=9", { env: {} }), null);
  assert.equal(await readIdentityLedger("", "", { env: baseEnv }), null);
  const down = await readIdentityLedger("eidren_mlbb", "playerId=9&zoneId=9", {
    env: baseEnv,
    fetchImpl: async () => { throw new Error("db down"); },
  });
  assert.equal(down, null);
});

test("ledger write calls the atomic upsert and never throws", async () => {
  let captured;
  const ok = await writeIdentityLedger("eidren_mlbb", "playerId=1&zoneId=2", "Owned", "eidren_mlbb", {
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(ok, true);
  assert.equal(captured.url, "https://example.supabase.co/rest/v1/rpc/upsert_identity_ledger");
  assert.deepEqual(captured.body, {
    p_game: "eidren_mlbb",
    p_player_key: "playerId=1&zoneId=2",
    p_nickname: "Owned",
    p_source: "eidren_mlbb",
  });
  assert.equal(await writeIdentityLedger("eidren_mlbb", "k", "n", "s", { env: {} }), false);
  const down = await writeIdentityLedger("eidren_mlbb", "k", "n", "s", {
    env: baseEnv,
    fetchImpl: async () => { throw new Error("db down"); },
  });
  assert.equal(down, false);
});

test("ledger hit counter calls its rpc and never throws", async () => {
  let captured;
  const ok = await recordIdentityLedgerHit("eidren_mlbb", "playerId=1&zoneId=2", {
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(ok, true);
  assert.equal(captured.url, "https://example.supabase.co/rest/v1/rpc/record_identity_ledger_hit");
  assert.deepEqual(captured.body, { p_game: "eidren_mlbb", p_player_key: "playerId=1&zoneId=2" });
  assert.equal(await recordIdentityLedgerHit("eidren_mlbb", "k", { env: {} }), false);
});
