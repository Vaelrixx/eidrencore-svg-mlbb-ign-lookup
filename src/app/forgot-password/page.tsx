"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, LoaderCircle, Mail, Swords } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not send recovery email.");
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send recovery email."); }
    finally { setBusy(false); }
  }
  return <main className="platform-shell"><nav className="platform-nav"><Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link><Link className="back-link" href="/login"><ArrowLeft size={15}/> Back to sign in</Link></nav><section className="auth-layout recovery-layout"><div className="auth-intro"><span className="platform-eyebrow">ACCOUNT RECOVERY / 01</span><h1>Get back<br/><span>in control.</span></h1><p>Request a secure password reset link. For safety, this page does not reveal whether an email is registered.</p></div><div className="auth-card"><div className="auth-card-heading"><span className="auth-icon"><Mail size={19}/></span><div><h2>{sent ? "Check your inbox" : "Reset your password"}</h2><p>{sent ? "If the account exists, a recovery email is on its way." : "We'll send a secure recovery link to your email."}</p></div></div>{sent ? <div className="platform-alert success"><Check size={16}/>If the address is registered and email delivery is configured, you should receive a recovery link shortly.</div> : <form className="auth-form" onSubmit={submit}><label htmlFor="recovery-email">EMAIL ADDRESS</label><input id="recovery-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required/><button className="submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={15}/> Sending…</> : "Send recovery link"}</button>{error && <p className="platform-error" role="alert">{error}</p>}</form>}<p className="auth-switch"><Link href="/login" className="docs-inline-link">Return to sign in</Link></p></div></section><footer className="platform-footer"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>SECURE ACCOUNT RECOVERY</span></footer></main>;
}
