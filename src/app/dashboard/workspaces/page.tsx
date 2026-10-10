"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Copy, CreditCard, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type Workspace = { id: string; name: string; slug: string; owner_user_id: string; role: string; created_at: string };
type Member = { user_id: string; role: string; joined_at: string };
type Invite = { id: string; email: string; role: string; expires_at: string; created_at: string };
type WorkspaceKey = { id: string; name: string; key_prefix: string; plan_slug: string; created_at: string; last_used_at: string | null; revoked_at: string | null; user_id: string };
type WorkspacePlan = { slug: string; name: string; price_paise: number; monthly_limit: number; enabled: boolean; description: string };
type WorkspaceBilling = { subscription: { plan: string; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; checkoutPending: boolean; pendingPlan: string | null }; effectivePlan: string; monthlyUsage: number; monthlyLimit: number; plans: WorkspacePlan[]; currentRole: string };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; } }

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [workspaceKeys, setWorkspaceKeys] = useState<WorkspaceKey[]>([]);
  const [workspaceKeyName, setWorkspaceKeyName] = useState("Team integration");
  const [newWorkspaceKey, setNewWorkspaceKey] = useState("");
  const [workspaceBilling, setWorkspaceBilling] = useState<WorkspaceBilling | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/workspaces"); return; }
      if (!response.ok) throw new Error(body.error || "Could not load workspaces.");
      const list = (body.workspaces || []) as Workspace[];
      setWorkspaces(list);
      setSelectedId(current => list.some(item => item.id === current) ? current : (list[0]?.id || ""));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load workspaces."); }
    finally { setLoading(false); }
  }, [router]);

  const refreshMembers = useCallback(async () => {
    if (!selectedId) { setMembers([]); setInvites([]); return; }
    try {
      const response = await fetch("/api/workspaces/" + selectedId + "/members", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load members.");
      setMembers(body.members || []); setInvites(body.invites || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load members."); }
  }, [selectedId]);

  const refreshWorkspaceAssets = useCallback(async () => {
    if (!selectedId) { setWorkspaceKeys([]); setWorkspaceBilling(null); return; }
    setAssetsLoading(true);
    try {
      const [keyResponse, billingResponse] = await Promise.all([
        fetch("/api/workspaces/" + selectedId + "/keys", { cache: "no-store" }),
        fetch("/api/workspaces/" + selectedId + "/billing", { cache: "no-store" }),
      ]);
      const keyBody = await keyResponse.json();
      const billingBody = await billingResponse.json();
      if (keyResponse.ok) setWorkspaceKeys(keyBody.keys || []); else setWorkspaceKeys([]);
      if (billingResponse.ok) setWorkspaceBilling(billingBody as WorkspaceBilling); else setWorkspaceBilling(null);
    } catch { setError("Could not load workspace keys and billing."); }
    finally { setAssetsLoading(false); }
  }, [selectedId]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { const timer = window.setTimeout(() => { void refreshMembers(); }, 0); return () => window.clearTimeout(timer); }, [refreshMembers]);
  useEffect(() => { const timer = window.setTimeout(() => { void refreshWorkspaceAssets(); }, 0); return () => window.clearTimeout(timer); }, [refreshWorkspaceAssets]);

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("create"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create workspace.");
      setName(""); setNotice("Workspace created."); await refresh(); setSelectedId(body.workspace.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create workspace."); }
    finally { setBusy(""); }
  }

  async function inviteMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedId) return;
    setBusy("invite"); setError(""); setNotice(""); setInviteUrl("");
    try {
      const response = await fetch("/api/workspaces/" + selectedId + "/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create invitation.");
      setEmail(""); setInviteUrl(body.inviteUrl); setNotice("Invitation created. Copy the invite link and send it to the exact email address invited."); await refreshMembers();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not invite member."); }
    finally { setBusy(""); }
  }

  async function removeMember(member: Member) {
    if (!selectedId || !window.confirm("Remove this member from the workspace?")) return;
    setError("");
    const response = await fetch("/api/workspaces/" + selectedId + "/members", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.user_id }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Could not remove member."); return; }
    setNotice("Workspace member removed."); await refreshMembers();
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setError("Clipboard unavailable. Copy the link manually: " + value); }
  }

  async function createWorkspaceKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedId) return;
    setKeyBusy(true); setError(""); setNotice(""); setNewWorkspaceKey("");
    try {
      const response = await fetch("/api/workspaces/" + selectedId + "/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: workspaceKeyName }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create workspace key.");
      setNewWorkspaceKey(body.key); setWorkspaceKeyName(""); setNotice("Workspace API key created. Copy it now; the full secret will not be shown again.");
      await refreshWorkspaceAssets();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create workspace key."); }
    finally { setKeyBusy(false); }
  }

  async function revokeWorkspaceKey(key: WorkspaceKey) {
    if (!selectedId || !window.confirm("Revoke workspace API key " + key.name + "? Existing integrations using it will stop working.")) return;
    const response = await fetch("/api/workspaces/" + selectedId + "/keys/" + key.id, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Could not revoke workspace key."); return; }
    setNotice("Workspace API key revoked."); await refreshWorkspaceAssets();
  }

  async function upgradeWorkspace(plan: WorkspacePlan) {
    if (!selectedId) return;
    setBillingBusy(plan.slug); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspaces/" + selectedId + "/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: plan.slug }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not start workspace checkout.");
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
          const verify = await fetch("/api/workspaces/" + selectedId + "/billing/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payment) });
          const result = await verify.json();
          if (!verify.ok) { setError(result.error || "Workspace payment verification failed."); return; }
          setNotice("Workspace plan activated. Team API keys now use the shared plan quota."); await refreshWorkspaceAssets();
        },
        modal: { ondismiss: () => setNotice("Checkout closed. The workspace plan has not changed.") },
      });
      checkout.open();
    } catch (e) { setError(e instanceof Error ? e.message : "Workspace checkout failed."); }
    finally { setBillingBusy(""); }
  }

  const selected = workspaces.find(item => item.id === selectedId);
  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    {notice && <div className="platform-alert success"><Check size={15}/>{notice}</div>}
    <section className="console-panel">
      <div className="console-panel-heading"><div><span className="platform-eyebrow">TEAM COLLABORATION</span><h2>Workspaces</h2><p>Group your developer work by team. Invite members using an email-bound, expiring link.</p></div><span className="console-big-icon"><Building2 size={20}/></span></div>
      <form className="create-key-form" onSubmit={createWorkspace}><div><label htmlFor="workspace-name">NEW WORKSPACE NAME</label><input id="workspace-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Production team" minLength={2} maxLength={80} required/></div><button className="submit" disabled={busy === "create"}>{busy === "create" ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>} Create workspace</button></form>
      {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading workspaces…</div> : workspaces.length === 0 ? <div className="empty-state"><Users size={22}/><strong>No workspaces yet</strong><p>Create a workspace above to start inviting teammates.</p></div> : <div className="workspace-layout">
        <div className="workspace-picker">{workspaces.map(workspace => <button key={workspace.id} className={"workspace-picker-item" + (workspace.id === selectedId ? " active" : "")} onClick={() => setSelectedId(workspace.id)}><Building2 size={16}/><span><strong>{workspace.name}</strong><small>{workspace.slug} · {workspace.role}</small></span></button>)}</div>
        {selected && <div className="workspace-detail"><div className="workspace-detail-head"><div><h3>{selected.name}</h3><p>{selected.slug} · Created {new Date(selected.created_at).toLocaleDateString()}</p></div><span className="status-pill">{selected.role.toUpperCase()}</span></div>
          <div className="console-panel-heading compact-heading"><div><span className="platform-eyebrow">MEMBERS</span><h2>Team access</h2><p>{members.length} member(s), including the workspace owner.</p></div><span className="console-big-icon"><Users size={18}/></span></div>
          <div className="workspace-member-list">{members.map(member => <div className="workspace-member-row" key={member.user_id}><span className="key-row-icon"><Users size={15}/></span><div><strong>{member.user_id === selected.owner_user_id ? "Workspace owner" : "Team member"}</strong><code>{member.user_id}</code><small>{member.role} · Joined {new Date(member.joined_at).toLocaleDateString()}</small></div>{member.user_id !== selected.owner_user_id && (selected.role === "owner" || selected.role === "admin") && <button className="icon-button danger-button" title="Remove member" onClick={() => void removeMember(member)}><Trash2 size={15}/></button>}</div>)}</div>
          {(selected.role === "owner" || selected.role === "admin") && <><div className="console-panel-heading compact-heading"><div><span className="platform-eyebrow">INVITATIONS</span><h2>Invite teammate</h2><p>The recipient must sign in with the exact email address you enter.</p></div><span className="console-big-icon"><UserPlus size={18}/></span></div>
            <form className="create-key-form" onSubmit={inviteMember}><div><label htmlFor="invite-email">EMAIL ADDRESS</label><input id="invite-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@example.com" required/></div><div className="workspace-role-field"><label htmlFor="invite-role">ROLE</label><select id="invite-role" value={role} onChange={e => setRole(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select></div><button className="submit" disabled={busy === "invite"}>{busy === "invite" ? <LoaderCircle className="spin" size={15}/> : <UserPlus size={15}/>} Create invite</button></form>
            {inviteUrl && <div className="new-key-panel"><div className="new-key-copy"><ShieldCheck size={18}/><div><strong>Invitation link created</strong><p>Share privately. This link expires in 7 days and is single-use.</p></div></div><code>{inviteUrl}</code><button className="submit" onClick={() => void copy(inviteUrl)}><Copy size={15}/> Copy invitation link</button></div>}
            {invites.length > 0 && <div className="workspace-invites">{invites.map(invite => <div className="workspace-member-row" key={invite.id}><span className="key-row-icon"><UserPlus size={15}/></span><div><strong>{invite.email}</strong><small>{invite.role} · Expires {new Date(invite.expires_at).toLocaleDateString()}</small></div><span className="status-pill muted">PENDING</span></div>)}</div>}
          </>}
          <div className="console-panel-heading compact-heading"><div><span className="platform-eyebrow">SHARED ACCESS</span><h2>Workspace API keys</h2><p>Keys created here use the workspace subscription and shared quota, rather than an individual member's plan.</p></div><span className="console-big-icon"><KeyRound size={18}/></span></div>
          {(selected.role === "owner" || selected.role === "admin") && <form className="create-key-form" onSubmit={createWorkspaceKey}><div><label htmlFor="workspace-key-name">KEY NAME</label><input id="workspace-key-name" value={workspaceKeyName} onChange={e => setWorkspaceKeyName(e.target.value)} minLength={2} maxLength={80} placeholder="Team integration" required/></div><button className="submit" disabled={keyBusy || assetsLoading}>{keyBusy ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>} Create workspace key</button></form>}
          {newWorkspaceKey && <div className="new-key-panel"><div className="new-key-copy"><ShieldCheck size={18}/><div><strong>Copy your workspace API key</strong><p>This secret is shown once. Store it in your server's secret manager, never in browser code.</p></div></div><code>{newWorkspaceKey}</code><button className="submit" onClick={() => void copy(newWorkspaceKey)}><Copy size={15}/> Copy API key</button></div>}
          {assetsLoading ? <div className="loading-panel"><LoaderCircle className="spin" size={16}/> Loading workspace resources…</div> : workspaceKeys.length === 0 ? <div className="empty-state compact"><KeyRound size={19}/><strong>No workspace API keys</strong><p>Create a shared key for a team service or integration.</p></div> : <div className="workspace-member-list">{workspaceKeys.map(key => <div className="workspace-member-row" key={key.id}><span className="key-row-icon"><KeyRound size={15}/></span><div><strong>{key.name}</strong><code>{key.key_prefix}••••••••</code><small>{key.plan_slug.toUpperCase()} · {key.last_used_at ? "Last used " + new Date(key.last_used_at).toLocaleString() : "Not used yet"} · Created {new Date(key.created_at).toLocaleDateString()}</small></div><span className={"status-pill" + (key.revoked_at ? " muted" : "")}>{key.revoked_at ? "REVOKED" : "ACTIVE"}</span>{!key.revoked_at && (selected.role === "owner" || selected.role === "admin") && <button className="icon-button danger-button" title="Revoke workspace API key" onClick={() => void revokeWorkspaceKey(key)}><Trash2 size={15}/></button>}</div>)}</div>}
          {workspaceBilling && (selected.role === "owner" || selected.role === "admin") && <><div className="console-panel-heading compact-heading"><div><span className="platform-eyebrow">TEAM BILLING</span><h2>Shared subscription</h2><p>One plan and monthly quota for workspace-scoped API keys.</p></div><span className="console-big-icon"><CreditCard size={18}/></span></div>
            <div className="workspace-detail"><div className="workspace-detail-head"><div><h3>{workspaceBilling.effectivePlan.toUpperCase()} plan</h3><p>{workspaceBilling.monthlyUsage.toLocaleString("en-IN")} / {workspaceBilling.monthlyLimit.toLocaleString("en-IN")} API calls this month · {workspaceBilling.subscription.currentPeriodEnd ? "Period ends " + new Date(workspaceBilling.subscription.currentPeriodEnd).toLocaleDateString() : "No paid workspace period is active."}</p></div><span className="status-pill">{workspaceBilling.subscription.status.toUpperCase()}</span></div>
              {workspaceBilling.subscription.checkoutPending && <p className="platform-alert">Checkout pending for {workspaceBilling.subscription.pendingPlan}. Finish payment or wait for the pending order to expire.</p>}
              <div className="plans-grid">{workspaceBilling.plans.filter(plan => plan.enabled && plan.slug !== "free").map(plan => <article className="plan-card" key={plan.slug}><span className="platform-eyebrow">{plan.name.toUpperCase()}</span><h3>₹{(plan.price_paise / 100).toLocaleString("en-IN")}<small> / 30 days</small></h3><p>{plan.monthly_limit.toLocaleString("en-IN")} shared API calls per month</p><button className="submit" disabled={!!billingBusy || (workspaceBilling.subscription.checkoutPending && workspaceBilling.subscription.pendingPlan !== plan.slug)} onClick={() => void upgradeWorkspace(plan)}>{billingBusy === plan.slug ? <LoaderCircle className="spin" size={14}/> : <CreditCard size={14}/>} {workspaceBilling.subscription.checkoutPending && workspaceBilling.subscription.pendingPlan === plan.slug ? "Continue checkout" : workspaceBilling.effectivePlan === plan.slug ? "Renew / extend" : "Choose " + plan.name}</button></article>)}</div>
            </div>
          </>}
        </div>}
      </div>}
      <div className="security-note"><ShieldCheck size={16}/><p>Workspace-scoped keys are shared with teammates who can access the secret. Only workspace owners and admins can create or revoke them and manage the shared subscription. Store keys only in trusted server-side secret storage.</p></div>
    </section>
    <div className="console-callout"><RefreshCw size={17}/><div><strong>Invitation delivery</strong><p>Automatic email delivery is not configured in this release. Copy the one-time invite URL and send it through your team's trusted channel.</p></div></div>
  </ConsoleFrame>;
}
