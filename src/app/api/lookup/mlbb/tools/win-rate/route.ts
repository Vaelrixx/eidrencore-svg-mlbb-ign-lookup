import { NextRequest, NextResponse } from "next/server";
import { calculateWinRate } from "../../../tools/win-rate.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MLBB win-rate target calculator — pure math, zero upstream dependency.
 * No auth required (no player data, no quota to protect, no secrets).
 *
 * GET: /api/lookup/mlbb/tools/win-rate?matches=500&winRate=52&targets=55,60&floors=50
 * POST: { matches, winRate, targets?, floors? }
 */
function parseNumbers(value: string | null): number[] | undefined {
  if (value === null || value === "") return undefined;
  return value.split(",").map((part) => Number(part.trim())).filter((num) => Number.isFinite(num));
}

function respond(matches: unknown, winRate: unknown, targets?: unknown, floors?: unknown) {
  const matchCount = typeof matches === "number" ? matches : Number(matches);
  const rate = typeof winRate === "number" ? winRate : Number(winRate);
  const targetList = Array.isArray(targets) ? targets.filter((t): t is number => typeof t === "number") : undefined;
  const floorList = Array.isArray(floors) ? floors.filter((f): f is number => typeof f === "number") : undefined;
  const result = calculateWinRate(matchCount, rate, {
    ...(targetList ? { targets: targetList } : {}),
    ...(floorList ? { floors: floorList } : {}),
  });
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
        matches: result.matches,
        winRate: result.winRate,
        currentWins: result.currentWins,
        currentLosses: result.currentLosses,
        targets: result.targets,
        floors: result.floors,
      },
      meta: { source: "eidren_calculator" },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (!url.searchParams.has("matches")) {
    return NextResponse.json(
      {
        success: true,
        status: "online",
        message: "MLBB win-rate calculator. No auth needed.",
        getExample: "/api/lookup/mlbb/tools/win-rate?matches=500&winRate=52&targets=55,60,70&floors=50,45",
        postExample: {
          url: "/api/lookup/mlbb/tools/win-rate",
          method: "POST",
          body: { matches: 500, winRate: 52, targets: [55, 60, 70], floors: [50, 45] },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return respond(
    url.searchParams.get("matches"),
    url.searchParams.get("winRate"),
    parseNumbers(url.searchParams.get("targets")),
    parseNumbers(url.searchParams.get("floors")),
  );
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
      { success: false, error: "Send { matches, winRate } as numbers.", code: "INVALID_INPUT" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { matches, winRate, targets, floors } = body as Record<string, unknown>;
  return respond(matches, winRate, targets, floors);
}
