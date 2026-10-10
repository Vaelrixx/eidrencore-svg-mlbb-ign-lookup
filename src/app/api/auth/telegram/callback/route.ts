import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const jwks = createRemoteJWKSet(new URL("https://oauth.telegram.org/.well-known/jwks.json"));

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  // Must exactly match the redirect_uri sent by the authorization route.
  const configuredOrigin = process.env.APP_URL?.trim() || "https://nexus-mlbb-ign-lookup-production.up.railway.app";
  let origin: string;
  try {
    const parsedOrigin = new URL(configuredOrigin);
    if (parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password) throw new Error("APP_URL must be an HTTPS origin");
    origin = parsedOrigin.origin;
  } catch {
    return NextResponse.redirect(new URL("/login?error=telegram_redirect_misconfigured", requestUrl));
  }
  const url = new URL(requestUrl);
  url.origin = origin;
  const response = (path: string) => {
    const result = NextResponse.redirect(new URL(path, url.origin));
    for (const name of ["eidren_tg_state", "eidren_tg_nonce", "eidren_tg_verifier"]) result.cookies.set(name, "", { path: "/", maxAge: 0 });
    return result;
  };
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0) {
      const name = part.slice(0, index).trim();
      try { cookies.set(name, decodeURIComponent(part.slice(index + 1).trim())); } catch { cookies.set(name, ""); }
    }
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expectedState = cookies.get("eidren_tg_state");
  const nonce = cookies.get("eidren_tg_nonce");
  const verifier = cookies.get("eidren_tg_verifier");
  const clientId = process.env.TELEGRAM_CLIENT_ID || process.env.TELEGRAM_BOT_ID;
  const clientSecret = process.env.TELEGRAM_CLIENT_SECRET;
  if (!state || !expectedState || state !== expectedState || !code || !nonce || !verifier || !clientId || !clientSecret) return response("/login?error=telegram_auth_failed");
  try {
    const tokenResponse = await fetch("https://oauth.telegram.org/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${url.origin}/api/auth/telegram/callback`, client_id: clientId, code_verifier: verifier }),
      cache: "no-store",
    });
    const tokenBody = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || typeof tokenBody?.id_token !== "string") return response("/login?error=telegram_token_failed");
    const verified = await jwtVerify(tokenBody.id_token, jwks, { issuer: "https://oauth.telegram.org", audience: clientId, algorithms: ["RS256", "ES256"] });
    const claims = verified.payload;
    if (claims.nonce !== nonce || typeof claims.sub !== "string" || !/^\d{1,30}$/.test(claims.sub)) return response("/login?error=telegram_claims_failed");
    const email = `telegram-${claims.sub}@telegram.eidren.invalid`;
    const admin = createAdminClient();
    const { error: createError } = await admin.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: {
        auth_provider: "telegram",
        telegram_id: claims.sub,
        telegram_username: typeof claims.preferred_username === "string" ? claims.preferred_username : null,
        full_name: typeof claims.name === "string" ? claims.name : null,
        avatar_url: typeof claims.picture === "string" ? claims.picture : null,
      },
    });
    // A duplicate account is expected on subsequent Telegram sign-ins. Generate a short-lived
    // magic link only after Telegram's signed ID token and one-time state have been verified.
    if (createError && !/already|exists|registered|duplicate/i.test(createError.message)) return response("/login?error=telegram_account_failed");
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${url.origin}/auth/telegram/complete` } });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) return response("/login?error=telegram_session_failed");
    return response(`/auth/telegram/complete?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`);
  } catch {
    return response("/login?error=telegram_auth_failed");
  }
}
