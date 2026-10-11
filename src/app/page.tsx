import Link from "next/link";
import { Activity, ArrowRight, Building2, CreditCard, KeyRound, LayoutDashboard, ScrollText, Terminal, Webhook, Zap } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { platformTools } from "@/lib/tools";

const platform = [
  { icon: KeyRound, title: "API keys", body: "Create and revoke keys. Secrets are hashed at rest and shown once." },
  { icon: Activity, title: "Usage & analytics", body: "Watch quota and request volume per key, per day." },
  { icon: Webhook, title: "Webhooks", body: "Signed event notifications delivered to your own endpoints." },
  { icon: Building2, title: "Workspaces", body: "Invite teammates and control who can manage keys and billing." },
  { icon: ScrollText, title: "Logs & audit", body: "A readable trail of API activity and account changes." },
  { icon: CreditCard, title: "Billing & plans", body: "Start free, upgrade when you need more requests." },
];

const steps = [
  { n: "01", title: "Create a free account", body: "Sign up with email, Google, GitHub, Discord or Telegram. Your free plan is ready instantly." },
  { n: "02", title: "Try the playground", body: "Run live lookups and see the exact request and response before you write any code." },
  { n: "03", title: "Ship with an API key", body: "Create a key, call the API from your app and watch usage in the dashboard." },
];

const bars = [38, 52, 44, 66, 58, 82, 74, 96, 88, 70, 92, 80];

export default function Home() {
  return (
    <SiteShell>
      <section className="x-hero lp-hero">
        <div className="x-hero-copy">
          <span className="x-chip"><i className="x-chip-dot" /> PLAYER IDENTITY PLATFORM</span>
          <h1>Player identity, <span>as an API.</span></h1>
          <p className="x-lede">Resolve in-game names today, with more games and tools on the way. Create a free account, try it in the playground, then ship it with an API key.</p>
          <div className="lp-cta">
            <Link href="/login?mode=signup" className="x-submit lp-cta-main">Create free account <ArrowRight size={18} /></Link>
            <Link href="/playground" className="lp-cta-ghost">Open the playground</Link>
          </div>
          <ul className="lp-points"><li><Zap size={15} /> Free plan, no card</li><li><KeyRound size={15} /> Hashed API keys</li><li><Activity size={15} /> Usage dashboard</li></ul>
        </div>

        <div className="lp-preview" aria-label="Illustrative console preview">
          <span className="lp-preview-tag">ILLUSTRATIVE PREVIEW</span>
          <div className="lp-window">
            <aside className="lp-side" aria-hidden="true">
              <span className="lp-dot lp-dot-on" /><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" />
            </aside>
            <div className="lp-main">
              <div className="lp-row"><LayoutDashboard size={16} /><strong>Overview</strong><i className="lp-pill">Free plan</i></div>
              <div className="lp-stats">
                <div><small>REQUESTS</small><b className="lp-skel" /></div>
                <div><small>ACTIVE KEYS</small><b className="lp-skel" /></div>
                <div><small>QUOTA</small><b className="lp-skel" /></div>
              </div>
              <div className="lp-chart" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
              <div className="lp-code"><Terminal size={14} /><code>POST /api/lookup</code><i className="lp-pill lp-pill-ok">200</i></div>
            </div>
          </div>
        </div>
      </section>

      <section className="x-section" id="tools" aria-labelledby="tools-title">
        <div className="x-section-head"><span className="x-eyebrow">TOOLS</span><h2 id="tools-title">One platform. More tools coming.</h2><p>Every tool shares the same keys, usage and billing. New games land here as they ship.</p></div>
        <div className="lp-tools">
          {platformTools.map((t) => {
            const live = t.status === "live" && t.href;
            const body = (
              <>
                <div className="lp-tool-top"><span className="lp-tool-game">{t.game}</span><span className={`lp-status${live ? " is-live" : ""}`}>{live ? "LIVE" : "PLANNED"}</span></div>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                {live && <span className="lp-tool-link">Open in playground <ArrowRight size={15} /></span>}
              </>
            );
            return live
              ? <Link key={t.id} href={t.href!} className="lp-tool is-live">{body}</Link>
              : <article key={t.id} className="lp-tool">{body}</article>;
          })}
        </div>
      </section>

      <section className="x-section" id="platform" aria-labelledby="platform-title">
        <div className="x-section-head"><span className="x-eyebrow">PLATFORM</span><h2 id="platform-title">Everything around the API, built in.</h2></div>
        <div className="x-features">
          {platform.map((f) => { const Icon = f.icon; return <article className="x-feature" key={f.title}><span className="x-feature-icon"><Icon size={22} /></span><h3>{f.title}</h3><p>{f.body}</p></article>; })}
        </div>
      </section>

      <section className="x-section" aria-labelledby="steps-title">
        <div className="x-section-head"><span className="x-eyebrow">GET STARTED</span><h2 id="steps-title">From first lookup to production.</h2></div>
        <ol className="x-steps">
          {steps.map((s) => <li className="x-step" key={s.n}><span className="x-step-n">{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>)}
        </ol>
      </section>

      <section className="x-dev" id="developers" aria-labelledby="dev-title">
        <div className="x-dev-copy">
          <span className="x-eyebrow">FOR DEVELOPERS</span>
          <h2 id="dev-title">One request. One honest answer.</h2>
          <p>A confirmed not-found is never mixed up with the provider being unavailable, so your users are never told a real account is invalid.</p>
          <div className="lp-cta"><Link href="/dashboard/docs" className="x-submit lp-cta-main">Read the API reference <ArrowRight size={17} /></Link></div>
        </div>
        <pre className="x-code" aria-label="Example request"><code>{`curl -X POST /api/lookup \\
  -H "Authorization: Bearer YOUR_EIDREN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"playerId":"123456789","zoneId":"1234"}'`}</code></pre>
      </section>
    </SiteShell>
  );
}
