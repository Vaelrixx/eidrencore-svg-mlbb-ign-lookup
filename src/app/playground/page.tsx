import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, KeyRound, Lock, LogIn, ShieldCheck, Sparkles } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { PlayerLookupTool } from "@/components/player-lookup-tool";
import { getSessionUser } from "@/lib/session";
import { platformTools } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Playground · EIDREN",
  description: "Sign in to try Eidren tools live: resolve a Mobile Legends player name from a Player ID and Zone ID.",
};

export default async function PlaygroundPage() {
  const user = await getSessionUser();

  return (
    <SiteShell>
      <section className="pg-head">
        <span className="x-chip"><i className="x-chip-dot" /> PLAYGROUND</span>
        <h1>Try it <span>live.</span></h1>
        <p className="x-lede">
          {user
            ? "Run real requests against Eidren tools and see the exact response."
            : "Every tool runs on your Eidren account. Create a free one to start running lookups."}
        </p>
      </section>
      <section className="pg-layout">
        <aside className="pg-tools" aria-label="Tools">
          <div className="pg-tools-label">TOOLS</div>
          {platformTools.map((t) => t.status === "live"
            ? <span key={t.id} className="pg-tool-item is-active" aria-current="true"><b>{t.game}</b><small>{t.name}</small></span>
            : <span key={t.id} className="pg-tool-item is-planned"><b>{t.game}</b><small>Planned</small></span>)}
        </aside>
        <div className="pg-stage">
          {user ? <PlayerLookupTool /> : (
            <div className="pg-gate">
              <span className="pg-gate-icon"><Lock size={24} /></span>
              <h2>Sign in to use the playground</h2>
              <p>Create a free account to run live lookups here and get an API key for your own app. No card needed.</p>
              <ul className="pg-gate-points">
                <li><Sparkles size={15} /> Free plan activated at sign-up</li>
                <li><KeyRound size={15} /> Create API keys from your console</li>
                <li><ShieldCheck size={15} /> Email, Google, GitHub, Discord or Telegram</li>
              </ul>
              <div className="lp-cta">
                <Link href="/login?mode=signup&next=/playground" className="x-submit lp-cta-main">Create free account <ArrowRight size={17} /></Link>
                <Link href="/login?next=/playground" className="lp-cta-ghost"><LogIn size={15} /> Sign in</Link>
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="lp-banner">
        <div><h2>Ready to build with it?</h2><p>Create an API key and call the same endpoint from your app.</p></div>
        <Link href={user ? "/dashboard/keys" : "/login?mode=signup"} className="x-submit lp-cta-main">{user ? "Manage API keys" : "Get started"} <ArrowRight size={17} /></Link>
      </section>
    </SiteShell>
  );
}
