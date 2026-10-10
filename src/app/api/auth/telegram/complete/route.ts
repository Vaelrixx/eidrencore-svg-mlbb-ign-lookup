import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const tokenHash = typeof body?.token_hash === "string" ? body.token_hash : "";
  if (!tokenHash || body?.type !== "magiclink") return NextResponse.json({ error: "Sign-in token is missing or invalid." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) return NextResponse.json({ error: "Telegram sign-in link is invalid or expired." }, { status: 401 });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
