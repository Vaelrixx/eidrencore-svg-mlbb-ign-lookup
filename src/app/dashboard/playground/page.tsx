"use client";

import { ConsoleFrame } from "@/components/console-frame";
import { PlayerLookupTool } from "@/components/player-lookup-tool";
import { platformTools } from "@/lib/tools";

export default function DashboardPlaygroundPage() {
  const planned = platformTools.filter((t) => t.status === "planned");
  return <ConsoleFrame>
    <section className="console-panel">
      <div className="console-panel-heading"><div><h2>Player lookup</h2><p>Run a live request and inspect the raw response. Your API keys use the same endpoint.</p></div></div>
      <PlayerLookupTool />
    </section>
    <section className="console-panel">
      <div className="console-panel-heading"><div><h2>More tools</h2><p>These games are planned. They will appear here as they ship.</p></div></div>
      <div className="pg-planned">{planned.map((t) => <div key={t.id} className="pg-planned-item"><b>{t.game}</b><small>{t.name} · Planned</small></div>)}</div>
    </section>
  </ConsoleFrame>;
}
