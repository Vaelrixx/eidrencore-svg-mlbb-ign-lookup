"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, Check, Clock3, FileText, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type Audit = { id: number; workspace_id: string | null; action: string; resource_type: string; resource_id: string | null; metadata: Record<string, unknown>; created_at: string };
type RequestLog = { id: number; api_key_id: string | null; request_id: string; endpoint: string; http_status: number; response_ms: number; created_at: string };

export default function DeveloperLogsPage() {
  const router = useRouter();
  const [audit, setAudit] = useState<Audit[]>([]);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/developer-logs?limit=100", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/logs"); return; }
      if (!response.ok) throw new Error(body.error || "Could not load logs.");
      setAudit(body.audit || []); setRequests(body.requests || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load logs."); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const filteredRequests = requests.filter(item => filter === "all" || (filter === "errors" ? item.http_status >= 400 : item.http_status < 400));
  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">OBSERVABILITY</span><h2>Request logs</h2><p>Inspect authenticated API traffic with response status, latency, request IDs, and timestamps.</p></div><span className="console-big-icon"><Activity size={20}/></span></div>
      <div className="console-toolbar"><div className="console-filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All requests</button><button className={filter === "errors" ? "active" : ""} onClick={() => setFilter("errors")}>Errors only</button><button className={filter === "success" ? "active" : ""} onClick={() => setFilter("success")}>Successful</button></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh</button></div>
      {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading request logs…</div> : filteredRequests.length === 0 ? <div className="empty-state"><Activity size={22}/><strong>No matching API requests</strong><p>Requests authenticated with a valid Eidren API key will appear here. Public unauthenticated lookups are not included.</p></div> : <div className="developer-log-list">{filteredRequests.map(item => <div className="developer-log-row" key={item.id}><span className={"http-status" + (item.http_status >= 400 ? " error" : item.http_status >= 300 ? " warn" : "")}>{item.http_status}</span><div className="developer-log-main"><strong>{item.endpoint}</strong><code>{item.request_id}</code><small>{item.api_key_id ? "Key " + item.api_key_id.slice(0, 8) : "Key removed"} · {new Date(item.created_at).toLocaleString()}</small></div><span className="log-latency"><Clock3 size={13}/>{item.response_ms} ms</span></div>)}</div>}
    </section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">SECURITY TRAIL</span><h2>Audit log</h2><p>Key lifecycle, billing, workspace, and webhook administration actions.</p></div><span className="console-big-icon"><ShieldCheck size={20}/></span></div>
      {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading audit trail…</div> : audit.length === 0 ? <div className="empty-state compact"><FileText size={20}/><strong>No audit events yet</strong><p>Supported account actions are written here automatically.</p></div> : <div className="developer-log-list">{audit.map(item => <div className="developer-log-row" key={item.id}><span className="audit-icon"><FileText size={15}/></span><div className="developer-log-main"><strong>{item.action}</strong><code>{item.resource_type}{item.resource_id ? " · " + item.resource_id : ""}</code><small>{new Date(item.created_at).toLocaleString()}{item.workspace_id ? " · Workspace " + item.workspace_id.slice(0, 8) : ""}</small></div><span className="audit-metadata">{Object.keys(item.metadata || {}).length ? JSON.stringify(item.metadata) : "—"}</span></div>)}</div>}
      <div className="security-note"><AlertTriangle size={16}/><p>Logs exclude player IDs, nicknames, bearer tokens, and webhook secrets. Request logs begin collecting after this release is deployed; historical requests cannot be reconstructed.</p></div>
    </section>
    <div className="console-callout"><Check size={17}/><div><strong>Retention and export</strong><p>Current views show up to 100 recent entries in each list. Automatic retention, downloadable exports, and advanced query filters are not yet enabled.</p></div></div>
  </ConsoleFrame>;
}
