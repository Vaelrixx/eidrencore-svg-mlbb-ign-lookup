import Link from "next/link";
import { ArrowRight, Menu, Swords } from "lucide-react";
import { getSessionUser } from "@/lib/session";

const links = [
  { href: "/#tools", label: "Tools" },
  { href: "/#platform", label: "Platform" },
  { href: "/#developers", label: "Developers" },
  { href: "/dashboard/docs", label: "Docs" },
  { href: "/playground", label: "Playground" },
];

export async function SiteShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="x-page">
      <div className="x-orbs" aria-hidden="true"><i className="x-orb x-orb-a" /><i className="x-orb x-orb-b" /><i className="x-orb x-orb-c" /></div>
      <main className="x-wrap">
        <header className="x-nav">
          <Link className="x-brand" href="/" aria-label="Eidren home">
            <span className="x-brand-mark"><Swords size={19} strokeWidth={2.4} /></span>
            <span>EIDREN<b>.</b></span>
          </Link>
          <nav className="x-nav-links" aria-label="Primary">
            {links.map((l) => <Link key={l.href} href={l.href} className="x-nav-link">{l.label}</Link>)}
            {user
              ? <Link href="/dashboard" className="x-nav-cta">Open console <ArrowRight size={14} /></Link>
              : <><Link href="/login" className="x-nav-link">Sign in</Link><Link href="/login?mode=signup" className="x-nav-cta">Get started <ArrowRight size={14} /></Link></>}
          </nav>
          <details className="x-menu">
            <summary aria-label="Open menu"><Menu size={20} /> Menu</summary>
            <div className="x-menu-panel">
              {links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
              {user
                ? <Link href="/dashboard" className="x-menu-cta">Open console <ArrowRight size={15} /></Link>
                : <><Link href="/login">Sign in</Link><Link href="/login?mode=signup" className="x-menu-cta">Get started <ArrowRight size={15} /></Link></>}
            </div>
          </details>
        </header>
        {children}
        <footer className="x-footer2">
          <div className="x-footer2-brand">
            <span className="x-brand"><span className="x-brand-mark"><Swords size={17} strokeWidth={2.4} /></span><span>EIDREN<b>.</b></span></span>
            <p>Player identity tools and APIs for game communities and top-up platforms.</p>
          </div>
          <div className="x-footer2-cols">
            <div><h4>Product</h4><Link href="/playground">Playground</Link><Link href="/#tools">Tools</Link><Link href="/#platform">Platform</Link></div>
            <div><h4>Developers</h4><Link href="/dashboard/docs">API reference</Link><Link href="/dashboard/keys">API keys</Link><Link href="/dashboard/webhooks">Webhooks</Link></div>
            <div><h4>Account</h4><Link href="/login">{user ? "Account" : "Sign in"}</Link><Link href="/dashboard">Console</Link><Link href="/dashboard/billing">Billing</Link></div>
          </div>
          <div className="x-footer2-legal"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>MLBB COMMUNITY TOOL · NOT AFFILIATED WITH MOONTON</span></div>
        </footer>
      </main>
    </div>
  );
}
