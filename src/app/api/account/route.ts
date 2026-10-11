import { NextResponse } from "next/server";
import { requireUser } from "@/lib/platform";
import { passwordErrorMessage } from "@/lib/password-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, supabase } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data: { session } } = await supabase.auth.getSession();
  const provider = typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "email";
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      provider,
      emailConfirmedAt: user.email_confirmed_at ?? null,
    },
    session: {
      authenticated: true,
      expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const { user, supabase } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  // Same app-level baseline as signup: length, variety, and common-password
  // screening while Supabase breach-corpus checks remain Pro-only.
  const policyError = passwordErrorMessage(password, user.email ?? "");
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return NextResponse.json({ error: "Could not update password. Check whether this sign-in provider supports password credentials." }, { status: 400 });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user, supabase } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const body = await request.json().catch(() => null);
  if (body?.action !== "signout_all") return NextResponse.json({ error: "Unsupported account action." }, { status: 400 });
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) return NextResponse.json({ error: "Could not revoke active sessions. Please try again." }, { status: 500 });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
