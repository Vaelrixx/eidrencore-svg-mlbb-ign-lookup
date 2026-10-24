import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bulkGameSlugs, BULK_GAMES } from "../bulk-games.mjs";
import { normalizeHealthSource } from "../health-source.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MINUTES = 60;
const MIN_SAMPLES = 3;

type LogRow = { status: string; source: string; failure_reason: string | null };

/**
 * Public per-game health rollup from the last hour of lookup logs.
 * No authentication: it exposes only aggregate counts per game, never
 * player IDs, nicknames, or customer data.
 */
export async function GET() {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  let rows: LogRow[];
  try {
    const { data, error } = await createAdminClient()
      .from("lookup_logs")
      .select("status,source,failure_reason")
      .gte("created_at", since)
      .limit(5000);
    if (error) throw error;
    rows = (data || []) as LogRow[];
  } catch {
    return NextResponse.json(
      { success: false, error: "Game status is temporarily unavailable.", code: "STATUS_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const bySource = new Map<string, { total: number; errors: number; quotaExhausted: number }>();
  for (const row of rows) {
    const source = normalizeHealthSource(row.source);
    const bucket = bySource.get(source) || { total: 0, errors: 0, quotaExhausted: 0 };
    bucket.total += 1;
    // Daily-quota exhaustion is a degraded-fallback signal, not a game
    // outage: count it separately and keep it out of the error rate.
    if (row.status === "rate_limited" && row.failure_reason === "quota_exhausted") {
      bucket.quotaExhausted += 1;
    } else if (row.status === "upstream_error" || row.status === "rate_limited") {
      bucket.errors += 1;
    }
    bySource.set(source, bucket);
  }

  const games: Record<string, { status: "operational" | "degraded" | "unknown"; checks: number; errorRate: number | null; quotaExhausted: boolean; quotaExhaustedChecks: number }> = {};
  for (const slug of bulkGameSlugs()) {
    const entry = BULK_GAMES[slug as keyof typeof BULK_GAMES] as { publicSource: string };
    const bucket = bySource.get(entry.publicSource) || { total: 0, errors: 0, quotaExhausted: 0 };
    if (bucket.total < MIN_SAMPLES) {
      games[slug] = { status: "unknown", checks: bucket.total, errorRate: null, quotaExhausted: bucket.quotaExhausted > 0, quotaExhaustedChecks: bucket.quotaExhausted };
      continue;
    }
    const errorRate = bucket.errors / bucket.total;
    games[slug] = {
      status: errorRate >= 0.5 ? "degraded" : "operational",
      checks: bucket.total,
      errorRate: Math.round(errorRate * 1000) / 1000,
      quotaExhausted: bucket.quotaExhausted > 0,
      quotaExhaustedChecks: bucket.quotaExhausted,
    };
  }

  return NextResponse.json(
    { success: true, windowMinutes: WINDOW_MINUTES, games },
    { headers: { "Cache-Control": "no-store" } },
  );
}
