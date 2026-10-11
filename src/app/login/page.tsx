"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Swords, Chrome, Github, MessageCircle, Send, LoaderCircle, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin"|"signup">("signin");
  const [notice, setNotice] = useState("");
  const nextParam = () => { const value = new URLSearchParams(window.location.search).get("next"); return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard"; };
  useEffect(() => { const timer = window.setTimeout(() => { const params = new URLSearchParams(window.location.search); if (params.get("mode") === "signup") setMode("signup"); const code = params.get("error"); const messages: Record<string,string> = { telegram_not_configured: "Telegram login needs its BotFather credentials configured.", telegram_auth_failed: "Telegram sign-in failed. Please try again.", telegram_token_failed: "Telegram could not verify the sign-in token.", telegram_claims_failed: "Telegram identity validation failed.", telegram_account_failed: "Could not prepare your Telegram account.", telegram_session_failed: "Could not start your secure session.", oauth_callback_failed: "Social sign-in failed. Check the provider configuration." }; if (code && messages[code]) setError(messages[code]); }, 0); return () => window.clearTimeout(timer); }, []);
  function social(provider: "google"|"github"|"discord") {
    setBusy(provider); setError("");
    window.location.href = `/api/auth/oauth/${provider}?next=${encodeURIComponent(nextParam())}`;
  }
  async function emailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("email"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode, email, password, next: nextParam() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Authentication failed.");
      if (body.needsConfirmation) { setNotice(`We sent a confirmation link to ${email}. Open it to activate your account and continue.`); setPassword(""); setBusy(""); return; }
      router.push(nextParam()); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Authentication failed."); }
    finally { setBusy(""); }
  }
  return <main className="platform-shell">
    <nav className="platform-nav"><Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link><Link className="back-link" href="/"><ArrowLeft size={15}/> Back to home</Link></nav>
    <section className="auth-layout"><div className="auth-intro"><span className="platform-eyebrow">DEVELOPER ACCESS / 01</span><h1>Create an account.<br/><span>Unlock the tools.</span></h1><p>Every Eidren tool runs on your account: the playground, your API keys, usage and billing. Sign-up is free.</p><div className="auth-points"><span>01 <b>Free API key, instantly</b></span><span>02 <b>Playground access</b></span><span>03 <b>Usage and quota tracking</b></span></div></div>
      <div className="auth-card"><div className="auth-card-heading"><span className="auth-icon"><Swords size={19}/></span><div><h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2><p>{mode === "signin" ? "Sign in to open your developer console." : "Free plan included: 100 API requests a month."}</p></div></div>
        <div className="social-grid">
          <button className="social-button" disabled={!!busy} onClick={() => social("google")}><Chrome size={17}/> Google</button>
          <button className="social-button" disabled={!!busy} onClick={() => social("github")}><Github size={17}/> GitHub</button>
          <button className="social-button" disabled={!!busy} onClick={() => social("discord")}><MessageCircle size={17}/> Discord</button>
          <button className="social-button" disabled={!!busy} onClick={() => { window.location.href="/api/auth/telegram"; }}><Send size={17}/> Telegram</button>
        </div>
        <div className="auth-or"><span/> OR CONTINUE WITH EMAIL <span/></div>
        <form className="auth-form" onSubmit={emailAuth}><label htmlFor="auth-email">EMAIL ADDRESS</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/><label htmlFor="auth-password">PASSWORD</label><input id="auth-password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" required/><button className="submit" disabled={!!busy} type="submit">{busy === "email" ? <><LoaderCircle className="spin" size={16}/> Please wait…</> : mode === "signin" ? "Sign in" : "Create account"}</button></form>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        {error && <p className="platform-error" role="alert">{error}</p>}
        {mode === "signin" && <div className="auth-recovery-link"><Link href="/forgot-password">Forgot your password?</Link></div>}
        <p className="auth-switch">{mode === "signin" ? "New to Eidren?" : "Already have an account?"} <button onClick={()=>{setMode(mode==="signin"?"signup":"signin");setError("");setNotice("");}}>{mode==="signin"?"Create an account":"Sign in"}</button></p>
        <p className="auth-legal">By continuing, you agree to use the unofficial MLBB community API responsibly. Never share your API key.</p>
      </div>
    </section><footer className="platform-footer"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>SECURE AUTHENTICATION · SERVER-SIDE KEYS</span></footer>
  </main>;
}
