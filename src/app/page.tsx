"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Gamepad2, KeyRound, LoaderCircle, Search, ShieldCheck, Sparkles, Swords, Terminal, Webhook, Zap } from "lucide-react";

type LookupResult = { nickname: string; playerId: string; zoneId: string };
type ApiResponse = { success: boolean; data?: LookupResult; error?: string };

const steps = [
  { n: "01", title: "Open your profile", body: "Launch MLBB and tap your profile avatar in the top left." },
  { n: "02", title: "Find the ID line", body: "Your Player ID and the Zone ID in brackets sit under your in-game name." },
  { n: "03", title: "Enter both numbers", body: "Type them in above and we resolve the in-game name for that exact account." },
];

const features = [
  { icon: Gamepad2, title: "Zone-aware", body: "Player ID and Zone ID are checked together, so the name belongs to the account you typed." },
  { icon: ShieldCheck, title: "Honest results", body: "A confirmed not-found is never mixed up with the provider being unavailable." },
  { icon: Zap, title: "Live validation", body: "Names come from a live account-validation response, not a stale list." },
];

export default function Home() {
  const [playerId, setPlayerId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function lookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerId.trim(), zoneId: zoneId.trim() }),
      });
      const body = (await response.json()) as ApiResponse;
      if (!response.ok || !body.success || !body.data) {
        setError(body.error || "Lookup failed. Check the IDs and try again.");
        return;
      }
      setResult(body.data);
    } catch {
      setError("Could not reach the lookup service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(`${result.nickname} · ${result.playerId} (${result.zoneId})`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access is unavailable in this browser.");
    }
  }

  const initial = result ? result.nickname.trim().charAt(0).toUpperCase() || "?" : "?";

  return (
    <div className="x-page">
      <div className="x-orbs" aria-hidden="true"><i className="x-orb x-orb-a" /><i className="x-orb x-orb-b" /><i className="x-orb x-orb-c" /></div>
      <main className="x-wrap">
        <header className="x-nav">
          <Link className="x-brand" href="/" aria-label="Eidren home">
            <span className="x-brand-mark"><Swords size={19} strokeWidth={2.4} /></span>
            <span>EIDREN<b>.</b></span>
          </Link>
          <nav className="x-nav-links" aria-label="Primary">
            <a href="#lookup">Lookup</a>
            <a href="#how">How it works</a>
            <a href="#developers">Developers</a>
            <Link href="/login" className="x-nav-cta">Developer console <ArrowRight size={14} /></Link>
          </nav>
        </header>

        <section className="x-hero" id="lookup">
          <div className="x-hero-copy">
            <span className="x-chip"><i className="x-chip-dot" /> MOBILE LEGENDS: BANG BANG</span>
            <h1>Know who you&apos;re <span>playing with.</span></h1>
            <p className="x-lede">Resolve an in-game name from a Player ID and Zone ID. No login, no password, one honest answer.</p>

            <form className="x-form" onSubmit={lookup}>
              <div className="x-form-row">
                <div className="x-field">
                  <label htmlFor="player-id">PLAYER ID</label>
                  <input id="player-id" inputMode="numeric" autoComplete="off" value={playerId} onChange={(e) => setPlayerId(e.target.value.replace(/\D/g, "").slice(0, 20))} placeholder="123456789" required minLength={4} maxLength={20} />
                </div>
                <div className="x-field x-field-zone">
                  <label htmlFor="zone-id">ZONE ID</label>
                  <input id="zone-id" inputMode="numeric" autoComplete="off" value={zoneId} onChange={(e) => setZoneId(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="1234" required minLength={1} maxLength={10} />
                </div>
              </div>
              <button className="x-submit" type="submit" disabled={loading || !playerId || !zoneId}>
                {loading ? <><LoaderCircle className="spin" size={18} /> Resolving identity…</> : <><Search size={18} /> Resolve player</>}
              </button>
              <p className="x-hint"><Gamepad2 size={14} /> Zone ID is the number in brackets beside your Player ID.</p>
              {error && <div className="x-error" role="alert"><span aria-hidden="true">!</span><div><strong>Lookup unsuccessful</strong><p>{error}</p></div></div>}
            </form>
          </div>

          <div className="x-hero-art">
            <span className="x-ring x-ring-a" aria-hidden="true" />
            <span className="x-ring x-ring-b" aria-hidden="true" />
            <article className={`x-card${result ? " is-live" : ""}`} aria-live="polite">
              <div className="x-card-top">
                <span className="x-card-status">{result ? <><Check size={13} /> IDENTITY RESOLVED</> : "EXAMPLE RESULT"}</span>
                {result ? <button className="x-copy" type="button" onClick={copyResult}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button> : <i className="x-pulse" aria-hidden="true" />}
              </div>
              <div className="x-card-body">
                <span className="x-avatar" aria-hidden="true">{result ? initial : <Swords size={26} />}</span>
                <div className="x-card-text">
                  <strong>{result ? result.nickname : "Player name"}</strong>
                  <code>{result ? `${result.playerId} (${result.zoneId})` : "123456789 (1234)"}</code>
                </div>
              </div>
              <div className="x-tags"><span>Mobile Legends</span><span>Zone-aware</span></div>
              {result && <p className="x-card-foot">Nickname returned by the upstream account-validation response.</p>}
            </article>
            <div className="x-float x-float-a"><ShieldCheck size={15} /> No account login</div>
            <div className="x-float x-float-b"><Sparkles size={15} /> Live validation</div>
          </div>
        </section>

        <section className="x-section" id="how" aria-labelledby="how-title">
          <div className="x-section-head"><span className="x-eyebrow">HOW IT WORKS</span><h2 id="how-title">Two numbers. One identity.</h2><p>MLBB uses both your Player ID and Zone ID to identify the right account.</p></div>
          <ol className="x-steps">
            {steps.map((s) => <li className="x-step" key={s.n}><span className="x-step-n">{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>)}
          </ol>
        </section>

        <section className="x-section" aria-labelledby="why-title">
          <div className="x-section-head"><span className="x-eyebrow">WHY EIDREN</span><h2 id="why-title">Fast on the surface. Honest underneath.</h2></div>
          <div className="x-features">
            {features.map((f) => { const Icon = f.icon; return <article className="x-feature" key={f.title}><span className="x-feature-icon"><Icon size={22} /></span><h3>{f.title}</h3><p>{f.body}</p></article>; })}
          </div>
        </section>

        <section className="x-dev" id="developers" aria-labelledby="dev-title">
          <div className="x-dev-copy">
            <span className="x-eyebrow">FOR DEVELOPERS</span>
            <h2 id="dev-title">Ship it in your own app.</h2>
            <p>Create API keys, manage workspaces and webhooks, and read your own logs from one secure console.</p>
            <ul className="x-dev-list"><li><KeyRound size={16} /> Hashed API keys</li><li><Webhook size={16} /> Webhooks</li><li><Terminal size={16} /> Usage and logs</li></ul>
            <Link href="/login" className="x-submit x-dev-cta">Open the developer console <ArrowRight size={17} /></Link>
          </div>
          <pre className="x-code" aria-label="Example request"><code>{`curl -X POST /api/lookup \\
  -H "Authorization: Bearer YOUR_EIDREN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"playerId":"123456789","zoneId":"1234"}'`}</code></pre>
        </section>

        <footer className="x-footer">
          <span>© {new Date().getFullYear()} EIDREN LOOKUP · MLBB COMMUNITY TOOL</span>
          <span>NOT AFFILIATED WITH MOONTON · ACCOUNT VALIDATION IS AN UPSTREAM DEPENDENCY</span>
        </footer>
      </main>
    </div>
  );
}
