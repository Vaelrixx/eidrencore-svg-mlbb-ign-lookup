import test from "node:test";
import assert from "node:assert/strict";
import { lookupRapidApi } from "../src/app/api/lookup/providers/rapidapi.mjs";

test("live RapidAPI contract matches the known-valid fixture nickname", async (t) => {
  if (!(process.env.RAPIDAPI_KEY?.trim() || process.env.RAPIDAPI_APP_TOKEN?.trim())) {
    t.skip("RapidAPI credentials are not configured for this workflow");
    return;
  }

  const result = await lookupRapidApi("1114917746", "13486");
  assert.equal(result.kind === "success", true, "RapidAPI did not return a confirmed nickname for the known-valid fixture");
  assert.equal(result.nickname === "Outrageous Dominance", true, "RapidAPI response did not match the expected fixture nickname");
  assert.equal(result.source === "rapidapi_id_game_checker", true, "RapidAPI returned an unexpected provider source");
  // Boolean assertions avoid including actual nicknames or provider data in assertion diffs.
});
