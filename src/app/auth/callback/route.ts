import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = getPublicAppOrigin(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const target = next ? new URL(next, origin) : new URL("/dashboard", origin);
      if (target.origin !== origin) return NextResponse.redirect(new URL("/dashboard", origin));
      return NextResponse.redirect(target);
    }
  }
  return NextResponse.redirect(new URL("/login?error=oauth_callback_failed", origin));
}
