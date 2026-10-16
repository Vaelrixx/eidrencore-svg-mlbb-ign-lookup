import { NextResponse } from "next/server";
import { supercellConfigFor } from "../providers/supercell.mjs";
import { supercellBasesFor } from "../providers/supercell-fallback.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAMES = [
  { id: "brawl-stars", label: "Brawl Stars" },
  { id: "clash-of-clans", label: "Clash of Clans" },
  { id: "clash-royale", label: "Clash Royale" },
] as const;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}

/**
 * Operator health for the Supercell provider chain. Reports per-game key
 * presence and the resolved primary/secondary hosts WITHOUT performing
 * upstream network I/O and WITHOUT exposing keys or full URLs.
 *
 * Public on purpose (no secrets in the response): safe behind the Vercel
 * rewrite and the Railway API-only gate, and useful for uptime monitors.
 */
export async function GET() {
  const games = GAMES.map(({ id, label }) => {
    const config = supercellConfigFor(id);
    const bases = supercellBasesFor(id) ?? [];
    return {
      game: id,
      label,
      keyConfigured: Boolean(config?.key),
      primary: bases[0] ? hostOf(bases[0]) : null,
      secondary: bases[1] ? hostOf(bases[1]) : null,
    };
  });
  const allConfigured = games.every((game) => game.keyConfigured);
  return NextResponse.json(
    {
      success: true,
      data: {
        status: allConfigured ? "ready" : "degraded",
        games,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
