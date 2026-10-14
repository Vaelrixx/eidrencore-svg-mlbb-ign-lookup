import test from "node:test";
import assert from "node:assert/strict";
import { parseBoundedJson, RequestBodyTooLargeError } from "../src/app/api/lookup/limited-json.mjs";

const encoder = new TextEncoder();

function makeRequest(body, headers = new Headers()) {
  return {
    headers,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
  };
}

test("parses a valid small JSON request body", async () => {
  const request = makeRequest('{"playerId":"8370310025568788000"}');
  assert.deepEqual(await parseBoundedJson(request, 4096), { playerId: "8370310025568788000" });
});

test("rejects a declared oversized body before reading it", async () => {
  const headers = new Headers({ "content-length": "4097" });
  let readerRequested = false;
  const request = {
    headers,
    body: {
      getReader() {
        readerRequested = true;
        throw new Error("body reader should not be acquired");
      },
    },
  };
  await assert.rejects(parseBoundedJson(request, 4096), RequestBodyTooLargeError);
  assert.equal(readerRequested, false);
});

test("rejects and cancels an oversized streamed body without buffering the remainder", async () => {
  let cancelled = false;
  const request = {
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(4097)));
      },
      cancel() {
        cancelled = true;
      },
    }),
  };
  await assert.rejects(parseBoundedJson(request, 4096), RequestBodyTooLargeError);
  assert.equal(cancelled, true);
});

test("rejects malformed JSON after enforcing the bounded read", async () => {
  await assert.rejects(parseBoundedJson(makeRequest("not-json"), 4096), SyntaxError);
});
