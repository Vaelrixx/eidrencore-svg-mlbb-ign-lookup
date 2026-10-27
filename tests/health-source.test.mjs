import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHealthSource } from "../src/app/api/lookup/health-source.mjs";

test("maps single-lookup MLBB logs into the canonical MLBB health bucket", () => {
  assert.equal(normalizeHealthSource("mlbb_lookup_api"), "eidren_mlbb");
});

test("maps legacy delta-force logs into the live Garena health bucket", () => {
  assert.equal(normalizeHealthSource("eidren_delta_force"), "eidren_delta_force_garena");
});

test("leaves other health source labels unchanged", () => {
  assert.equal(normalizeHealthSource("eidren_pubg_mobile"), "eidren_pubg_mobile");
});
