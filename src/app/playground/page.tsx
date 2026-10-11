import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { PlayerLookupTool } from "@/components/player-lookup-tool";
import { platformTools } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Playground · EIDREN",
  description: "Try Eidren tools live: resolve a Mobile Legends player name from a Player ID and Zone ID.",
};

export default function PlaygroundPage() {
  return (
    <SiteShell>
      <section className="pg-head">
        <span className="x-chip"><i className="x-chip-dot" /> PLAYGROUND</span>
        <h1>Try it <span>live.</span></h1>
        <p className="x-lede">Run real requests against Eidren tools and see the exact response. No account needed.</p>
      </section>
      <section className="pg-layout">
        <aside className="pg-tools" aria-label="Tools">
          <div className="pg-tools-label">TOOLS</div>
          {platformTools.map((t) => t.status === "live"
            ? <span key={t.id} className="pg-tool-item is-active" aria-current="true"><b>{t.game}</b><small>{t.name}</small></span>
            : <span key={t.id} className="pg-tool-item is-planned"><b>{t.game}</b><small>Planned</small></span>)}
        </aside>
        <div className="pg-stage"><PlayerLookupTool /></div>
      </section>
      <section className="lp-banner">
        <div><h2>Ready to build with it?</h2><p>Create an API key and call the same endpoint from your app.</p></div>
        <Link href="/login" className="x-submit lp-cta-main">Get started <ArrowRight size={17} /></Link>
      </section>
    </SiteShell>
  );
}
