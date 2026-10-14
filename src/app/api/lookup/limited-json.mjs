export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function parseBoundedJson(request, maxBytes = 4096) {
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 4096;
  const declaredLength = request.headers?.get?.("content-length");
  if (typeof declaredLength === "string" && /^\d+$/.test(declaredLength) && Number(declaredLength) > limit) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader?.();
  if (!reader) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new RequestBodyTooLargeError();
    return JSON.parse(text);
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled or errored stream may already have released its lock.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
