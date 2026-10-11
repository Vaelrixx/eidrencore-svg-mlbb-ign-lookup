import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-origin";
import { ensureDeveloperAccount, safeNextPath } from "@/lib/platform";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!["signin", "signup"].includes(action) || !email || password.length < 8) return NextResponse.json({ error: "Enter a valid email and a password of at least 8 characters." }, { status: 400 });
  const supabase = await createClient();
  if (action === "signin") {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return NextResponse.json({ error: error.message }, { status: 401 });
    if (data.user) await ensureDeveloperAccount(data.user.id);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const origin = getPublicAppOrigin(request.url);
  const next = safeNextPath(body?.next);
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` } });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (data.user) await ensureDeveloperAccount(data.user.id);
  if (!data.session) return NextResponse.json({ success: true, needsConfirmation: true }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
