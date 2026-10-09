import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXUS · MLBB Player Lookup",
  description: "Resolve a Mobile Legends: Bang Bang in-game nickname from Player ID and Zone ID.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
