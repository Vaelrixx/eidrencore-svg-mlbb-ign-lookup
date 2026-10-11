/**
 * Copy-paste Next.js App Router example: proxy a Supercell lookup through
 * your own backend so the Eidren API key never reaches the browser.
 *
 * Drop into your app as e.g. app/api/player/route.ts, set EIDREN_API_KEY,
 * then call: GET /api/player?game=brawl-stars&tag=%232PP
 */
import { NextResponse } from "next/server";
import {
  createEidrenClient,
  EidrenApiError,
  type SupercellGame,
} from "./eidren-client";

const GAMES: SupercellGame[] = ["brawl-stars", "clash-of-clans", "clash-royale"];

export async function GET(request: Request) {
  const apiKey = process.env.EIDREN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Server is missing its Eidren API key." },
      { status: 500 },
    );
  }
  const { searchParams } = new URL(request.url);
  const game = searchParams.get("game");
  const tag = (searchParams.get("tag") ?? "").trim();
  if (!game || !(GAMES as string[]).includes(game)) {
    return NextResponse.json(
      { success: false, error: "Pick a game: brawl-stars, clash-of-clans, clash-royale." },
      { status: 400 },
    );
  }
  if (!tag) {
    return NextResponse.json(
      { success: false, error: "Pass a player tag, e.g. ?tag=%232PP." },
      { status: 400 },
    );
  }

  try {
    const eidren = createEidrenClient(apiKey);
    const result = await eidren.lookupSupercell(game as SupercellGame, tag);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof EidrenApiError) {
      // Pass through Eidren's status and code; never leak the API key.
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        {
          status: error.status,
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        },
      );
    }
    return NextResponse.json(
      { success: false, error: "Lookup failed." },
      { status: 500 },
    );
  }
}
