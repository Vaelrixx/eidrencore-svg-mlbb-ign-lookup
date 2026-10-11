"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleDollarSign, CreditCard, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type Plan = { slug: string; name: string; price_paise: number; monthly_limit: number; enabled: boolean; description: string };
type Account = { plan: string; status: string; currentPeriodEnd: string | null; monthlyUsage: number; monthlyLimit: number };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; } }

const formatPrice = (paise: number) => paise === 0 ? "Free" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

export default function BillingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [plansResponse, accountResponse] = await Promise.all([fetch("/api/billing/plans", { cache: "no-store" }), fetch("/api/billing/me", { cache: "no-store" })]);
      const plansBody = await plansResponse.json(); const accountBody = await accountResponse.json();
      if (accountResponse.status === 401) { router.replace("/login?next=/dashboard/billing"); return; }
      if (!plansResponse.ok) throw new Error(plansBody.error || "Could not load plans.");
      setPlans(plansBody.plans || []); if (accountResponse.ok) setAccount(accountBody);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load billing information."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function upgrade(plan: Plan) {
    setBusy(plan.slug); setError(""); setNotice("");
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: plan.slug }) });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/billing"); return; }
      if (!response.ok) throw new Error(body.error || "Could not start checkout.");
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve(); script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
          document.body.appendChild(script);
        });
      }
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const checkout = new Razorpay({
        key: body.keyId, amount: body.amount, currency: body.currency, name: body.name, description: body.description, order_id: body.orderId, prefill: body.prefill,
        theme: { color: "#7c8cff" },
        handler: async (payment: Record<string, string>) => {
          const verify = await fetch("/api/billing/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payment) });
          const result = await verify.json();
          if (!verify.ok) { setError(result.error || "Payment verification failed."); return; }
          setNotice("Payment verified and your plan is active."); await refresh();
        },
        modal: { ondismiss: () => setNotice("Checkout closed. Your plan has not changed.") },
      });
      checkout.open();
    } catch (e) { setError(e instanceof Error ? e.message : "Checkout failed."); }
    finally { setBusy(""); }
  }

  const current = account?.plan || "free";
  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    {notice && <div className="platform-alert success"><Check size={16}/>{notice}</div>}
    <section className="billing-current-card"><div className="billing-current-icon"><CreditCard size={22}/></div><div className="billing-current-main"><span className="platform-eyebrow">CURRENT SUBSCRIPTION</span><h2>{plans.find(plan => plan.slug === current)?.name || current} plan</h2><p>{account?.status === "active" && account.currentPeriodEnd ? `Active until ${new Date(account.currentPeriodEnd).toLocaleDateString()}.` : "Free access is active. Upgrade whenever your integration needs more capacity."}</p></div><div className="billing-current-usage"><strong>{(account?.monthlyUsage || 0).toLocaleString("en-IN")} <small>/ {(account?.monthlyLimit || 100).toLocaleString("en-IN")}</small></strong><span>requests this month</span></div></section>
    <div className="console-section-intro"><div><span className="platform-eyebrow">PLANS & LIMITS</span><h2>Scale with your traffic</h2><p>Choose the quota that matches your application. Prices and limits are controlled by the database plan catalog.</p></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh</button></div>
    {loading && plans.length === 0 ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading plan catalog…</div> : <div className="plans-grid">{plans.map(plan => <article key={plan.slug} className={`plan-card console-plan-card ${current === plan.slug ? "selected" : ""}`}>{current === plan.slug && <span className="plan-current">CURRENT PLAN</span>}<div className="plan-title"><h3>{plan.name}</h3><p>{plan.description}</p></div><div className="plan-price"><strong>{formatPrice(plan.price_paise)}</strong><span>{plan.price_paise > 0 ? "/ 30 days" : "/ forever"}</span></div><div className="billing-limit"><Zap size={15}/><strong>{plan.monthly_limit.toLocaleString("en-IN")}</strong><span>API calls / month</span></div><ul><li><Check size={14}/> API key management</li><li><Check size={14}/> Server-side quota enforcement</li><li><Check size={14}/> Usage analytics</li><li><Check size={14}/> {plan.slug === "free" ? "Community support" : "Production workloads"}</li></ul>{current === plan.slug ? <button className="plan-button current" disabled>Current plan</button> : plan.slug === "free" ? <button className="plan-button" onClick={() => router.push("/dashboard/keys")}>Manage API keys</button> : <button className="plan-button" disabled={!plan.enabled || !!busy} onClick={() => void upgrade(plan)}>{busy === plan.slug ? <><LoaderCircle className="spin" size={14}/> Opening checkout…</> : <><Sparkles size={14}/> Upgrade to {plan.name}</>}</button>}{!plan.enabled && plan.slug !== "free" && <p className="plan-disabled-note">Not available for purchase yet.</p>}</article>)}</div>}
    <section className="console-callout"><ShieldCheck size={19}/><div><strong>Secure checkout and transparent billing</strong><p>Checkout is verified server-side against Razorpay's captured payment record. The current billing model grants a 30-day period after a one-time payment; it does not automatically renew. Test-mode keys should be verified before enabling live payments.</p></div></section>
    <section className="billing-history-note"><CircleDollarSign size={18}/><div><strong>Billing history</strong><p>Payment history and downloadable invoices are not available in this release. Your active plan and current period are shown above; successful checkout is verified before access is granted.</p></div></section>
  </ConsoleFrame>;
}
