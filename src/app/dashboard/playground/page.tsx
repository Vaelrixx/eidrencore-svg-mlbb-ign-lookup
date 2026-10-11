"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConsoleFrame } from "@/components/console-frame";
import { PlayerLookupTool } from "@/components/player-lookup-tool";
import { SupercellLookupTool } from "@/components/supercell-lookup-tool";
import { platformTools } from "@/lib/tools";

type GameKey = "mlbb" | "brawl-stars" | "clash-of-clans" | "clash-royale";

const GAME_TABS: { key: GameKey; label: string }[] = [
  { key: "mlbb", label: "Mobile Legends" },
  { key: "brawl-stars", label: "Brawl Stars" },
  { key: "clash-of-clans", label: "Clash of Clans" },
  { key: "clash-royale", label: "Clash Royale" },
];

function gameFromParam(value: string | null): GameKey {
  if (value === "brawl-stars" || value === "clash-of-clans" || value === "clash-royale") return value;
  return "mlbb";
}

function PlaygroundContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const game = gameFromParam(searchParams.get("game"));
  const planned = platformTools.filter((t) => t.status === "planned");
  useEffect(() => {
    fetch("/api/billing/me", { cache: "no-store" }).then((response) => {
      if (response.status === 401) router.replace("/login?next=/dashboard/playground");
    }).catch(() => {});
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
      {game === "mlbb" ? <PlayerLookupTool /> : <SupercellLookupTool game={game} />}
    </section>
    <section className="console-panel">
      <div className="console-panel-heading"><div><h2>More tools</h2><p>These games are planned. They will appear here as they ship.</p></div></div>
      <div className="pg-planned">{planned.map((t) => <div key={t.id} className="pg-planned-item"><b>{t.game}</b><small>{t.name} · Planned</small></div>)}</div>
    </section>
  </ConsoleFrame>;
}

export default function DashboardPlaygroundPage() {
  return <Suspense><PlaygroundContent /></Suspense>;
}
