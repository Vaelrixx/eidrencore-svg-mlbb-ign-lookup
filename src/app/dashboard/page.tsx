"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowDownRight, ArrowRight, Check, CircleHelp, Copy, CreditCard, KeyRound, LoaderCircle, LogOut, Plus, RefreshCw, ShieldCheck, Swords, Trash2, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ApiKey = { id: string; name: string; key_prefix: string; plan_slug: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
type Plan = { slug: string; name: string; price_paise: number; monthly_limit: number; enabled: boolean; description: string };
type Account = { user: { id: string; email?: string }; plan: string; status: string; currentPeriodEnd: string | null; monthlyUsage: number; monthlyLimit: number };

declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; } }

export default function DashboardPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [keyName, setKeyName] = useState("Production application");
  const [newKey, setNewKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [billingBusy, setBillingBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const auth = await createClient().auth.getUser();
      if (!auth.data.user) { router.replace("/login?next=/dashboard"); return; }
      setUserEmail(auth.data.user.email || "Connected account");
      const [keyResponse, planResponse, accountResponse] = await Promise.all([fetch("/api/keys"), fetch("/api/billing/plans"), fetch("/api/billing/me")]);
      const keyBody = await keyResponse.json(); const planBody = await planResponse.json(); const accountBody = await accountResponse.json();
      if (keyResponse.status === 401) { router.replace("/login?next=/dashboard"); return; }
      if (!keyResponse.ok) throw new Error(keyBody.error || "Could not load API keys.");
      setKeys(keyBody.keys || []); setPlans(planBody.plans || []);
      if (accountResponse.ok) setAccount(accountBody);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your developer account."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setError(""); setNotice(""); setNewKey("");
    try {
      const response = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: keyName }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create API key.");
      setNewKey(body.key); setNotice("API key created. Copy it now; the full key will not be shown again.");
      setKeys(current => [body.record, ...current]); setKeyName("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create API key."); }
    finally { setCreating(false); }
  }
  async function revokeKey(key: ApiKey) {
    if (!window.confirm(`Revoke “${key.name}”? Applications using this key will stop working.`)) return;
    setError(""); setNotice("");
    const response = await fetch(`/api/keys/${key.id}`, { method: "DELETE" }); const body = await response.json();
    if (!response.ok) { setError(body.error || "Could not revoke key."); return; }
    setKeys(current => current.map(item => item.id === key.id ? { ...item, revoked_at: new Date().toISOString() } : item));
    setNotice("API key revoked.");
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setError("Clipboard is unavailable. Select and copy the key manually."); }
  }
  async function upgrade(plan: Plan) {
    setBillingBusy(plan.slug); setError(""); setNotice("");
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: plan.slug }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not start checkout.");
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.onload = () => resolve(); script.onerror = () => reject(new Error("Could not load Razorpay Checkout.")); document.body.appendChild(script);
        });
      }
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const checkout = new Razorpay({
        key: body.keyId, amount: body.amount, currency: body.currency, name: body.name, description: body.description, order_id: body.orderId, prefill: body.prefill,
        theme: { color: "#c9f36b" },
        handler: async (payment: Record<string, string>) => {
          const verify = await fetch("/api/billing/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payment) });
          const result = await verify.json();
          if (!verify.ok) { setError(result.error || "Payment verification failed."); return; }
          setNotice("Payment verified. Your plan is now active."); await refresh();
        },
        modal: { ondismiss: () => setNotice("Checkout closed. Your plan has not changed.") },
      });
      checkout.open();
    } catch (e) { setError(e instanceof Error ? e.message : "Checkout failed."); }
    finally { setBillingBusy(""); }
  }
  async function signOut() { await createClient().auth.signOut(); router.replace("/"); router.refresh(); }

  const activeKeys = keys.filter(k => !k.revoked_at).length;
  const currentPlan = plans.find(p => p.slug === (account?.plan || "free")) || plans.find(p => p.slug === "free");
  const percent = account ? Math.min(100, Math.round(account.monthlyUsage / Math.max(1, account.monthlyLimit) * 100)) : 0;

  return <main className="platform-shell dashboard-shell">
    <nav className="platform-nav"><Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link><div className="dashboard-nav-right"><span className="account-email">{userEmail}</span><button className="quiet-button" onClick={signOut}><LogOut size={15}/> Sign out</button></div></nav>
    <div className="dashboard-heading"><div><span className="platform-eyebrow">DEVELOPER CONSOLE / OVERVIEW</span><h1>Your API.<br/><span>Your rules.</span></h1><p>Manage access, monitor quota, and configure your developer plan.</p></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh</button></div>
    {error && <div className="platform-alert error" role="alert">{error}</div>}{notice && <div className="platform-alert success"><Check size={16}/>{notice}</div>}
    {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={24}/> Loading developer account…</div> : <>
      <section className="stats-grid">
        <article className="stat-card"><span><Activity size={16}/> CURRENT PLAN</span><strong>{currentPlan?.name || "Free"}</strong><small>{account?.status === "active" ? "Subscription active" : "No paid subscription"}</small></article>
        <article className="stat-card"><span><Zap size={16}/> MONTHLY API CALLS</span><strong>{(account?.monthlyUsage || 0).toLocaleString("en-IN")}<em> / {(account?.monthlyLimit || currentPlan?.monthly_limit || 100).toLocaleString("en-IN")}</em></strong><div className="usage-track"><i style={{ width: `${percent}%` }}/></div><small>{Math.max(0, (account?.monthlyLimit || currentPlan?.monthly_limit || 100) - (account?.monthlyUsage || 0)).toLocaleString("en-IN")} requests remaining</small></article>
        <article className="stat-card"><span><KeyRound size={16}/> ACTIVE API KEYS</span><strong>{activeKeys}<em> / 10</em></strong><small>Revoke keys any time</small></article>
      </section>
      <section className="dashboard-section"><div className="dashboard-section-title"><div><span className="platform-eyebrow">01 / CREDENTIALS</span><h2>API keys</h2><p>Keys are hashed before storage. The secret is only shown once at creation.</p></div><span className="section-count">{activeKeys} ACTIVE</span></div>
        {newKey && <div className="new-key-panel"><div className="new-key-copy"><ShieldCheck size={18}/><div><strong>Copy your new key now</strong><p>Anyone with this key can use your API quota. Store it in a secret manager.</p></div></div><code>{newKey}</code><button className="submit" onClick={() => void copy(newKey)}><Copy size={15}/>{copied ? "Copied" : "Copy API key"}</button></div>}
        <form className="create-key-form" onSubmit={createKey}><div><label htmlFor="key-name">KEY NAME</label><input id="key-name" value={keyName} onChange={e=>setKeyName(e.target.value)} placeholder="e.g. Discord bot, production app" maxLength={80} required/></div><button className="submit" disabled={creating || activeKeys >= 10}>{creating ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} Create key</button></form>
        <div className="key-list">{keys.length ? keys.map(key => <article className={`key-row ${key.revoked_at ? "revoked" : ""}`} key={key.id}><div className="key-row-icon"><KeyRound size={17}/></div><div className="key-row-main"><strong>{key.name}</strong><code>{key.key_prefix}••••••••••••</code><small>Created {new Date(key.created_at).toLocaleDateString()} · {key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}` : "Never used"}</small></div><span className={key.revoked_at ? "status-pill muted" : "status-pill"}>{key.revoked_at ? "REVOKED" : "ACTIVE"}</span>{!key.revoked_at && <button className="icon-button danger-button" aria-label={`Revoke ${key.name}`} title="Revoke key" onClick={() => void revokeKey(key)}><Trash2 size={16}/></button>}</article>) : <div className="empty-state"><KeyRound size={22}/><strong>No API keys yet</strong><p>Create your first key to authenticate requests to the lookup API.</p></div>}</div>
        <div className="code-example"><div><span className="platform-eyebrow">QUICK START</span><strong>Use your key in a request</strong></div><pre>{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : "https://your-domain"} /api/lookup \\\n  -H "Authorization: Bearer YOUR_EIDREN_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"playerId":"123456789","zoneId":"1234"}'`}</pre><button className="quiet-button" onClick={() => void copy(`curl -X POST ${window.location.origin}/api/lookup -H "Authorization: Bearer YOUR_EIDREN_API_KEY" -H "Content-Type: application/json" -d '{"playerId":"123456789","zoneId":"1234"}'`)}><Copy size={14}/> Copy example</button></div>
      </section>
      <section className="dashboard-section"><div className="dashboard-section-title"><div><span className="platform-eyebrow">02 / SUBSCRIPTION</span><h2>Plans and billing</h2><p>Start on Free. Paid prices remain disabled until you configure them.</p></div><CreditCard size={22} className="title-icon"/></div>
        <div className="plans-grid">{plans.map((plan) => <article className={`plan-card ${plan.slug === (account?.plan || "free") ? "selected" : ""}`} key={plan.slug}>{plan.slug === (account?.plan || "free") && <span className="plan-current">CURRENT PLAN</span>}<div className="plan-title"><h3>{plan.name}</h3><p>{plan.description}</p></div><div className="plan-price">{plan.price_paise > 0 ? <><strong>₹{(plan.price_paise / 100).toLocaleString("en-IN")}</strong><span>/ month</span></> : <><strong>Free</strong><span>forever</span></>}</div><ul><li><Check size={15}/> {plan.monthly_limit.toLocaleString("en-IN")} API calls / month</li><li><Check size={15}/> API key management</li><li><Check size={15}/> Usage visibility</li></ul>{plan.slug === (account?.plan || "free") ? <button className="plan-button current" disabled>Current plan</button> : plan.slug === "free" ? <button className="plan-button" disabled>Included</button> : <button className="plan-button" disabled={billingBusy === plan.slug || !plan.enabled} onClick={() => void upgrade(plan)}>{billingBusy === plan.slug ? <LoaderCircle size={15} className="spin"/> : <ArrowRight size={15}/>} {plan.enabled ? "Upgrade with Razorpay" : "Price not configured"}</button>}</article>)}</div>
        <div className="billing-note"><CircleHelp size={17}/><p><strong>Billing setup:</strong> Paid checkout is only enabled after Razorpay credentials are configured and a paid plan is enabled with a price in Supabase. Webhook events are signature-verified.</p></div>
      </section>
      <section className="docs-strip"><div><ArrowDownRight size={18}/><div><strong>Ready to integrate?</strong><p>Use the API key in the Authorization header. Never embed it in frontend JavaScript.</p></div></div><Link href="/">Open public lookup <ArrowRight size={15}/></Link></section>
    </>}
    <footer className="platform-footer"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>KEYS HASHED AT REST · RAZORPAY SIGNATURE VERIFIED</span></footer>
  </main>;
}
