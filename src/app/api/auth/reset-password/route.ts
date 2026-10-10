import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const supabase = await createClient();
  const url = new URL(request.url);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${url.origin}/auth/callback?next=/reset-password`,
  });
  if (error) {
    // Avoid revealing whether the address is registered.
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
