"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, BookOpen, CreditCard, LayoutDashboard, LogOut, Settings2, Swords, KeyRound } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/usage", label: "Usage & analytics", icon: Activity },
  { href: "/dashboard/docs", label: "API reference", icon: BookOpen },
  { href: "/dashboard/billing", label: "Billing & plans", icon: CreditCard },
  { href: "/dashboard/account", label: "Account & sessions", icon: Settings2 },
];

export function ConsoleNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <nav className="platform-nav console-topbar">
        <Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link>
        <div className="console-top-actions"><span className="console-secure"><span className="live-dot" /> SECURE CONSOLE</span><button className="quiet-button" onClick={signOut}><LogOut size={15}/> Sign out</button></div>
      </nav>
      <div className="console-layout">
        <aside className="console-sidebar" aria-label="Developer console sections">
          <div className="console-side-label">WORKSPACE</div>
          {items.map(item => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={`console-nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={16}/><span>{item.label}</span>{active && <span className="console-nav-indicator" />}</Link>;
          })}
          <div className="console-sidebar-bottom"><span className="console-sidebar-mark"><Swords size={14}/></span><div><strong>Eidren Platform</strong><small>MLBB Identity API</small></div></div>
        </aside>
        <div className="console-main"><div className="console-mobile-links">{items.map(item => { const active = item.exact ? pathname === item.href : pathname.startsWith(item.href); const Icon = item.icon; return <Link key={item.href} href={item.href} className={active ? "active" : ""}><Icon size={14}/>{item.label}</Link>; })}</div><div className="console-content" /></div>
      </div>
    </>
  );
}

export function ConsoleFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  const current = items.find(item => item.exact ? pathname === item.href : pathname.startsWith(item.href));
  return <main className="platform-shell dashboard-shell console-shell">
    <nav className="platform-nav console-topbar">
      <Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link>
      <div className="console-top-actions"><span className="console-secure"><span className="live-dot" /> SECURE CONSOLE</span><button className="quiet-button" onClick={signOut}><LogOut size={15}/> Sign out</button></div>
    </nav>
    <div className="console-layout">
      <aside className="console-sidebar" aria-label="Developer console sections">
        <div className="console-side-label">WORKSPACE</div>
        {items.map(item => { const active = item.exact ? pathname === item.href : pathname.startsWith(item.href); const Icon = item.icon; return <Link key={item.href} href={item.href} className={`console-nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={16}/><span>{item.label}</span>{active && <span className="console-nav-indicator" />}</Link>; })}
        <div className="console-sidebar-bottom"><span className="console-sidebar-mark"><Swords size={14}/></span><div><strong>Eidren Platform</strong><small>MLBB Identity API</small></div></div>
      </aside>
      <section className="console-page">
        <div className="console-mobile-links">{items.map(item => { const active = item.exact ? pathname === item.href : pathname.startsWith(item.href); const Icon = item.icon; return <Link key={item.href} href={item.href} className={active ? "active" : ""}><Icon size={14}/>{item.label}</Link>; })}</div>
        <div className="console-page-heading"><div><span className="platform-eyebrow">DEVELOPER CONSOLE / {current?.label.toUpperCase() || "WORKSPACE"}</span><h1>{current?.label || "Workspace"}<span>.</span></h1><p>Manage your Eidren integration from one secure workspace.</p></div><Link href="/dashboard" className="quiet-button"><LayoutDashboard size={14}/> Overview</Link></div>
        {children}
        <footer className="platform-footer"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>SECURE SESSIONS · PRIVATE API KEYS</span></footer>
      </section>
    </div>
  </main>;
}
