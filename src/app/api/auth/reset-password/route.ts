import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-origin";
import {
  AUTH_RECOVERY_MAX_REQUESTS,
  AUTH_RECOVERY_WINDOW_SECONDS,
  consumeAuthAttempt,
} from "../rate-limit.mjs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  // Recovery emails can be abused for spam and account enumeration. Keep the
  // same response shape, but throttle repeated requests per client address.
  const attempt = await consumeAuthAttempt(request, "auth:recovery", {
    windowSeconds: AUTH_RECOVERY_WINDOW_SECONDS,
    maxRequests: AUTH_RECOVERY_MAX_REQUESTS,
  });
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Too many recovery requests. Please wait before trying again." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, attempt.retryAfterSeconds)) } },
    );
  }
  const supabase = await createClient();
  const origin = getPublicAppOrigin(request.url);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  if (error) {
    // Avoid revealing whether the address is registered.
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
