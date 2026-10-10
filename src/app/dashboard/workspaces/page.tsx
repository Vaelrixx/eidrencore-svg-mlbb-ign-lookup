"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Copy, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type Workspace = { id: string; name: string; slug: string; owner_user_id: string; role: string; created_at: string };
type Member = { user_id: string; role: string; joined_at: string };
type Invite = { id: string; email: string; role: string; expires_at: string; created_at: string };

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

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { const timer = window.setTimeout(() => { void refreshMembers(); }, 0); return () => window.clearTimeout(timer); }, [refreshMembers]);

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
        </div>}
      </div>}
      <div className="security-note"><ShieldCheck size={16}/><p>Workspace membership is currently a collaboration and access-management layer. Existing API keys remain owned by the account that created them; workspace-wide key ownership and shared billing are not yet enabled.</p></div>
    </section>
    <div className="console-callout"><RefreshCw size={17}/><div><strong>Invitation delivery</strong><p>Automatic email delivery is not configured in this release. Copy the one-time invite URL and send it through your team's trusted channel.</p></div></div>
  </ConsoleFrame>;
}
