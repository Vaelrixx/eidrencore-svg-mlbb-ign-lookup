import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// TEMPORARY diagnostic route for WI-009. Bearer-gated, fixed targets only,
// redacted shape-only output. Remove immediately after the final probe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAPIDAPI_HOST = "id-game-checker.p.rapidapi.com";
// Targets: the two previously-probed samples plus provider-documented
// alternates (neferbyte.com/docs): a second HoK example ID and the same
// Genshin UID on the other documented servers.
const TARGETS = Object.freeze([
  Object.freeze({ label: "genshin-asia", path: "/genshin/844335555/asia" }),
  Object.freeze({ label: "genshin-america", path: "/genshin/844335555/america" }),
  Object.freeze({ label: "genshin-europa", path: "/genshin/844335555/europa" }),
  Object.freeze({ label: "genshin-china", path: "/genshin/844335555/china" }),
  Object.freeze({ label: "hok-docs-sample", path: "/honor-of-kings/17960996468644334000" }),
  Object.freeze({ label: "hok-alt-sample", path: "/honor-of-kings/17960996468644334037" }),
]);

function authorized(request: Request) {
  const secret = process.env.PROBE_BEARER;
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secret || !supplied) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function redactedText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 120) : "";
}

function describeValue(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === "string") return `string:len=${value.length}:empty=${value.length === 0 ? "yes" : "no"}`;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return `boolean:${value}`;
  if (typeof value === "object") {
    return `object:keys=[${Object.keys(value as Record<string, unknown>).sort().join(",")}]`;
  }
  return typeof value;
}

function describeNode(node: unknown): unknown {
  if (node === null) return "null";
  if (Array.isArray(node)) return `array[${node.length}]`;
  if (typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      out[key] = describeValue((node as Record<string, unknown>)[key]);
    }
    return out;
  }
  return typeof node;
}

export async function POST(request: Request) {
  if (!process.env.PROBE_BEARER) {
    return NextResponse.json({ error: "Probe is not configured." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const apiKey = process.env.RAPIDAPI_KEY?.trim() || process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (!apiKey) return NextResponse.json({ error: "Upstream key is not configured." }, { status: 503 });

  const results = [];
  for (const target of TARGETS) {
    try {
      const upstream = await fetch(`https://${RAPIDAPI_HOST}${target.path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-rapidapi-host": RAPIDAPI_HOST,
          "x-rapidapi-key": apiKey,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const payload: unknown = await upstream.json().catch(() => null);
      const root = payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
      results.push({
        label: target.label,
        http: upstream.status,
        top: payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).sort() : typeof payload,
        error: root?.error ?? "absent",
        success: root?.success ?? "absent",
        valid: root?.valid ?? "absent",
        ok: root?.ok ?? "absent",
        statusField: typeof root?.status === "number" || typeof root?.status === "boolean"
          ? root.status
          : typeof root?.status === "string"
            ? `string:len=${root.status.length}`
            : (root?.status === null ? "null" : typeof root?.status),
        msg: redactedText(root?.msg),
        message: redactedText(root?.message),
        reason: redactedText(root?.reason),
        code: typeof root?.code === "string" ? redactedText(root.code) : (root?.code ?? "absent"),
        data: describeNode(root?.data),
        result: describeNode(root?.result),
      });
    } catch (error) {
      results.push({ label: target.label, error: `fetch_failed:${error instanceof Error ? error.name : "unknown"}` });
    }
  }
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
