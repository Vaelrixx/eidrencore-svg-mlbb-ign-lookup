"use client";

import { useState } from "react";
import { Check, Gamepad2, LoaderCircle, Search, ShieldCheck, Zap } from "lucide-react";

type IdentityGame = "pubg-mobile" | "call-of-duty-mobile" | "valorant" | "genshin-impact" | "honor-of-kings" | "arena-of-valor" | "pubg-lite" | "teen-patti-gold" | "jawaker" | "fc-mobile" | "free-fire" | "free-fire-global";
type FieldSpec = { key: string; label: string; placeholder: string; inputMode?: "numeric" | "text"; maxLength: number; options?: readonly string[] };
type GameSpec = { label: string; endpoint: string; fields: FieldSpec[]; sample: Record<string, string> };

const GAME_CONFIG: Record<IdentityGame, GameSpec> = {
  "pubg-mobile": {
    label: "PUBG Mobile Global",
    endpoint: "/api/lookup/pubg-mobile",
    fields: [{ key: "playerId", label: "CHARACTER ID", placeholder: "5204837417", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "5204837417" },
  },
  "call-of-duty-mobile": {
    label: "Call of Duty: Mobile (Garena)",
    endpoint: "/api/lookup/call-of-duty-mobile",
    fields: [{ key: "playerId", label: "PLAYER ID", placeholder: "8370310025568788000", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "8370310025568788000" },
  },
  valorant: {
    label: "VALORANT",
    endpoint: "/api/lookup/valorant",
    fields: [
      { key: "name", label: "RIOT ID NAME", placeholder: "ucup", maxLength: 16 },
      { key: "tag", label: "RIOT ID TAG", placeholder: "123", maxLength: 5 },
    ],
    sample: { name: "ucup", tag: "123" },
  },
  "genshin-impact": {
    label: "Genshin Impact",
    endpoint: "/api/lookup/genshin-impact",
    fields: [
      { key: "playerId", label: "UID", placeholder: "844335555", inputMode: "numeric", maxLength: 24 },
      { key: "server", label: "SERVER", placeholder: "asia", maxLength: 7, options: ["asia", "america", "europa", "china"] },
    ],
    sample: { playerId: "844335555", server: "asia" },
  },
  "honor-of-kings": {
    label: "Honor of Kings",
    endpoint: "/api/lookup/honor-of-kings",
    fields: [{ key: "playerId", label: "PLAYER ID", placeholder: "17960996468644334037", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "17960996468644334037" },
  },
  "arena-of-valor": {
    label: "Arena of Valor",
    endpoint: "/api/lookup/arena-of-valor",
    fields: [{ key: "playerId", label: "PLAYER ID", placeholder: "195293573153949", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "195293573153949" },
  },
  "pubg-lite": {
    label: "PUBG Mobile Lite",
    endpoint: "/api/lookup/pubg-lite",
    fields: [{ key: "playerId", label: "CHARACTER ID", placeholder: "7228395004", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "7228395004" },
  },
  "teen-patti-gold": {
    label: "Teen Patti Gold",
    endpoint: "/api/lookup/teen-patti-gold",
    fields: [{ key: "playerId", label: "PLAYER ID", placeholder: "100439992784", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "100439992784" },
  },
  jawaker: {
    label: "Jawaker",
    endpoint: "/api/lookup/jawaker",
    fields: [{ key: "playerId", label: "PLAYER ID", placeholder: "1473084005", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "1473084005" },
  },
  "fc-mobile": {
    label: "FC Mobile",
    endpoint: "/api/lookup/fc-mobile",
    fields: [{ key: "playerId", label: "UID", placeholder: "1856150661662899105", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "1856150661662899105" },
  },
  "free-fire": {
    label: "Free Fire",
    endpoint: "/api/lookup/free-fire",
    fields: [{ key: "playerId", label: "UID", placeholder: "1958604115", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "1958604115" },
  },
  "free-fire-global": {
    label: "Free Fire Global",
    endpoint: "/api/lookup/free-fire-global",
    fields: [{ key: "playerId", label: "UID", placeholder: "12341234", inputMode: "numeric", maxLength: 24 }],
    sample: { playerId: "12341234" },
  },
};

type ApiResponse = { success: boolean; data?: { nickname?: string; [key: string]: unknown }; error?: string };

export function IdGameLookupTool({ game }: { game: IdentityGame }) {
  const spec = GAME_CONFIG[game];
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  async function runLookup(input: Record<string, string>) {
    setError("");
    setResponse(null);
    setStatus(null);
    setMs(null);
    setLoading(true);
    const started = performance.now();
    try {
      const result = await fetch(spec.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await result.json()) as ApiResponse;
      setStatus(result.status);
      setMs(Math.round(performance.now() - started));
      setResponse(payload);
      if (result.status === 401) {
        setError("Your session has expired. Sign in again to keep using the playground.");
      } else if (!result.ok || !payload.success || !payload.data) {
        setError(payload.error || "Lookup failed. Check the ID and try again.");
      }
    } catch {
      setError("Could not reach the lookup service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: Record<string, string> = Object.fromEntries(spec.fields.map((field) => [
      field.key,
      values[field.key]?.trim() || field.options?.[0] || "",
    ]));
    await runLookup(input);
  }

  async function trySample() {
    setValues(spec.sample);
    await runLookup(spec.sample);
  }

  const requestBody = JSON.stringify(Object.fromEntries(spec.fields.map((field) => [field.key, values[field.key] || spec.sample[field.key] || field.placeholder])), null, 2);
  const nickname = typeof response?.data?.nickname === "string" ? response.data.nickname : null;
  const initial = nickname?.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="pg-tool">
      <div className="pg-tool-col">
        <form className="x-form" onSubmit={submit}>
          <div className="pg-form-head"><span className="pg-badge"><Gamepad2 size={15} /> {spec.label}</span><span className="pg-endpoint">POST {spec.endpoint}</span></div>
          <button className="pg-sample" type="button" onClick={trySample} disabled={loading}>
            <Zap size={14} /> Try documented sample
          </button>
          <div className="x-form-row">
            {spec.fields.map((field) => (
              <div className="x-field" key={field.key}>
                <label htmlFor={`${game}-${field.key}`}>{field.label}</label>
                {field.options ? (
                  <select
                    id={`${game}-${field.key}`}
                    value={values[field.key] || field.options[0]}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  >
                    {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input
                    id={`${game}-${field.key}`}
                    inputMode={field.inputMode}
                    autoComplete="off"
                    value={values[field.key] || ""}
                    onChange={(event) => {
                      const value = field.inputMode === "numeric"
                        ? event.target.value.replace(/\D/g, "").slice(0, field.maxLength)
                        : event.target.value.slice(0, field.maxLength);
                      setValues((current) => ({ ...current, [field.key]: value }));
                    }}
                    placeholder={field.placeholder}
                    required
                    maxLength={field.maxLength}
                  />
                )}
              </div>
            ))}
          </div>
          <button className="x-submit" type="submit" disabled={loading || spec.fields.some((field) => !values[field.key]?.trim() && !field.options?.length)}>
            {loading ? <><LoaderCircle className="spin" size={18} /> Resolving identity…</> : <><Search size={18} /> Run lookup</>}
          </button>
          <p className="x-hint"><ShieldCheck size={14} /> Only the game identity fields are sent. Service credentials remain server-side.</p>
          {error && <div className="x-error" role="alert"><span aria-hidden="true">!</span><div><strong>Lookup unsuccessful</strong><p>{error}</p></div></div>}
        </form>
        <div className="pg-panel"><div className="pg-panel-head"><span>REQUEST</span><code>application/json</code></div><pre><code>{`POST ${spec.endpoint}\n${requestBody}`}</code></pre></div>
      </div>
      <div className="pg-tool-col">
        <article className={`x-card pg-result${nickname ? " is-live" : ""}`} aria-live="polite">
          <div className="x-card-top"><span className="x-card-status">{nickname ? <><Check size={13} /> IDENTITY RESOLVED</> : "EXAMPLE RESULT"}</span><i className="x-pulse" aria-hidden="true" /></div>
          <div className="x-card-body"><span className="x-avatar" aria-hidden="true">{initial}</span><div className="x-card-text"><strong>{nickname || "Player name"}</strong><code>{spec.label}</code></div></div>
          <div className="x-tags"><span>{spec.label}</span><span>Identity lookup</span></div>
          {nickname && <p className="x-card-foot">Identity resolved by the Eidren network.</p>}
        </article>
        <div className="pg-panel">
          <div className="pg-panel-head"><span>RESPONSE</span>{status !== null ? <code className={status >= 200 && status < 300 ? "pg-ok" : "pg-bad"}>{status} · {ms} ms</code> : <code>waiting</code>}</div>
          <pre><code>{response ? JSON.stringify(response, null, 2) : "Run a lookup to see the raw response here."}</code></pre>
        </div>
      </div>
    </div>
  );
}
