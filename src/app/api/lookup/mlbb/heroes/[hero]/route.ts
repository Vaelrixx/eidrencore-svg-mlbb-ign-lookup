import { NextRequest, NextResponse } from "next/server";
import { datasetMeta, heroDetail } from "../../../tools/mlbb-heroes.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MLBB hero detail (counters, strong-against, teammates) from our OWN
 * vendored dataset — no upstream, no key, no auth required.
 * `/api/lookup/mlbb/heroes/miya` or `/api/lookup/mlbb/heroes/1`.
 * Unofficial fan data, not affiliated with Moonton.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hero: string }> },
) {
  const { hero } = await params;
  const detail = heroDetail(hero);
  if (!detail) {
    return NextResponse.json(
      { success: false, error: `No MLBB hero matches "${hero}".`, code: "MLBB_HERO_NOT_FOUND" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      success: true,
      data: { ...detail, attribution: datasetMeta().attribution },
      meta: { source: "eidren_hero_dataset" },
    },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
