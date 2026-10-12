import test from "node:test";
import assert from "node:assert/strict";
import { lookupWhoPlays } from "../src/app/api/lookup/providers/whoplays.mjs";

test("live WhoPlays contract matches the known-valid fixture nickname", async (t) => {
  if (!process.env.WHOPLAYS_API_KEY?.trim()) {
    t.skip("WhoPlays credentials are not configured for this workflow");
    return;
  }

  const result = await lookupWhoPlays("1114917746", "13486");
  assert.equal(result.kind === "success", true, "WhoPlays did not return a confirmed nickname for the known-valid fixture");
  assert.equal(result.nickname === "Outrageous Dominance", true, "WhoPlays response did not match the expected fixture nickname");
  assert.equal(result.source === "whoplays_check", true, "WhoPlays returned an unexpected provider source");
  // Boolean assertions avoid including actual nicknames or provider data in assertion diffs.
});
