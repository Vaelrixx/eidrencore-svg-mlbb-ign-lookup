import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + dependency probe for the Railway healthcheck and external
 * monitors. No auth, no DB writes, no secrets in the response.
 * - `status: "ok"` when the app serves and Supabase REST answers.
 * - `status: "degraded"` (still HTTP 200 so the platform keeps serving)
 *   when Supabase is unreachable; monitors alert on the field, not the code.
 */
export async function GET() {
  const started = Date.now();
  let database: "up" | "down" | "unconfigured" = "unconfigured";
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (url && key) {
    try {
      const probe = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
        headers: { apikey: key },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      // Any HTTP answer (even 404 on the root path) proves reachability.
      database = probe.status > 0 ? "up" : "down";
    } catch {
      database = "down";
    }
  }
  return NextResponse.json(
    {
      success: true,
      status: database === "down" ? "degraded" : "ok",
      service: "nexus-mlbb-ign-lookup",
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "unknown",
      database,
      responseMs: Date.now() - started,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
