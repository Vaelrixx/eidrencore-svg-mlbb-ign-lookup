import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-origin";
import { ensureDeveloperAccount, safeNextPath } from "@/lib/platform";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = getPublicAppOrigin(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) await ensureDeveloperAccount(data.user.id);
      const target = new URL(next, origin);
      if (target.origin !== origin) return NextResponse.redirect(new URL("/dashboard", origin));
      return NextResponse.redirect(target);
    }
  }
  return NextResponse.redirect(new URL("/login?error=oauth_callback_failed", origin));
}
