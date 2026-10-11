"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, LoaderCircle, Swords } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This recovery link may have expired. Request a new one.");
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reset password."); }
    finally { setBusy(false); }
  }
  return <main className="platform-shell"><nav className="platform-nav"><Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link></nav><section className="auth-layout recovery-layout"><div className="auth-intro"><span className="platform-eyebrow">ACCOUNT RECOVERY / 02</span><h1>Secure your<br/><span>account.</span></h1><p>Choose a strong password you do not reuse on other services.</p></div><div className="auth-card"><div className="auth-card-heading"><span className="auth-icon"><KeyRound size={19}/></span><div><h2>{done ? "Password updated" : "Choose a new password"}</h2><p>{done ? "Your new password is saved." : "Use at least 12 characters."}</p></div></div>{done ? <><div className="platform-alert success"><Check size={16}/>Password updated successfully.</div><button className="submit" onClick={() => { router.replace("/dashboard"); router.refresh(); }}>Continue to dashboard</button></> : <form className="auth-form" onSubmit={submit}><label htmlFor="new-password">NEW PASSWORD</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters, unique to Eidren" required/><p className="auth-hint" role="note">Use mixed case, numbers, and symbols. Prefer a password manager — never reuse a password from another site.</p><label htmlFor="confirm-password">CONFIRM PASSWORD</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={event => setConfirm(event.target.value)} required/><button className="submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={15}/> Saving…</> : "Update password"}</button>{error && <p className="platform-error" role="alert">{error}</p>}</form>}<p className="auth-switch"><Link href="/login" className="docs-inline-link">Back to sign in</Link></p></div></section><footer className="platform-footer"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>SECURE PASSWORD RESET</span></footer></main>;
}
