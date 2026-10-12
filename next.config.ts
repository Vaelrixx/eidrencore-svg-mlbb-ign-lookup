import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Baseline hardening for every route: clickjacking, MIME sniffing,
        // referrer leakage, and permission lockdown. API routes already send
        // no-store Cache-Control; these add defense-in-depth at the edge.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Defense-in-depth for the dashboard/playground UI surface: no
          // plugins, no framing, form posts stay same-origin. API routes serve
          // JSON only and never execute inline content, so a restrictive
          // baseline is safe here.
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          // Railway serves HTTPS; pin transport security for clients that
          // honor it. Harmless on the platform's managed TLS termination.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
