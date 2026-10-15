import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createContentSecurityPolicy } from "@/lib/security/content-security-policy.mjs";
import { shouldBlockPageOnBackend } from "@/lib/deployment-routing.mjs";

type CookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  priority?: "low" | "medium" | "high";
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};
type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function proxy(request: NextRequest) {
  // Railway is the API backend only. Human-facing pages are served by the
  // Vercel UI deployment; answer 404 here so the UI is never served twice.
  if (shouldBlockPageOnBackend(request.nextUrl.pathname)) {
    return new NextResponse("Not found. This backend serves API routes only; use the Eidren web app.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const nonce = randomBytes(24).toString("base64url");
  const contentSecurityPolicy = createContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  // Next.js reads the forwarded policy and stamps its inline bootstrap/Flight
  // scripts with the matching nonce. Keep the same policy on the browser response.
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const continueRequest = () => {
    const nextResponse = NextResponse.next({ request: { headers: requestHeaders } });
    nextResponse.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return nextResponse;
  };

  let response = continueRequest();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values: CookieToSet[], headers?: Record<string, string>) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        requestHeaders.set("cookie", request.cookies.toString());
        response = continueRequest();
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([name, value]) => response.headers.set(name, value));
        response.headers.set("Content-Security-Policy", contentSecurityPolicy);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
