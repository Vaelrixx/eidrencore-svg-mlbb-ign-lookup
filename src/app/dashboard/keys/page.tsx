"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type ApiKey = { id: string; name: string; key_prefix: string; plan_slug: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

export default function ApiKeysPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("Production application");
  const [newKey, setNewKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/keys"); return; }
      if (!response.ok) throw new Error(body.error || "Could not load API keys.");
      setKeys(body.keys || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load API keys."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setError(""); setNotice(""); setNewKey("");
    try {
      const response = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/keys"); return; }
      if (!response.ok) throw new Error(body.error || "Could not create API key.");
      setNewKey(body.key); setKeys(current => [body.record, ...current]); setName(""); setNotice("Key created. Copy the full value now; it cannot be retrieved later.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create API key."); }
    finally { setCreating(false); }
  }

  async function revokeKey(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}"? Any application using it will stop working immediately.`)) return;
    setError(""); setNotice("");
    try {
      const response = await fetch(`/api/keys/${key.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not revoke this key.");
      setKeys(current => current.map(item => item.id === key.id ? { ...item, revoked_at: new Date().toISOString() } : item));
      setNotice("API key revoked.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not revoke this key."); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { setError("Clipboard is unavailable. Select the key and copy it manually."); }
  }

  const activeCount = keys.filter(key => !key.revoked_at).length;
  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    {notice && <div className="platform-alert success"><Check size={16}/>{notice}</div>}
    {newKey && <section className="new-key-panel"><div className="new-key-copy"><ShieldCheck size={20}/><div><strong>Copy your new secret now</strong><p>Eidren stores only a one-way hash. This is the only time the complete key will be visible.</p></div></div><code>{newKey}</code><button className="submit" onClick={() => void copy(newKey)}><Copy size={15}/>{copied ? "Copied" : "Copy secret key"}</button></section>}
    <section className="console-panel">
      <div className="console-panel-heading"><div><span className="platform-eyebrow">CREDENTIALS</span><h2>Create an API key</h2><p>Use a separate key for each app, bot, or environment. Never put secrets in frontend code.</p></div><span className="console-big-icon"><KeyRound size={20}/></span></div>
      <form className="console-create-form" onSubmit={createKey}><label>KEY LABEL<input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="e.g. Discord bot production" required /></label><button className="submit" type="submit" disabled={creating || activeCount >= 10}>{creating ? <><LoaderCircle className="spin" size={15}/> Creating…</> : <><Plus size={16}/> Create key</>}</button></form>
      <div className="console-form-foot"><span>Up to 10 active keys per account</span><span>{activeCount}/10 active</span></div>
    </section>
    <section className="console-panel">
      <div className="console-panel-heading"><div><span className="platform-eyebrow">KEY INVENTORY</span><h2>Your API keys</h2><p>Revoke any key you no longer trust. Revocation takes effect on the next request.</p></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh</button></div>
      {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading credentials…</div> : keys.length === 0 ? <div className="empty-state"><KeyRound size={25}/><strong>No API keys yet</strong><p>Create your first key above to start calling the Eidren API.</p></div> : <div className="console-table-wrap"><table className="console-table"><thead><tr><th>KEY</th><th>PLAN</th><th>CREATED</th><th>LAST USED</th><th>STATUS</th><th></th></tr></thead><tbody>{keys.map(key => <tr key={key.id}><td><div className="console-key-cell"><span className="key-row-icon"><KeyRound size={15}/></span><div><strong>{key.name}</strong><code>{key.key_prefix}••••••••</code></div></div></td><td><span className="status-pill">{key.plan_slug.toUpperCase()}</span></td><td>{new Date(key.created_at).toLocaleDateString()}</td><td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Not used yet"}</td><td><span className={`status-pill ${key.revoked_at ? "muted" : ""}`}>{key.revoked_at ? "REVOKED" : "ACTIVE"}</span></td><td>{!key.revoked_at && <button className="icon-button danger-button" aria-label={`Revoke ${key.name}`} onClick={() => void revokeKey(key)}><Trash2 size={15}/></button>}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="console-callout"><ShieldCheck size={19}/><div><strong>Security baseline</strong><p>Send keys as <code>Authorization: Bearer eid_…</code>. Rotate them if they leak, store them in environment variables, and never commit them to Git.</p></div></section>
  </ConsoleFrame>;
}
