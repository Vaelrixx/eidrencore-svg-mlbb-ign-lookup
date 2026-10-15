import Link from "next/link";
import { Activity, ArrowRight, Building2, Check, CreditCard, KeyRound, LayoutDashboard, ScrollText, Terminal, Webhook, Zap } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { platformTools } from "@/lib/tools";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_FALLBACKS } from "@/lib/platform";
import { resolveRailwayBackendOrigin } from "@/lib/deployment-routing.mjs";

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

const faqs = [
  { q: "Do I need an account?", a: "Yes. Every lookup runs on your Eidren account, either from the console playground or with an API key. Sign-up is free and takes a minute." },
  { q: "What counts as a request?", a: "Each lookup call counts once against your monthly allowance, whether it comes from the playground or from your API key." },
  { q: "Is this official?", a: "No. Eidren is an independent identity platform and is not affiliated with Moonton, Supercell, or any game publisher. Our network clearly separates a confirmed not-found from a temporary outage." },
  { q: "Which games are supported?", a: "Nine game lookups are live: Mobile Legends, PUBG Mobile Global, Call of Duty: Mobile (Garena), VALORANT, Genshin Impact, Honor of Kings, Brawl Stars, Clash of Clans, and Clash Royale. They use the same Eidren API keys and billing." },
];

type PlanRow = { slug: string; name: string; price_paise: number; monthly_limit: number; enabled: boolean; description: string };
async function loadPlans(): Promise<PlanRow[]> {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) {
    const backendOrigin = resolveRailwayBackendOrigin(process.env.RAILWAY_BACKEND_ORIGIN);
    if (!backendOrigin) return PLAN_FALLBACKS;
    try {
      const response = await fetch(`${backendOrigin}/api/billing/plans`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return PLAN_FALLBACKS;
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "plans" in body && Array.isArray(body.plans) && body.plans.length) {
        return body.plans as PlanRow[];
      }
    } catch {
      // Keep the public landing page available during a backend outage.
    }
    return PLAN_FALLBACKS;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("developer_plans").select("slug,name,price_paise,monthly_limit,enabled,description").order("monthly_limit");
    if (!error && data?.length) return data as PlanRow[];
  } catch { /* fall back to the built-in plan list */ }
  return PLAN_FALLBACKS;
}
const price = (paise: number) => paise === 0 ? "Free" : `${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100)}/mo`;

const bars = [38, 52, 44, 66, 58, 82, 74, 96, 88, 70, 92, 80];

export default async function Home() {
  const plans = await loadPlans();
  return (
    <SiteShell>
      <section className="x-hero lp-hero">
        <div className="x-hero-copy">
          <span className="x-chip"><i className="x-chip-dot" /> PLAYER IDENTITY PLATFORM</span>
          <h1>Player identity, <span>as an API.</span></h1>
          <p className="x-lede">Resolve in-game names today, with more games and tools on the way. Create a free account, try it in the playground, then ship it with an API key.</p>
          <div className="lp-cta">
            <Link href="/login?mode=signup" className="x-submit lp-cta-main">Create free account <ArrowRight size={18} /></Link>
            <Link href="/login" className="lp-cta-ghost">Sign in</Link>
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
                {live && <span className="lp-tool-link">Get access <ArrowRight size={15} /></span>}
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

      <section className="x-section" id="pricing" aria-labelledby="pricing-title">
        <div className="x-section-head"><span className="x-eyebrow">PRICING</span><h2 id="pricing-title">Start free. Grow when you need to.</h2><p>Plans share the same keys and console. Paid tiers switch on as billing goes live.</p></div>
        <div className="lp-plans">
          {plans.map((plan) => {
            const free = plan.slug === "free";
            const open = free || plan.enabled;
            return (
              <article key={plan.slug} className={`lp-plan${free ? " is-featured" : ""}`}>
                {free && <span className="lp-plan-tag">START HERE</span>}
                <h3>{plan.name}</h3>
                <div className="lp-plan-price">{open ? price(plan.price_paise) : "Coming soon"}</div>
                <p>{plan.description}</p>
                <ul>
                  <li><Check size={15} /> {plan.monthly_limit.toLocaleString("en-IN")} requests / month</li>
                  <li><Check size={15} /> API keys, usage analytics and logs</li>
                  <li><Check size={15} /> Console playground</li>
                </ul>
                {open
                  ? <Link href="/login?mode=signup" className={free ? "x-submit lp-cta-main" : "lp-cta-ghost"}>{free ? "Create free account" : "Get started"} <ArrowRight size={16} /></Link>
                  : <span className="lp-plan-soon">Not available yet</span>}
              </article>
            );
          })}
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
          <p>A confirmed not-found is never mixed up with a temporary outage, so your users are never told a real account is invalid.</p>
          <div className="lp-cta"><Link href="/dashboard/docs" className="x-submit lp-cta-main">Read the API reference <ArrowRight size={17} /></Link></div>
        </div>
        <pre className="x-code" aria-label="Example request"><code>{`curl -X POST /api/lookup \\
  -H "Authorization: Bearer YOUR_EIDREN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"playerId":"123456789","zoneId":"1234"}'`}</code></pre>
      </section>

      <section className="x-section" id="faq" aria-labelledby="faq-title">
        <div className="x-section-head"><span className="x-eyebrow">FAQ</span><h2 id="faq-title">Good to know.</h2></div>
        <div className="lp-faq">
          {faqs.map((f) => <details key={f.q} className="lp-faq-item"><summary>{f.q}</summary><p>{f.a}</p></details>)}
        </div>
      </section>

      <section className="lp-banner">
        <div><h2>Ready to build with Eidren?</h2><p>Create your free account, grab an API key and run your first lookup in minutes.</p></div>
        <Link href="/login?mode=signup" className="x-submit lp-cta-main">Create free account <ArrowRight size={17} /></Link>
      </section>
    </SiteShell>
  );
}
