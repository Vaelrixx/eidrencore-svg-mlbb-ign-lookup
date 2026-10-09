"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Gamepad2, LoaderCircle, Search, ShieldCheck, Sparkles, Swords, Zap } from "lucide-react";

type LookupResult = { nickname: string; playerId: string; zoneId: string };
type ApiResponse = { success: boolean; data?: LookupResult; error?: string };

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

  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/" aria-label="Eidren home">
          <span className="brand-mark"><Swords size={19} strokeWidth={2.4} /></span>
          <span>EIDREN<span className="brand-dot">.</span></span>
        </Link>
        <div className="nav-right"><span className="live-dot" /> PLAYER INTELLIGENCE <span className="nav-divider" /> <span className="nav-version">BETA 01</span></div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> MOBILE LEGENDS: BANG BANG</div>
          <h1>Know who<br />you&apos;re <span>playing with.</span></h1>
          <p className="lede">A focused identity check for the Land of Dawn. Enter a player ID and zone to resolve their in-game name.</p>
          <div className="trust-row"><span><ShieldCheck size={15} /> No account login</span><span><Zap size={15} /> Live account validation</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="art-core"><Swords size={70} strokeWidth={1.1} /></div>
          <div className="art-ring ring-a" /><div className="art-ring ring-b" />
          <div className="art-tag"><span className="live-dot" /> IDENTITY SYSTEM</div>
          <div className="art-coord">MLBB / 01<br />PLAYER IDENTITY</div>
        </div>
      </section>

      <section className="workspace">
        <div className="section-label"><span>01</span> PLAYER LOOKUP <span className="section-line" /></div>
        <div className="lookup-grid">
          <div className="form-panel">
            <div className="panel-heading"><div><h2>Find a player</h2><p>Use the ID shown on their in-game profile.</p></div><div className="panel-icon"><Search size={19} /></div></div>
            <form onSubmit={lookup}>
              <label htmlFor="player-id">PLAYER ID <span>REQUIRED</span></label>
              <input id="player-id" inputMode="numeric" autoComplete="off" value={playerId} onChange={(e) => setPlayerId(e.target.value.replace(/\D/g, "").slice(0, 20))} placeholder="e.g. 123456789" required minLength={4} maxLength={20} />
              <label htmlFor="zone-id">ZONE ID <span>REQUIRED</span></label>
              <input id="zone-id" inputMode="numeric" autoComplete="off" value={zoneId} onChange={(e) => setZoneId(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="e.g. 1234" required minLength={1} maxLength={10} />
              <div className="hint"><Gamepad2 size={14} /> Zone ID is the number in brackets beside your Player ID.</div>
              <button className="submit" type="submit" disabled={loading || !playerId || !zoneId}>
                {loading ? <><LoaderCircle className="spin" size={17} /> Resolving identity…</> : <>Resolve player <ArrowRight size={17} /></>}
              </button>
            </form>
            {error && <div className="error-box" role="alert"><span className="error-mark">!</span><div><strong>Lookup unsuccessful</strong><p>{error}</p></div></div>}
            {result && <div className="result-box" aria-live="polite">
              <div className="result-top"><span className="result-status"><Check size={13} /> IDENTITY RESOLVED</span><button className="copy-button" type="button" onClick={copyResult}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button></div>
              <div className="result-name">{result.nickname}</div>
              <div className="result-ids"><span>PLAYER <b>{result.playerId}</b></span><span>ZONE <b>{result.zoneId}</b></span></div>
              <p className="result-foot">Nickname returned by the upstream account-validation response.</p>
            </div>}
          </div>
          <aside className="side-panel">
            <div className="side-top"><span className="tiny-label">HOW IT WORKS</span><Gamepad2 size={19} /></div>
            <h3>Two numbers.<br />One identity.</h3>
            <p>MLBB uses both your Player ID and Zone ID to identify the right account.</p>
            <div className="id-example"><div className="avatar-placeholder"><Swords size={20} /></div><div><span>PLAYER PROFILE</span><strong>123456789 <em>(1234)</em></strong></div><span className="example-check"><Check size={14} /></span></div>
            <div className="steps">
              <div className="step"><span>1</span><p>Open MLBB and tap your profile avatar.</p></div>
              <div className="step"><span>2</span><p>Find the ID line below your in-game name.</p></div>
              <div className="step"><span>3</span><p>Enter both numbers here to check the IGN.</p></div>
            </div>
            <div className="privacy-note"><ShieldCheck size={16} /><span><strong>Privacy by design</strong><br />No password or Moonton login required.</span></div>
          </aside>
        </div>
      </section>

      <section className="bottom-strip"><div><span className="strip-icon"><Sparkles size={16} /></span><div><strong>Built for the community</strong><p>A focused identity tool. Nothing more, nothing hidden.</p></div></div><div className="strip-right">MLBB COMMUNITY TOOL <span>·</span> NOT AFFILIATED WITH MOONTON</div></section>
      <footer><span>© {new Date().getFullYear()} EIDREN LOOKUP</span><span>ACCOUNT VALIDATION · UPSTREAM DEPENDENCY</span></footer>
    </main>
  );
}
