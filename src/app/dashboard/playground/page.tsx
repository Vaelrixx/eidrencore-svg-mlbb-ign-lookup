"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConsoleFrame } from "@/components/console-frame";
import { PlayerLookupTool } from "@/components/player-lookup-tool";
import { IdGameLookupTool } from "@/components/id-game-lookup-tool";
import { SupercellLookupTool } from "@/components/supercell-lookup-tool";
import { SupercellGroupTool } from "@/components/supercell-group-tool";
import { platformTools } from "@/lib/tools";
type GameKey = "mlbb" | "brawl-stars" | "clash-of-clans" | "clash-royale" | "pubg-mobile" | "call-of-duty-mobile" | "valorant" | "genshin-impact" | "honor-of-kings" | "free-fire" | "free-fire-global";
const GAME_TABS: { key: GameKey; label: string }[] = [
  { key: "mlbb", label: "Mobile Legends" },
  { key: "pubg-mobile", label: "PUBG Mobile" },
  { key: "call-of-duty-mobile", label: "Call of Duty Mobile" },
  { key: "valorant", label: "VALORANT" },
  { key: "genshin-impact", label: "Genshin Impact" },
  { key: "honor-of-kings", label: "Honor of Kings" },
  { key: "free-fire", label: "Free Fire" },
  { key: "free-fire-global", label: "Free Fire Global" },
  { key: "brawl-stars", label: "Brawl Stars" },
  { key: "clash-of-clans", label: "Clash of Clans" },
  { key: "clash-royale", label: "Clash Royale" },
];

function gameFromParam(value: string | null): GameKey {
  if (value && GAME_TABS.some((tab) => tab.key === value)) return value as GameKey;
  return "mlbb";
}

function PlaygroundContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const game = gameFromParam(searchParams.get("game"));
  const planned = platformTools.filter((t) => t.status === "planned");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/billing/me", { cache: "no-store", signal: controller.signal }).then((response) => {
      if (response.status === 401) router.replace("/login?next=/dashboard/playground");
    }).catch(() => {});
    return () => controller.abort();
  }, [router]);

  function selectGame(next: GameKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "mlbb") params.delete("game");
    else params.set("game", next);
    const query = params.toString();
    router.replace(query ? `/dashboard/playground?${query}` : "/dashboard/playground");
  }

  return <ConsoleFrame>
    <section className="console-panel">
      <div className="console-panel-heading"><div><h2>Player lookup</h2><p>Run a live request and inspect the raw response. Your API keys use the same endpoints.</p></div></div>
      <div className="pg-game-tabs" role="tablist" aria-label="Game">
        {GAME_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={game === tab.key}
            className={game === tab.key ? "pg-game-tab is-active" : "pg-game-tab"}
            onClick={() => selectGame(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {game === "mlbb"
        ? <PlayerLookupTool />
        : game === "brawl-stars" || game === "clash-of-clans" || game === "clash-royale"
          ? <SupercellLookupTool game={game} />
          : <IdGameLookupTool key={game} game={game} />}
    </section>
    {(game === "brawl-stars" || game === "clash-of-clans" || game === "clash-royale") && (
      <section className="console-panel">
        <div className="console-panel-heading"><div><h2>{game === "brawl-stars" ? "Clubs, battles & rankings" : "Clans, battles & rankings"}</h2><p>Group identity, recent history, and leaderboards for the selected game.</p></div></div>
        <SupercellGroupTool game={game} />
      </section>
    )}
    {planned.length > 0 && <section className="console-panel">
      <div className="console-panel-heading"><div><h2>More tools</h2><p>These games are planned. They will appear here as they ship.</p></div></div>
      <div className="pg-planned">{planned.map((t) => <div key={t.id} className="pg-planned-item"><b>{t.game}</b><small>{t.name} · Planned</small></div>)}</div>
    </section>}
  </ConsoleFrame>;
}

export default function DashboardPlaygroundPage() {
  return <Suspense><PlaygroundContent /></Suspense>;
}
