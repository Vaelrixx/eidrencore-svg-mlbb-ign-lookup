"use client";

import { useState } from "react";
import { Check, Copy, Gamepad2, LoaderCircle, Search, ShieldCheck, Swords } from "lucide-react";

type LookupResult = { nickname: string; playerId: string; zoneId: string };
type ApiResponse = { success: boolean; data?: LookupResult; error?: string };

export function PlayerLookupTool() {
  const [playerId, setPlayerId] = useState("");
  const [zoneId, setZoneId] = useState("");
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
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerId.trim(), zoneId: zoneId.trim() }),
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
  const requestBody = JSON.stringify({ playerId: playerId.trim() || "123456789", zoneId: zoneId.trim() || "1234" });

  return (
    <div className="pg-tool">
      <div className="pg-tool-col">
        <form className="x-form" onSubmit={lookup}>
          <div className="pg-form-head"><span className="pg-badge"><Gamepad2 size={15} /> Mobile Legends</span><span className="pg-endpoint">POST /api/lookup</span></div>
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
            {loading ? <><LoaderCircle className="spin" size={18} /> Resolving identity…</> : <><Search size={18} /> Run lookup</>}
          </button>
          <p className="x-hint"><ShieldCheck size={14} /> Zone ID is the number in brackets beside your Player ID.</p>
          {error && <div className="x-error" role="alert"><span aria-hidden="true">!</span><div><strong>Lookup unsuccessful</strong><p>{error}</p></div></div>}
        </form>

        <div className="pg-panel">
          <div className="pg-panel-head"><span>REQUEST</span><code>application/json</code></div>
          <pre><code>{`POST /api/lookup\n${requestBody}`}</code></pre>
        </div>
      </div>

      <div className="pg-tool-col">
        <article className={`x-card pg-result${result ? " is-live" : ""}`} aria-live="polite">
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
          {result && <p className="x-card-foot">Identity resolved by the Eidren network.</p>}
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
