"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleDollarSign, CreditCard, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Zap, CalendarClock, Ban } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type Plan = { slug: string; name: string; price_paise: number; monthly_limit: number; enabled: boolean; description: string };
type Account = {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  monthlyUsage: number;
  monthlyLimit: number;
  hasRecurringSubscription: boolean;
  cancelAtCycleEnd: boolean;
  checkoutPending: boolean;
  pendingPlan: string | null;
  pendingKind: "subscription" | "one_time" | "plan_change" | null;
  lastPaymentAt: string | null;
};
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; } }

const formatPrice = (paise: number) => paise === 0 ? "Free" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const formatDate = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : null;

export default function BillingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [recurringConfigured, setRecurringConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [plansResponse, accountResponse] = await Promise.all([
        fetch("/api/billing/plans", { cache: "no-store" }),
        fetch("/api/billing/me", { cache: "no-store" }),
      ]);
      const plansBody = await plansResponse.json();
      const accountBody = await accountResponse.json();
      if (accountResponse.status === 401) { router.replace("/login?next=/dashboard/billing"); return; }
      if (!plansResponse.ok) throw new Error(plansBody.error || "Could not load plans.");
      if (!accountResponse.ok) throw new Error(accountBody.error || "Could not load billing information.");
      setPlans(plansBody.plans || []);
      setRecurringConfigured(plansBody.recurringConfigured === true);
      setAccount(accountBody as Account);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load billing information."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function ensureRazorpayCheckout() {
    if (window.Razorpay) return window.Razorpay;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
      document.body.appendChild(script);
    });
    if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
    return window.Razorpay;
  }

  async function upgrade(plan: Plan) {
    setBusy(plan.slug); setError(""); setNotice("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.slug }),
      });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/billing"); return; }
      if (!response.ok) throw new Error(body.error || "Could not start checkout.");

      if (body.mode === "already_active") {
        setNotice("You're already subscribed to this plan.");
        await refresh();
        return;
      }
      if (body.mode === "plan_change_pending") {
        setNotice("A change to this plan is already scheduled for the end of your billing period.");
        await refresh();
        return;
      }
      if (body.mode === "plan_change_scheduled") {
        setNotice("Plan change scheduled for the end of your current billing period. Your current tier remains active until then.");
        await refresh();
        return;
      }

      const Razorpay = await ensureRazorpayCheckout();
      const checkoutCompleted = { current: false };
      const options: Record<string, unknown> = {
        key: body.keyId,
        name: body.name || "Eidren Developer Platform",
        description: body.description,
        prefill: body.prefill,
        theme: { color: "#7c8cff" },
        handler: async (payment: Record<string, string>) => {
          try {
            const verify = await fetch("/api/billing/verify", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payment),
            });
            const result = await verify.json();
            if (!verify.ok) { setError(result.error || "Payment verification failed."); return; }
            checkoutCompleted.current = true;
            setNotice(result.activated === false
              ? result.message || "Authorization verified. Waiting for Razorpay to confirm activation."
              : result.duplicate
                ? "Subscription is already active."
                : body.mode === "one_time"
                  ? "Payment verified. Your plan is active."
                  : "Subscription authorization verified. Your plan will activate after Razorpay confirms it.");
            await refresh();
          } catch { setError("Could not verify checkout. Refresh billing before trying again."); }
        },
        modal: { ondismiss: () => { if (!checkoutCompleted.current) setNotice("Checkout closed. Your plan has not changed."); } },
      };
      if (body.mode === "one_time") {
        options.order_id = body.orderId;
        options.amount = body.amount;
        options.currency = body.currency;
      } else if (body.mode === "subscription") {
        options.subscription_id = body.subscriptionId;
      } else {
        throw new Error("The server returned an unsupported checkout mode.");
      }
      const checkout = new Razorpay(options);
      checkout.open();
    } catch (e) { setError(e instanceof Error ? e.message : "Checkout failed."); }
    finally { setBusy(""); }
  }

  async function cancelSubscription() {
    const cancelPendingSetup = Boolean(account?.checkoutPending && account.pendingKind === "subscription");
    if (!account || (!account.hasRecurringSubscription && !cancelPendingSetup) || (account.cancelAtCycleEnd && !cancelPendingSetup)) return;
    const end = formatDate(account.currentPeriodEnd);
    const message = cancelPendingSetup
      ? "Cancel this pending subscription setup? Any current paid plan will remain unchanged."
      : end
        ? "Cancel automatic renewal? Your current paid access remains available until " + end + "."
        : "Cancel this recurring subscription? This may end access immediately if no paid billing period remains.";
    if (!window.confirm(message)) return;
    setBusy("cancel"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/billing/cancel", { method: "POST" });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/billing"); return; }
      if (!response.ok) throw new Error(body.error || "Could not cancel subscription.");
      setNotice(body.pendingCheckout
        ? "Pending subscription setup cancelled. Your current paid access was left unchanged."
        : body.cancelAtCycleEnd
          ? "Automatic renewal is cancelled. Your paid access remains active until " + (formatDate(body.currentPeriodEnd) || "the end of the current period") + "."
          : "The recurring subscription has been cancelled.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not cancel subscription."); }
    finally { setBusy(""); }
  }

  const current = account?.plan || "free";
  const currentPlan = plans.find(plan => plan.slug === current);
  const currentPaidPeriod = current !== "free" && !!account?.currentPeriodEnd;
  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    {notice && <div className="platform-alert success" role="status"><Check size={16}/>{notice}</div>}
    <section className="billing-current-card">
      <div className="billing-current-icon"><CreditCard size={22}/></div>
      <div className="billing-current-main">
        <span className="platform-eyebrow">CURRENT SUBSCRIPTION</span>
        <h2>{currentPlan?.name || current} plan</h2>
        <p>
          {account?.cancelAtCycleEnd
            ? "Automatic renewal is cancelled. Paid access remains until " + (formatDate(account.currentPeriodEnd) || "the current period ends") + "."
            : account?.status === "past_due"
              ? "A renewal payment needs attention. Your paid access remains available until " + (formatDate(account.currentPeriodEnd) || "the current period ends") + "."
              : account?.status === "active" && account.currentPeriodEnd
                ? (account.hasRecurringSubscription ? "Automatically renews. Current period ends " : "Active until ") + formatDate(account.currentPeriodEnd) + "."
                : "Free access is active. Upgrade when your integration needs more capacity."}
        </p>
        {account?.checkoutPending && <p className="platform-alert">A billing action is pending{account.pendingPlan ? " for " + account.pendingPlan : ""}. Refresh billing in a moment before starting another checkout.</p>}
      </div>
      <div className="billing-current-usage">
        <strong>{(account?.monthlyUsage || 0).toLocaleString("en-IN")} <small>/ {(account?.monthlyLimit || 100).toLocaleString("en-IN")}</small></strong>
        <span>requests this month</span>
      </div>
    </section>

    {((account?.hasRecurringSubscription && !account.cancelAtCycleEnd) || (account?.checkoutPending && account.pendingKind === "subscription")) && <section className="console-callout">
      <CalendarClock size={19}/>
      <div style={{ flex: 1 }}>
        <strong>{account?.checkoutPending && account.pendingKind === "subscription" ? "Pending subscription setup" : "Manage automatic renewal"}</strong>
        <p>{account?.checkoutPending && account.pendingKind === "subscription"
          ? "A subscription is waiting for authorization or activation. Cancel setup here without cancelling any existing paid subscription."
          : "Cancel at the end of the current billing period. Your current paid access stays available until then; this does not issue a refund."}</p>
      </div>
      <button className="quiet-button" disabled={!!busy} onClick={() => void cancelSubscription()}>
        {busy === "cancel" ? <LoaderCircle size={14} className="spin"/> : <Ban size={14}/>} {account?.checkoutPending && account.pendingKind === "subscription" ? "Cancel setup" : "Cancel renewal"}
      </button>
    </section>}

    <div className="console-section-intro">
      <div><span className="platform-eyebrow">PLANS & LIMITS</span><h2>Scale with your traffic</h2><p>Paid plans renew monthly after authorizing the mandate with Razorpay. The plan is verified server-side before it grants access.</p></div>
      <button className="quiet-button" onClick={() => void refresh()} disabled={loading || !!busy}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh</button>
    </div>
    {loading && plans.length === 0 ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading plan catalog…</div> : <div className="plans-grid">{plans.map(plan => {
      const isCurrent = current === plan.slug;
      const isScheduledPlanChange = Boolean(account?.pendingKind === "plan_change" && account.pendingPlan === plan.slug);
      const canResumeCheckout = Boolean(account?.checkoutPending && account.pendingPlan === plan.slug && account.pendingKind !== "plan_change");
      const canSetRecurring = isCurrent && plan.slug !== "free" && currentPaidPeriod && !account?.hasRecurringSubscription && !account?.checkoutPending && recurringConfigured;
      const actionLabel = busy === plan.slug ? "Opening checkout…"
        : isScheduledPlanChange ? "Plan change scheduled"
          : canResumeCheckout ? "Continue checkout"
            : canSetRecurring ? "Set up automatic renewal"
            : isCurrent ? "Current plan"
            : !plan.enabled ? "Coming soon"
              : account?.cancelAtCycleEnd ? "Cancellation scheduled"
                : "Choose " + plan.name;
      return <article key={plan.slug} className={"plan-card console-plan-card" + (isCurrent ? " selected" : "")}>
        {isCurrent && <span className="plan-current">CURRENT PLAN</span>}
        <div className="plan-title"><h3>{plan.name}</h3><p>{plan.description}</p></div>
        <div className="plan-price"><strong>{formatPrice(plan.price_paise)}</strong><span>{plan.price_paise === 0 ? "/ forever" : isCurrent && !account?.hasRecurringSubscription ? "/ 30 days" : "/ month · recurring"}</span></div>
        <div className="billing-limit"><Zap size={15}/><strong>{plan.monthly_limit.toLocaleString("en-IN")}</strong><span>API calls / month</span></div>
        <ul><li><Check size={14}/> API key management</li><li><Check size={14}/> Server-side quota enforcement</li><li><Check size={14}/> Usage analytics</li><li><Check size={14}/> {plan.slug === "free" ? "Community support" : "Production workloads"}</li></ul>
        {isCurrent && !canSetRecurring && !canResumeCheckout
          ? <button className="plan-button current" disabled>{actionLabel}</button>
          : plan.slug === "free"
            ? <button className="plan-button" onClick={() => router.push("/dashboard/keys")}>Manage API keys</button>
            : <button className="plan-button" disabled={!plan.enabled || (!recurringConfigured && !canResumeCheckout) || !!busy || !!account?.cancelAtCycleEnd || (!!account?.checkoutPending && !canResumeCheckout)} onClick={() => void upgrade(plan)}>
                {busy === plan.slug ? <LoaderCircle className="spin" size={14}/> : <Sparkles size={14}/>} {actionLabel}
              </button>}
        {!plan.enabled && plan.slug !== "free" && <p className="plan-disabled-note">Not available for purchase yet.</p>}
      </article>;
    })}</div>}
    {!recurringConfigured && <div className="platform-alert" role="status">Recurring checkout is not fully configured by the platform operator yet. Paid subscriptions stay disabled until matching Razorpay monthly plan IDs and server credentials are configured.</div>}
    <section className="console-callout"><ShieldCheck size={19}/><div><strong>Secure recurring billing</strong><p>Razorpay confirms authorization and future charges through signed webhooks. A failed renewal keeps access through any already-paid period; entitlement falls back to Free when that period ends.</p></div></section>
    <section className="billing-history-note"><CircleDollarSign size={18}/><div><strong>Billing history</strong><p>Payment history and downloadable invoices are not available in this release. Your current plan, renewal state and billing period appear above.</p></div></section>
  </ConsoleFrame>;
}
