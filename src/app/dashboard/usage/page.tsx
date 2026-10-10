"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowUpRight, Clock3, KeyRound, LoaderCircle, RefreshCw, TrendingUp, Zap } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type Usage = { plan: string; monthlyUsage: number; monthlyLimit: number; activeKeys: number; totalKeys: number; periodStart: string; daily: { date: string; requests: number }[]; keys: { id: string; name: string; prefix: string; plan: string; createdAt: string; lastUsedAt: string | null; revoked: boolean }[] };

const number = (value: number) => new Intl.NumberFormat("en-IN").format(value);
const dateLabel = (value: string) => new Date(value + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });

export default function UsagePage() {
  const router = useRouter();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/usage"); return; }
      if (!response.ok) throw new Error(body.error || "Could not load analytics.");
      setUsage(body);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load analytics."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);
  const peak = Math.max(1, ...(usage?.daily.map(day => day.requests) || [1]));
  const percent = usage ? Math.min(100, Math.round(usage.monthlyUsage / Math.max(1, usage.monthlyLimit) * 100)) : 0;

  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    <div className="console-toolbar"><div><span className="console-subtle">Reporting period</span><strong>{usage ? new Date(usage.periodStart + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) : "Current month"}</strong></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh data</button></div>
    {loading && !usage ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading usage analytics…</div> : usage && <>
      <div className="console-stats-grid">
        <article className="console-stat"><span><Activity size={15}/> REQUESTS THIS MONTH</span><strong>{number(usage.monthlyUsage)}<small> / {number(usage.monthlyLimit)}</small></strong><div className="usage-track"><i style={{ width: percent + "%" }}/></div><p>{percent}% of your current plan allowance used</p></article>
        <article className="console-stat"><span><KeyRound size={15}/> ACTIVE KEYS</span><strong>{number(usage.activeKeys)}<small> / 10</small></strong><p>{usage.totalKeys - usage.activeKeys} revoked or inactive key(s) in inventory</p></article>
        <article className="console-stat"><span><Zap size={15}/> CURRENT PLAN</span><strong className="capitalize">{usage.plan}</strong><p>Monthly allowance resets at the start of the UTC month</p></article>
      </div>
      <section className="console-panel">
        <div className="console-panel-heading"><div><span className="platform-eyebrow">REQUEST VOLUME</span><h2>Daily API traffic</h2><p>Accepted API-key requests over the last 14 days, grouped by UTC date.</p></div><span className="console-big-icon"><TrendingUp size={20}/></span></div>
        <div className="usage-chart" role="img" aria-label="Bar chart of daily API requests for the last 14 days">{usage.daily.map(day => <div className="usage-chart-column" key={day.date}><div className="usage-chart-value">{day.requests ? number(day.requests) : ""}</div><div className="usage-chart-track"><i style={{ height: Math.max(day.requests ? 5 : 2, Math.round(day.requests / peak * 100)) + "%" }}/></div><span>{dateLabel(day.date)}</span></div>)}</div>
        {usage.daily.every(day => day.requests === 0) && <div className="empty-state compact"><Activity size={22}/><strong>No API-key traffic recorded yet</strong><p>Requests using a valid Eidren API key will appear here after the daily analytics migration is applied.</p></div>}
      </section>
      <section className="console-panel">
        <div className="console-panel-heading"><div><span className="platform-eyebrow">PER-KEY ACTIVITY</span><h2>Credential activity</h2><p>Use this view to spot old keys and decide which ones should be rotated.</p></div><span className="console-big-icon"><Clock3 size={20}/></span></div>
        <div className="console-activity-list">{usage.keys.length === 0 ? <div className="empty-state"><KeyRound size={23}/><strong>No keys to report</strong><p>Create a key to start tracking authenticated requests.</p></div> : usage.keys.map(key => <div className="console-activity-row" key={key.id}><span className="key-row-icon"><KeyRound size={15}/></span><div className="console-activity-main"><strong>{key.name}</strong><code>{key.prefix}••••••</code></div><div className="console-activity-last"><span>{key.lastUsedAt ? "LAST REQUEST" : "ACTIVITY"}</span><strong>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never used"}</strong></div><span className={`status-pill ${key.revoked ? "muted" : ""}`}>{key.revoked ? "REVOKED" : "ACTIVE"}</span></div>)}</div>
      </section>
      <section className="console-callout"><ArrowUpRight size={18}/><div><strong>Usage is enforced server-side</strong><p>Quota checks run inside a Postgres RPC to avoid concurrent requests bypassing limits. Public lookups without a developer key remain protected by the separate public rate limiter.</p></div></section>
    </>}
  </ConsoleFrame>;
}
