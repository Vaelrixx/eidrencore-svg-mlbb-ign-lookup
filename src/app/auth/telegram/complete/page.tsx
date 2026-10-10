"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Swords, LoaderCircle } from "lucide-react";

export default function TelegramCompletePage() {
  const router = useRouter();
  const [message, setMessage] = useState("Verifying your Telegram sign-in…");
  useEffect(() => {
    let active = true;
    async function complete() {
      const query = new URLSearchParams(window.location.search);
      const tokenHash = query.get("token_hash");
      if (!tokenHash || query.get("type") !== "magiclink") { setMessage("This sign-in link is missing or expired."); return; }
      const { error } = await createClient().auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (error) { if (active) setMessage("Telegram sign-in could not be completed. Please try again."); return; }
      if (active) { router.replace("/dashboard"); router.refresh(); }
    }
    void complete();
    return () => { active = false; };
  }, [router]);
  return <main className="platform-shell"><nav className="platform-nav"><Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link></nav><section className="auth-layout"><div className="auth-card telegram-complete"><LoaderCircle className="spin" size={25}/><h2>Telegram sign-in</h2><p>{message}</p><Link className="back-link" href="/login">Return to login</Link></div></section></main>;
}
