import { NextRequest, NextResponse } from "next/server";
import { datasetMeta, filterWeapons, listWeapons, searchWeapons } from "../../tools/ff-weapons.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Free Fire weapon reference from our OWN curated dataset — no upstream,
 * no key, no auth required. Optional `?q=` name search, `?class=` and
 * `?ammo=` filters.
 * Unofficial fan data, not affiliated with Garena.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const weaponClass = url.searchParams.get("class");
  const ammo = url.searchParams.get("ammo");
  const weapons = query
    ? searchWeapons(query)
    : weaponClass || ammo
      ? filterWeapons({ ...(weaponClass ? { class: weaponClass } : {}), ...(ammo ? { ammo } : {}) })
      : listWeapons();
  return NextResponse.json(
    {
      success: true,
      data: { weapons, count: weapons.length, attribution: datasetMeta().attribution },
      meta: { source: "eidren_weapon_dataset" },
    },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
