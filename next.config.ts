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
          // CSP is generated per request in src/proxy.ts so Next.js can stamp
          // its inline bootstrap scripts with a matching nonce.
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
