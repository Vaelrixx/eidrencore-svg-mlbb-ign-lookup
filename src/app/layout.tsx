import type { Metadata } from "next";
import "./globals.css";

// Request-specific CSP nonces cannot be applied to build-time static HTML.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "EIDREN · Developer Platform & MLBB Lookup",
  description: "Resolve MLBB player nicknames and manage secure API keys, developer plans, and billing.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
