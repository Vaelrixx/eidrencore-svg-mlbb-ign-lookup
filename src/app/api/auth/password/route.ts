import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-origin";
import { ensureDeveloperAccount, safeNextPath } from "@/lib/platform";
import { passwordErrorMessage } from "@/lib/password-policy.mjs";
import {
  AUTH_SIGNIN_MAX_REQUESTS,
  AUTH_SIGNIN_WINDOW_SECONDS,
  AUTH_SIGNUP_MAX_REQUESTS,
  AUTH_SIGNUP_WINDOW_SECONDS,
  consumeAuthAttempt,
} from "../rate-limit.mjs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!["signin", "signup"].includes(action) || !email) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  // Stricter than Supabase defaults: slow down password guessing and fake
  // signups per client address. Fails closed when the limiter is configured
  // but unreachable; fails open only when limiter secrets are not configured.
  const attempt = await consumeAuthAttempt(request, action === "signup" ? "auth:signup" : "auth:signin", {
    windowSeconds: action === "signup" ? AUTH_SIGNUP_WINDOW_SECONDS : AUTH_SIGNIN_WINDOW_SECONDS,
    maxRequests: action === "signup" ? AUTH_SIGNUP_MAX_REQUESTS : AUTH_SIGNIN_MAX_REQUESTS,
  });
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait before trying again." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, attempt.retryAfterSeconds)) } },
    );
  }
  if (action === "signup") {
    // Supabase's breach-corpus check needs Pro, so enforce the app-level
    // baseline (length, variety, common-password denylist) before creating
    // the account. Sign-in keeps accepting existing shorter passwords.
    const policyError = passwordErrorMessage(password, email);
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
  } else if (!password) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }
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
