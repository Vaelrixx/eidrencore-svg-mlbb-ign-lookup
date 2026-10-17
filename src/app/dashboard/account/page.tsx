"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Fingerprint, Gamepad2, LoaderCircle, LockKeyhole, LogOut, Mail, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

type AccountInfo = { user: { id: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; provider: string; emailConfirmedAt: string | null }; session: { authenticated: boolean; expiresAt: string | null } };
type HokProfile = { game_uid: string; nickname: string; icon: string | null; grade: number | null; score: number | null; world_id: number | null; consented_at: string; updated_at: string };

export default function AccountPage() {
  const router = useRouter();
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hokProfile, setHokProfile] = useState<HokProfile | null>(null);
  const [hokLink, setHokLink] = useState("");
  const [hokAttested, setHokAttested] = useState(false);
  const [hokLoading, setHokLoading] = useState(true);
  const [hokBusy, setHokBusy] = useState(false);
  const [hokError, setHokError] = useState("");
  const [hokNotice, setHokNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [response, hokResponse] = await Promise.all([
        fetch("/api/account", { cache: "no-store" }),
        fetch("/api/account/hok-profile", { cache: "no-store" }),
      ]);
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=/dashboard/account"); return; }
      if (!response.ok) throw new Error(body.error || "Could not load account information.");
      setInfo(body);
      if (hokResponse.status === 401) { router.replace("/login?next=/dashboard/account"); return; }
      const hokBody = await hokResponse.json();
      if (!hokResponse.ok) setHokError(hokBody.error || "Could not load your HoK import.");
      else setHokProfile(hokBody.profile);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load account information."); }
    finally { setLoading(false); setHokLoading(false); }
  }, [router]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    if (password !== confirm) { setError("The new passwords do not match."); return; }
    setBusy("password");
    try {
      const response = await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update password.");
      setPassword(""); setConfirm(""); setNotice("Password updated successfully.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update password."); }
    finally { setBusy(""); }
  }

  async function revokeSessions() {
    if (!window.confirm("Sign out this account from all active sessions? You will need to sign in again on this device.")) return;
    setBusy("sessions"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signout_all" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not revoke sessions.");
      router.replace("/login?notice=sessions_revoked"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not revoke sessions."); setBusy(""); }
  }

  async function importHokProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setHokError(""); setHokNotice(""); setHokBusy(true);
    try {
      const response = await fetch("/api/account/hok-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: hokLink, selfAttested: hokAttested }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not import this Camp link.");
      setHokProfile(body.profile); setHokLink(""); setHokAttested(false);
      setHokNotice("Camp snapshot imported. It is self-attested and has not been verified with HoK.");
    } catch (e) { setHokError(e instanceof Error ? e.message : "Could not import this Camp link."); }
    finally { setHokBusy(false); }
  }

  async function removeHokProfile() {
    if (!window.confirm("Remove this HoK snapshot from your Eidren account?")) return;
    setHokError(""); setHokNotice(""); setHokBusy(true);
    try {
      const response = await fetch("/api/account/hok-profile", { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not remove the HoK import.");
      setHokProfile(null); setHokNotice("HoK snapshot removed from your Eidren account.");
    } catch (e) { setHokError(e instanceof Error ? e.message : "Could not remove the HoK import."); }
    finally { setHokBusy(false); }
  }

  const user = info?.user;
  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    {notice && <div className="platform-alert success"><Check size={16}/>{notice}</div>}
    {loading && !info ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading account security…</div> : info && <>
      <section className="console-panel">
        <div className="console-panel-heading"><div><span className="platform-eyebrow">IDENTITY</span><h2>Account profile</h2><p>Your account details and authentication provider.</p></div><span className="console-big-icon"><UserRound size={20}/></span></div>
        <div className="account-profile"><span className="account-avatar"><UserRound size={24}/></span><div className="account-profile-main"><strong>{user?.email || "Telegram account"}</strong><span>{user?.emailConfirmedAt ? "Email confirmed" : user?.email ? "Email confirmation status unavailable" : "No email supplied by sign-in provider"}</span></div><span className="status-pill">{user?.provider.toUpperCase()}</span></div>
        <div className="account-details-grid"><div><span>USER ID</span><code>{user?.id}</code></div><div><span>ACCOUNT CREATED</span><strong>{user?.createdAt ? new Date(user.createdAt).toLocaleString() : "Unavailable"}</strong></div><div><span>LAST SIGN-IN</span><strong>{user?.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : "Unavailable"}</strong></div></div>
      </section>
      <section className="console-panel hok-profile-panel">
        <div className="console-panel-heading"><div><span className="platform-eyebrow">HONOR OF KINGS</span><h2>Your Camp snapshot</h2><p>Import the profile details embedded in your own Camp friend-invite link.</p></div><span className="console-big-icon"><Gamepad2 size={20}/></span></div>
        <div className="hok-profile-warning" role="note"><ShieldCheck size={17}/><p>This is a self-attested snapshot, not verified ownership or a live HoK lookup. Camp invite links can be shared. Eidren reads the UID, nickname and optional stats from the link and does not contact Camp or HoK.</p></div>
        {hokError && <div className="platform-alert error" role="alert">{hokError}</div>}
        {hokNotice && <div className="platform-alert success" role="status"><Check size={16}/>{hokNotice}</div>}
        {hokLoading ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Loading saved snapshot…</div> : hokProfile ? <div className="hok-profile-snapshot">
          <div className="hok-profile-snapshot-head"><div><span className="status-pill">SELF-ATTESTED · NOT VERIFIED</span><h3>{hokProfile.nickname}</h3><p>Game UID <code>{hokProfile.game_uid}</code></p></div><button type="button" className="console-danger-action" onClick={() => void removeHokProfile()} disabled={hokBusy}><Trash2 size={15}/>{hokBusy ? "Removing…" : "Remove snapshot"}</button></div>
          <dl className="hok-profile-fields"><div><dt>World ID</dt><dd>{hokProfile.world_id ?? "Not included"}</dd></div><div><dt>Grade</dt><dd>{hokProfile.grade ?? "Not included"}</dd></div><div><dt>Score</dt><dd>{hokProfile.score ?? "Not included"}</dd></div><div><dt>Camp icon</dt><dd>{hokProfile.icon ?? "Not included"}</dd></div><div><dt>Imported</dt><dd>{new Date(hokProfile.consented_at).toLocaleString()}</dd></div></dl>
        </div> : <form className="hok-import-form" onSubmit={importHokProfile}>
          <label htmlFor="hok-camp-link">Camp friend-invite link<small>Copy the full Camp link generated by your HoK profile’s friend-invite or share action.</small><textarea id="hok-camp-link" value={hokLink} onChange={event => setHokLink(event.target.value)} maxLength={4096} rows={3} placeholder="Paste the full link generated from your HoK profile" required/></label>
          <label className="hok-attestation"><input type="checkbox" checked={hokAttested} onChange={event => setHokAttested(event.target.checked)} required/><span>I confirm this invite link is for my own Honor of Kings account. I understand Eidren cannot verify ownership and only imports the snapshot embedded in this link.</span></label>
          <button className="submit" type="submit" disabled={hokBusy || !hokAttested}>{hokBusy ? <><LoaderCircle className="spin" size={15}/> Importing…</> : <><Gamepad2 size={15}/> Import my Camp snapshot</>}</button>
        </form>}
      </section>
      <section className="console-panel">
        <div className="console-panel-heading"><div><span className="platform-eyebrow">SESSION STATUS</span><h2>This browser session</h2><p>Session data is validated server-side using your authenticated Supabase user.</p></div><span className="console-big-icon"><Fingerprint size={20}/></span></div>
        <div className="session-status-card"><span className="session-status-icon"><ShieldCheck size={21}/></span><div><strong>{info.session.authenticated ? "Authenticated session active" : "No active session"}</strong><p>{info.session.expiresAt ? `Session token expires ${new Date(info.session.expiresAt).toLocaleString()} unless refreshed.` : "Session expiry is managed by the authentication provider."}</p></div><span className="status-pill">{info.session.authenticated ? "ACTIVE" : "SIGNED OUT"}</span></div>
        <div className="security-note"><AlertTriangle size={16}/><p>This view shows the current browser session. A list of every device/session is not exposed by this app yet; use “Revoke all sessions” to invalidate all sessions supported by your authentication provider.</p></div>
        <button className="console-danger-action" onClick={() => void revokeSessions()} disabled={busy === "sessions"}>{busy === "sessions" ? <LoaderCircle className="spin" size={15}/> : <LogOut size={15}/>} Revoke all sessions</button>
      </section>
      <section className="console-panel">
        <div className="console-panel-heading"><div><span className="platform-eyebrow">CREDENTIAL HYGIENE</span><h2>Change password</h2><p>Available for accounts that support password authentication. OAuth-only accounts may not have a password.</p></div><span className="console-big-icon"><LockKeyhole size={20}/></span></div>
        <form className="console-password-form" onSubmit={updatePassword}><label>NEW PASSWORD<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters, unique to Eidren" required/></label><label>CONFIRM NEW PASSWORD<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Repeat your new password" required/></label><p className="console-hint" role="note">Use mixed case, numbers, and symbols. Prefer a password manager — never reuse a password from another site.</p><button className="submit" type="submit" disabled={busy === "password"}>{busy === "password" ? <><LoaderCircle className="spin" size={15}/> Updating…</> : <><LockKeyhole size={15}/> Update password</>}</button></form>
      </section>
      <section className="console-callout"><Mail size={18}/><div><strong>Account recovery</strong><p>Keep access to the email or identity provider you used to sign in. Telegram-only accounts may not have a recoverable email address.</p></div></section>
    </>}
  </ConsoleFrame>;
}
