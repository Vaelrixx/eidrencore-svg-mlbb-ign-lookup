import { NextRequest, NextResponse } from "next/server";
import { datasetMeta, listHeroes, searchHeroes } from "../../tools/mlbb-heroes.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MLBB hero list from our OWN vendored dataset — no upstream, no key, no
 * auth required. Optional `?q=` substring search.
 * Unofficial fan data, not affiliated with Moonton.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const heroes = query ? searchHeroes(query) : listHeroes();
  return NextResponse.json(
    {
      success: true,
      data: { heroes, count: heroes.length, attribution: datasetMeta().attribution },
      meta: { source: "eidren_hero_dataset" },
    },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
