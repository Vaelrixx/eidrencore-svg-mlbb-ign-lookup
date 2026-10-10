"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Swords, Chrome, Github, MessageCircle, Send, LoaderCircle, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin"|"signup">("signin");
  async function social(provider: "google"|"github"|"discord") {
    setBusy(provider); setError("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` } });
      if (error) throw error;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start sign-in."); setBusy(""); }
  }
  async function emailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("email"); setError("");
    try {
      const supabase = createClient();
      const result = mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard` } });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) { setError("Check your email to confirm your account, then sign in."); setBusy(""); return; }
      const nextPath = new URLSearchParams(window.location.search).get("next"); router.push(nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Authentication failed."); }
    finally { setBusy(""); }
  }
  return <main className="platform-shell">
    <nav className="platform-nav"><Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link><Link className="back-link" href="/"><ArrowLeft size={15}/> Back to lookup</Link></nav>
    <section className="auth-layout"><div className="auth-intro"><span className="platform-eyebrow">DEVELOPER ACCESS / 01</span><h1>Build on the<br/><span>Land of Dawn.</span></h1><p>One account for your API keys, usage, plans, and billing.</p><div className="auth-points"><span>01 <b>Private API keys</b></span><span>02 <b>Usage and quota tracking</b></span><span>03 <b>Plan and billing controls</b></span></div></div>
      <div className="auth-card"><div className="auth-card-heading"><span className="auth-icon"><Swords size={19}/></span><div><h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2><p>{mode === "signin" ? "Sign in to open your developer console." : "Start with the free developer plan."}</p></div></div>
        <div className="social-grid">
          <button className="social-button" disabled={!!busy} onClick={() => social("google")}><Chrome size={17}/> Google</button>
          <button className="social-button" disabled={!!busy} onClick={() => social("github")}><Github size={17}/> GitHub</button>
          <button className="social-button" disabled={!!busy} onClick={() => social("discord")}><MessageCircle size={17}/> Discord</button>
          <button className="social-button" disabled={!!busy} onClick={() => { window.location.href="/api/auth/telegram"; }}><Send size={17}/> Telegram</button>
        </div>
        <div className="auth-or"><span/> OR CONTINUE WITH EMAIL <span/></div>
        <form className="auth-form" onSubmit={emailAuth}><label htmlFor="auth-email">EMAIL ADDRESS</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/><label htmlFor="auth-password">PASSWORD</label><input id="auth-password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" required/><button className="submit" disabled={!!busy} type="submit">{busy === "email" ? <><LoaderCircle className="spin" size={16}/> Please wait…</> : mode === "signin" ? "Sign in" : "Create account"}</button></form>
        {error && <p className="platform-error" role="alert">{error}</p>}
        <p className="auth-switch">{mode === "signin" ? "New to Eidren?" : "Already have an account?"} <button onClick={()=>{setMode(mode==="signin"?"signup":"signin");setError("");}}>{mode==="signin"?"Create an account":"Sign in"}</button></p>
        <p className="auth-legal">By continuing, you agree to use the unofficial MLBB community API responsibly. Never share your API key.</p>
      </div>
    </section><footer className="platform-footer"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>SECURE AUTHENTICATION · SERVER-SIDE KEYS</span></footer>
  </main>;
}
