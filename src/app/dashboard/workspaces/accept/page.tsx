"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Users } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

export default function AcceptWorkspaceInvitePage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setToken(new URLSearchParams(window.location.search).get("token") || ""), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function accept() {
    if (!token) { setError("Invitation token is missing."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspaces/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const body = await response.json();
      if (response.status === 401) { router.replace("/login?next=" + encodeURIComponent(window.location.pathname + window.location.search)); return; }
      if (!response.ok) throw new Error(body.error || "Could not accept invitation.");
      setNotice("You joined the workspace successfully."); router.replace("/dashboard/workspaces");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not accept invitation."); }
    finally { setBusy(false); }
  }
  return <ConsoleFrame>
    {error && <div className="platform-alert error" role="alert">{error}</div>}
    {notice && <div className="platform-alert success"><Check size={15}/>{notice}</div>}
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">TEAM INVITATION</span><h2>Join a workspace</h2><p>Sign in with the email address that received this invitation, then accept it.</p></div><span className="console-big-icon"><Users size={20}/></span></div>
      {!token ? <div className="loading-panel"><LoaderCircle className="spin" size={18}/> Reading invitation link…</div> : <><div className="security-note"><Users size={16}/><p>Invitation tokens are single-use, expire after 7 days, and are bound to the invited email address.</p></div><button className="submit" onClick={() => void accept()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>} Accept invitation</button></>}
    </section>
  </ConsoleFrame>;
}
