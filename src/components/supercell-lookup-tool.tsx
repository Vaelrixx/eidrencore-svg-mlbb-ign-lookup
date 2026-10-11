"use client";

import { useState } from "react";
import { Check, Copy, Gamepad2, LoaderCircle, Search, ShieldCheck } from "lucide-react";

type GameKey = "brawl-stars" | "clash-of-clans" | "clash-royale";

const GAMES: Record<GameKey, { label: string; endpoint: string; placeholder: string }> = {
  "brawl-stars": { label: "Brawl Stars", endpoint: "/api/lookup/brawl-stars", placeholder: "#2PP" },
  "clash-of-clans": { label: "Clash of Clans", endpoint: "/api/lookup/clash-of-clans", placeholder: "#2PP" },
  "clash-royale": { label: "Clash Royale", endpoint: "/api/lookup/clash-royale", placeholder: "#2PP" },
};

type LookupResult = { nickname: string; tag: string };
type ApiResponse = { success: boolean; data?: LookupResult; error?: string };

export function SupercellLookupTool({ game }: { game: GameKey }) {
  const config = GAMES[game];
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  async function lookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setRaw("");
    setStatus(null);
    setMs(null);
    setLoading(true);
    const started = performance.now();
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tag.trim() }),
      });
      const body = (await response.json()) as ApiResponse;
      setStatus(response.status);
      setMs(Math.round(performance.now() - started));
      setRaw(JSON.stringify(body, null, 2));
      if (response.status === 401) {
        setError("Your session has expired. Sign in again to keep using the playground.");
        return;
      }
      if (!response.ok || !body.success || !body.data) {
        setError(body.error || "Lookup failed. Check the tag and try again.");
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
      await navigator.clipboard.writeText(`${result.nickname} · ${result.tag}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access is unavailable in this browser.");
    }
  }

  const initial = result ? result.nickname.trim().charAt(0).toUpperCase() || "?" : "?";
  const requestBody = JSON.stringify({ tag: tag.trim() || config.placeholder });

  return (
    <div className="pg-tool">
      <div className="pg-tool-col">
        <form className="x-form" onSubmit={lookup}>
          <div className="pg-form-head"><span className="pg-badge"><Gamepad2 size={15} /> {config.label}</span><span className="pg-endpoint">POST {config.endpoint}</span></div>
          <div className="x-form-row">
            <div className="x-field">
              <label htmlFor={`tag-${game}`}>PLAYER TAG</label>
              <input id={`tag-${game}`} autoComplete="off" spellCheck={false} value={tag} onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^0-9PYLQGRJCUV#]/gi, "").slice(0, 21))} placeholder={config.placeholder} required minLength={3} maxLength={21} />
            </div>
          </div>
          <button className="x-submit" type="submit" disabled={loading || !tag}>
            {loading ? <><LoaderCircle className="spin" size={18} /> Resolving identity…</> : <><Search size={18} /> Run lookup</>}
          </button>
          <p className="x-hint"><ShieldCheck size={14} /> Find your tag under your profile name in-game. Tags use 0289PYLQGRJCUV.</p>
          {error && <div className="x-error" role="alert"><span aria-hidden="true">!</span><div><strong>Lookup unsuccessful</strong><p>{error}</p></div></div>}
        </form>

        <div className="pg-panel">
          <div className="pg-panel-head"><span>REQUEST</span><code>application/json</code></div>
          <pre><code>{`POST ${config.endpoint}\n${requestBody}`}</code></pre>
        </div>
      </div>

      <div className="pg-tool-col">
        <article className={`x-card pg-result${result ? " is-live" : ""}`} aria-live="polite">
          <div className="x-card-top">
            <span className="x-card-status">{result ? <><Check size={13} /> IDENTITY RESOLVED</> : "EXAMPLE RESULT"}</span>
            {result ? <button className="x-copy" type="button" onClick={copyResult}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button> : <i className="x-pulse" aria-hidden="true" />}
          </div>
          <div className="x-card-body">
            <span className="x-avatar" aria-hidden="true">{initial}</span>
            <div className="x-card-text">
              <strong>{result ? result.nickname : "Player name"}</strong>
              <code>{result ? result.tag : config.placeholder}</code>
            </div>
          </div>
          <div className="x-tags"><span>{config.label}</span><span>Tag-based</span></div>
          {result && <p className="x-card-foot">Nickname returned by the official game provider response.</p>}
        </article>

        <div className="pg-panel">
          <div className="pg-panel-head">
            <span>RESPONSE</span>
            {status !== null ? <code className={status >= 200 && status < 300 ? "pg-ok" : "pg-bad"}>{status} · {ms} ms</code> : <code>waiting</code>}
          </div>
          <pre><code>{raw || "Run a lookup to see the raw response here."}</code></pre>
        </div>
      </div>
    </div>
  );
}
