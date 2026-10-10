"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Check, Copy, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2, Webhook } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type Endpoint = { id: string; name: string; url: string; events: string[]; enabled: boolean; created_at: string };
type Delivery = { id: number; endpoint_id: string; event_id: string; event_type: string; response_status: number | null; response_ms: number | null; delivered: boolean; error_code: string | null; created_at: string };
const eventLabels: Record<string,string> = { "api.key.created": "API key created", "api.key.revoked": "API key revoked", "billing.subscription.activated": "Subscription activated", "workspace.member.invited": "Workspace member invited", "workspace.member.removed": "Workspace member removed" };

export default function WebhooksPage() {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [supportedEvents, setSupportedEvents] = useState<string[]>(Object.keys(eventLabels));
  const [name, setName] = useState("Production webhook");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["api.key.created", "api.key.revoked", "billing.subscription.activated"]);
  const [newSecret, setNewSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/webhooks", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/webhooks"); return; }
      if (!response.ok) throw new Error(body.error || "Could not load webhooks.");
      setEndpoints(body.endpoints || []); setDeliveries(body.deliveries || []); setSupportedEvents(body.supportedEvents || Object.keys(eventLabels));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load webhooks."); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function createEndpoint(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("create"); setError(""); setNotice(""); setNewSecret("");
    try {
      const response = await fetch("/api/webhooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url, events }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create webhook.");
      setNewSecret(body.secret); setNotice("Webhook endpoint created. Copy the signing secret now; it will not be shown again.");
      setName(""); setUrl(""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create webhook."); }
    finally { setBusy(""); }
  }

  async function remove(endpoint: Endpoint) {
    if (!window.confirm("Delete webhook endpoint " + endpoint.name + "?")) return;
    const response = await fetch("/api/webhooks/" + endpoint.id, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Could not delete endpoint."); return; }
    setNotice("Webhook endpoint deleted."); await refresh();
  }
  async function toggle(endpoint: Endpoint) {
    const response = await fetch("/api/webhooks/" + endpoint.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !endpoint.enabled }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Could not update endpoint."); return; }
    setEndpoints(current => current.map(item => item.id === endpoint.id ? { ...item, enabled: !item.enabled } : item));
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setError("Clipboard unavailable. Copy this value manually: " + value); }
  }

  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    {notice && <div className="platform-alert success"><Check size={15}/>{notice}</div>}
    {newSecret && <div className="new-key-panel"><div className="new-key-copy"><ShieldCheck size={18}/><div><strong>Copy your webhook signing secret</strong><p>Store it securely. Eidren signs the timestamp and raw JSON body using HMAC-SHA256.</p></div></div><code>{newSecret}</code><button className="submit" onClick={() => void copy(newSecret)}><Copy size={15}/> Copy signing secret</button></div>}
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">EVENT DELIVERY</span><h2>Webhook endpoints</h2><p>Receive signed event notifications for keys, billing, and workspace changes.</p></div><span className="console-big-icon"><Webhook size={20}/></span></div>
      <form className="webhook-create-form" onSubmit={createEndpoint}><label>ENDPOINT NAME<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required placeholder="Production webhook"/></label><label>HTTPS URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://api.example.com/eidren/webhook"/></label><div className="webhook-events"><span className="platform-eyebrow">EVENTS</span>{supportedEvents.map(item => <label key={item} className="webhook-event-option"><input type="checkbox" checked={events.includes(item)} onChange={e => setEvents(current => e.target.checked ? [...current, item] : current.filter(value => value !== item))}/><span>{eventLabels[item] || item}</span><code>{item}</code></label>)}</div><button className="submit" disabled={busy === "create" || !events.length}>{busy === "create" ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>} Add endpoint</button></form>
      {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading endpoints…</div> : endpoints.length === 0 ? <div className="empty-state"><Webhook size={22}/><strong>No webhook endpoints</strong><p>Add a public HTTPS endpoint to receive selected events.</p></div> : <div className="workspace-member-list">{endpoints.map(endpoint => <article className="webhook-endpoint-row" key={endpoint.id}><span className="key-row-icon"><Webhook size={16}/></span><div className="webhook-endpoint-main"><strong>{endpoint.name}</strong><code>{endpoint.url}</code><small>{endpoint.events.map(item => eventLabels[item] || item).join(" · ")}</small></div><span className={"status-pill" + (endpoint.enabled ? "" : " muted")}>{endpoint.enabled ? "ENABLED" : "PAUSED"}</span><button className="quiet-button" onClick={() => void toggle(endpoint)}>{endpoint.enabled ? "Pause" : "Enable"}</button><button className="icon-button danger-button" aria-label="Delete webhook" onClick={() => void remove(endpoint)}><Trash2 size={15}/></button></article>)}</div>}
    </section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">DELIVERY HISTORY</span><h2>Recent attempts</h2><p>Delivery status, response code, and latency. Failed deliveries are logged but not automatically retried yet.</p></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/> Refresh</button></div>
      {deliveries.length === 0 ? <div className="empty-state compact"><Activity size={20}/><strong>No delivery attempts yet</strong><p>Events are sent when you create or revoke keys, activate a paid plan, or manage workspace members.</p></div> : <div className="workspace-member-list">{deliveries.map(delivery => <div className="webhook-delivery-row" key={delivery.id}><span className={"delivery-dot" + (delivery.delivered ? " success" : " failed")}/><div><strong>{eventLabels[delivery.event_type] || delivery.event_type}</strong><small>{new Date(delivery.created_at).toLocaleString()} · {delivery.response_ms ?? "—"} ms · {delivery.response_status ?? delivery.error_code ?? "No response"}</small></div><span className={"status-pill" + (delivery.delivered ? "" : " muted")}>{delivery.delivered ? "DELIVERED" : "FAILED"}</span></div>)}</div>}
    </section>
    <div className="console-callout"><ShieldCheck size={17}/><div><strong>Signing and network protections</strong><p>Each request includes Eidren-Event-Id, Eidren-Event, and Eidren-Signature: t=timestamp,v1=HMAC. Endpoints must use HTTPS; local and private IP URL patterns are rejected. Verify the signature against the raw body and reject stale timestamps.</p></div></div>
  </ConsoleFrame>;
}
