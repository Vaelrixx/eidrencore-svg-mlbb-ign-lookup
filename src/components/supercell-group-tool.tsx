"use client";

import { useState } from "react";
import { Check, LoaderCircle, Search, ShieldCheck, Swords, Trophy, Users } from "lucide-react";

type GameKey = "brawl-stars" | "clash-of-clans" | "clash-royale";
type ToolKey = "group" | "history" | "rankings";

const GROUP_LABEL: Record<GameKey, string> = {
  "brawl-stars": "Club",
  "clash-of-clans": "Clan",
  "clash-royale": "Clan",
};

const GROUP_PLACEHOLDER: Record<GameKey, string> = {
  "brawl-stars": "#2PP",
  "clash-of-clans": "#2PP",
  "clash-royale": "#C0G20PR2",
};

const PLAYER_PLACEHOLDER: Record<GameKey, string> = {
  "brawl-stars": "#2PP",
  "clash-of-clans": "#2PP",
  "clash-royale": "#C0G20PR2",
};

function endpointFor(game: GameKey, tool: ToolKey): string {
  if (tool === "group") return game === "brawl-stars" ? "/api/lookup/brawl-stars/club" : `/api/lookup/${game}/clan`;
  if (tool === "history") return game === "clash-of-clans" ? "/api/lookup/clash-of-clans/warlog" : `/api/lookup/${game}/battles`;
  return `/api/lookup/${game}/rankings`;
}

function historyNoun(game: GameKey): string {
  return game === "clash-of-clans" ? "wars" : "battles";
}

export function SupercellGroupTool({ game }: { game: GameKey }) {
  const [tool, setTool] = useState<ToolKey>("group");
  const [tag, setTag] = useState("");
  const [locationId, setLocationId] = useState("global");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  const endpoint = endpointFor(game, tool);
  const groupLabel = GROUP_LABEL[game];

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setRaw("");
    setStatus(null);
    setMs(null);
    setLoading(true);
    const started = performance.now();
    try {
      const body = tool === "rankings" ? { locationId: locationId.trim() || "global" } : { tag: tag.trim() };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { success: boolean; error?: string };
      setStatus(response.status);
      setMs(Math.round(performance.now() - started));
      setRaw(JSON.stringify(payload, null, 2));
      if (response.status === 401) {
        setError("Your session has expired. Sign in again to keep using the playground.");
        return;
      }
      if (!response.ok || !payload.success) {
        setError(payload.error || "Lookup failed. Check the input and try again.");
      }
    } catch {
      setError("Could not reach the lookup service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const requestBody = tool === "rankings"
    ? JSON.stringify({ locationId: locationId.trim() || "global" })
    : JSON.stringify({ tag: tag.trim() || (tool === "group" ? GROUP_PLACEHOLDER[game] : PLAYER_PLACEHOLDER[game]) });

  return (
    <div className="pg-tool">
      <div className="pg-tool-col">
        <form className="x-form" onSubmit={run}>
          <div className="pg-form-head">
            <span className="pg-badge"><Users size={15} /> {groupLabel}s & battles</span>
            <span className="pg-endpoint">POST {endpoint}</span>
          </div>
          <div className="pg-game-tabs" role="tablist" aria-label="Tool">
            <button type="button" role="tab" aria-selected={tool === "group"} className={tool === "group" ? "pg-game-tab is-active" : "pg-game-tab"} onClick={() => setTool("group")}>
              <Users size={13} /> {groupLabel}
            </button>
            <button type="button" role="tab" aria-selected={tool === "history"} className={tool === "history" ? "pg-game-tab is-active" : "pg-game-tab"} onClick={() => setTool("history")}>
              <Swords size={13} /> {game === "clash-of-clans" ? "War log" : "Battles"}
            </button>
            <button type="button" role="tab" aria-selected={tool === "rankings"} className={tool === "rankings" ? "pg-game-tab is-active" : "pg-game-tab"} onClick={() => setTool("rankings")}>
              <Trophy size={13} /> Rankings
            </button>
          </div>
          {tool === "rankings" ? (
            <div className="x-form-row">
              <div className="x-field">
                <label htmlFor={`location-${game}`}>LOCATION</label>
                <input id={`location-${game}`} autoComplete="off" spellCheck={false} value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="global" />
              </div>
            </div>
          ) : (
            <div className="x-form-row">
              <div className="x-field">
                <label htmlFor={`group-tag-${game}`}>{tool === "group" ? `${groupLabel.toUpperCase()} TAG` : "PLAYER TAG"}</label>
                <input
                  id={`group-tag-${game}`}
                  autoComplete="off"
                  spellCheck={false}
                  value={tag}
                  onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^0-9PYLQGRJCUV#]/gi, "").slice(0, 21))}
                  placeholder={tool === "group" ? GROUP_PLACEHOLDER[game] : PLAYER_PLACEHOLDER[game]}
                  required
                  minLength={3}
                  maxLength={21}
                />
              </div>
            </div>
          )}
          <button className="x-submit" type="submit" disabled={loading || (tool !== "rankings" && !tag)}>
            {loading ? <><LoaderCircle className="spin" size={18} /> Loading…</> : <><Search size={18} /> Run {tool === "group" ? groupLabel.toLowerCase() : tool === "history" ? historyNoun(game) : "rankings"} lookup</>}
          </button>
          <p className="x-hint"><ShieldCheck size={14} /> {tool === "rankings" ? "Use global or a numeric location ID." : `Find the tag in-game. Tags use 0289PYLQGRJCUV.`}</p>
          {error && <div className="x-error" role="alert"><span aria-hidden="true">!</span><div><strong>Lookup unsuccessful</strong><p>{error}</p></div></div>}
        </form>

        <div className="pg-panel">
          <div className="pg-panel-head"><span>REQUEST</span><code>application/json</code></div>
          <pre><code>{`POST ${endpoint}\n${requestBody}`}</code></pre>
        </div>
      </div>

      <div className="pg-tool-col">
        <div className="pg-panel">
          <div className="pg-panel-head">
            <span>RESPONSE</span>
            {status !== null ? <code className={status >= 200 && status < 300 ? "pg-ok" : "pg-bad"}>{status} · {ms} ms</code> : <code>waiting</code>}
          </div>
          <pre><code>{raw || "Run a lookup to see the raw response here."}</code></pre>
        </div>
        {status !== null && status >= 200 && status < 300 && (
          <p className="x-hint"><Check size={14} /> Success — full payload shown above.</p>
        )}
      </div>
    </div>
  );
}
