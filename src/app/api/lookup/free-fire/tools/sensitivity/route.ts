import { NextRequest, NextResponse } from "next/server";
import { sensitivityPreset, sensitivityTiers } from "../../../tools/ff-sensitivity.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Free Fire sensitivity preset generator — pure editorial data, zero
 * upstream dependency. No auth required (no player data, no quota).
 *
 * GET: /api/lookup/free-fire/tools/sensitivity?tier=balanced
 * POST: { tier }
 */
function respond(tier: unknown) {
  const result = sensitivityPreset(typeof tier === "string" ? tier : "");
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, code: "INVALID_INPUT" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      success: true,
      data: {
        tier: result.tier,
        label: result.label,
        values: result.values,
        sliders: result.sliders,
        scale: result.scale,
        notes: result.notes,
        disclaimer: result.disclaimer,
      },
      meta: { source: "eidren_calculator" },
    },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tier = url.searchParams.get("tier");
  if (!tier) {
    return NextResponse.json(
      {
        success: true,
        status: "online",
        message: "Free Fire sensitivity presets. No auth needed.",
        tiers: sensitivityTiers(),
        getExample: "/api/lookup/free-fire/tools/sensitivity?tier=balanced",
        postExample: {
          url: "/api/lookup/free-fire/tools/sensitivity",
          method: "POST",
          body: { tier: "aggressive" },
        },
      },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  }
  return respond(tier);
}
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON.", code: "INVALID_JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { success: false, error: "Send { tier } as a string.", code: "INVALID_INPUT" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  return respond((body as Record<string, unknown>).tier);
}
