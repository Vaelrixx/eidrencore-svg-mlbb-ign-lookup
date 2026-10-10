import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PROVIDERS = new Set(["google", "github", "discord"]);
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const url = new URL(request.url);
  const { provider } = await context.params;
  if (!PROVIDERS.has(provider)) return NextResponse.redirect(new URL("/login?error=oauth_callback_failed", url.origin));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as "google" | "github" | "discord",
    options: { redirectTo: `${url.origin}/auth/callback?next=/dashboard` },
  });
  if (error || !data.url) return NextResponse.redirect(new URL("/login?error=oauth_callback_failed", url.origin));
  return NextResponse.redirect(data.url);
}
