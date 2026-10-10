import test from "node:test";
import assert from "node:assert/strict";
import { persistLookupLog } from "../src/app/api/lookup/persistence.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
};

test("log insert tolerates cross-region latency by default", async () => {
  const result = await persistLookupLog({ status: "success", responseMs: 5 }, {
    env,
    fetchImpl: async (_url, init) => {
      // Simulates a Railway (iad) -> Supabase (Tokyo) round trip slower than 300 ms.
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (init.signal.aborted) throw new Error("aborted");
      return new Response(null, { status: 201 });
    },
  });
  assert.equal(result.persisted, true);
});

test("an explicit shorter timeout still aborts a slow insert", async () => {
  const result = await persistLookupLog({ status: "success", responseMs: 5 }, {
    env,
    timeoutMs: 100,
    fetchImpl: async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (init.signal.aborted) throw new Error("aborted");
      return new Response(null, { status: 201 });
    },
  });
  assert.equal(result.persisted, false);
});
