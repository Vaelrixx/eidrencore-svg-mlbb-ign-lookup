import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const clientId = process.env.TELEGRAM_CLIENT_ID || process.env.TELEGRAM_BOT_ID;
  if (!clientId || !process.env.TELEGRAM_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/login?error=telegram_not_configured", request.url));
  }
  const origin = new URL(request.url).origin;
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://oauth.telegram.org/auth");
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: `${origin}/api/auth/telegram/callback`,
    response_type: "code", scope: "openid profile", state, nonce,
    code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  const response = NextResponse.redirect(url);
  const secure = new URL(request.url).protocol === "https:";
  const cookie = { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set("eidren_tg_state", state, cookie);
  response.cookies.set("eidren_tg_nonce", nonce, cookie);
  response.cookies.set("eidren_tg_verifier", verifier, cookie);
  return response;
}
