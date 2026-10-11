"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, BookOpen, FlaskConical, CreditCard, LayoutDashboard, LogOut, Settings2, Swords, KeyRound, Building2, Webhook, ScrollText, Menu, X, ChevronRight } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true, hint: "Plan, quota and keys" },
  { href: "/dashboard/keys", label: "API keys", icon: KeyRound, hint: "Create and revoke keys" },
  { href: "/dashboard/usage", label: "Usage & analytics", icon: Activity, hint: "Requests over time" },
  { href: "/dashboard/docs", label: "API reference", icon: BookOpen, hint: "Endpoints and examples" },
  { href: "/dashboard/playground", label: "Playground", icon: FlaskConical, hint: "Run a live lookup" },
  { href: "/dashboard/billing", label: "Billing & plans", icon: CreditCard, hint: "Upgrade or manage" },
  { href: "/dashboard/account", label: "Account & sessions", icon: Settings2, hint: "Profile and security" },
  { href: "/dashboard/workspaces", label: "Workspaces", icon: Building2, hint: "Teams and roles" },
  { href: "/dashboard/webhooks", label: "Webhooks", icon: Webhook, hint: "Event notifications" },
  { href: "/dashboard/logs", label: "Logs & audit", icon: ScrollText, hint: "Recent activity" },
];

const groups = [
  { label: "BUILD", items: items.slice(0, 4) },
  { label: "TOOLS", items: items.slice(4, 5) },
  { label: "MANAGE", items: items.slice(5) },
];

// Primary destinations pinned to the mobile tab bar; everything else lives in the menu.
const tabs = [items[0], items[1], items[2], items[4]];

export function ConsoleFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isActive = (item: (typeof items)[number]) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  // Close the menu after navigating, on Escape, and lock page scroll while it is open.
  useEffect(() => { const timer = window.setTimeout(() => setOpen(false), 0); return () => window.clearTimeout(timer); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open]);

  const current = items.find(isActive);
  return <main className="platform-shell dashboard-shell console-shell">
    <nav className="platform-nav console-topbar">
      <Link className="brand" href="/"><span className="brand-mark"><Swords size={19}/></span><span>EIDREN<span className="brand-dot">.</span></span></Link>
      <div className="console-top-actions">
        <span className="console-secure"><span className="live-dot" /> SECURE CONSOLE</span>
        <button className="quiet-button cm-signout" onClick={signOut}><LogOut size={15}/> Sign out</button>
        <button className="cm-menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation menu" aria-expanded={open} aria-controls="console-drawer"><Menu size={19}/><span>Menu</span></button>
      </div>
    </nav>

    <div className={`cm-overlay${open ? " is-open" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
    <aside id="console-drawer" className={`cm-drawer${open ? " is-open" : ""}`} aria-label="Console navigation" aria-hidden={!open} inert={!open}>
      <div className="cm-drawer-head">
        <span className="brand"><span className="brand-mark"><Swords size={17}/></span><span>EIDREN<span className="brand-dot">.</span></span></span>
        <button className="cm-close" onClick={() => setOpen(false)} aria-label="Close navigation menu"><X size={19}/></button>
      </div>
      <div className="cm-drawer-body">
        {groups.map(group => <div className="cm-group" key={group.label}>
          <div className="cm-group-label">{group.label}</div>
          {group.items.map(item => { const Icon = item.icon; const active = isActive(item); return <Link key={item.href} href={item.href} className={`cm-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
            <span className="cm-link-icon"><Icon size={17}/></span>
            <span className="cm-link-text"><strong>{item.label}</strong><small>{item.hint}</small></span>
            <ChevronRight size={15} className="cm-chevron"/>
          </Link>; })}
        </div>)}
      </div>
      <div className="cm-drawer-foot">
        <Link href="/" className="cm-home">Back to site <ArrowUpRight size={14}/></Link>
        <button className="cm-signout-row" onClick={signOut}><LogOut size={16}/> Sign out</button>
      </div>
    </aside>

    <nav className="cm-tabbar" aria-label="Console quick navigation">
      {tabs.map(item => { const Icon = item.icon; const active = isActive(item); return <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={19}/><span>{item.label.split(" ")[0]}</span></Link>; })}
      <button onClick={() => setOpen(true)} aria-label="More sections"><Menu size={19}/><span>More</span></button>
    </nav>

    <div className="console-layout">
      <aside className="console-sidebar" aria-label="Developer console sections">
        {groups.map(group => <div className="console-side-group" key={group.label}>
          <div className="console-side-label">{group.label}</div>
          {group.items.map(item => { const active = isActive(item); const Icon = item.icon; return <Link key={item.href} href={item.href} className={`console-nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={16}/><span>{item.label}</span>{active && <span className="console-nav-indicator" />}</Link>; })}
        </div>)}
        <Link href="/dashboard/playground" className="console-sidebar-bottom console-lookup-link"><span className="console-sidebar-mark"><FlaskConical size={14}/></span><div><strong>Playground</strong><small>Run a live lookup</small></div><ArrowUpRight size={15}/></Link>
      </aside>
      <section className="console-page">
        <div className="console-page-heading"><div><span className="platform-eyebrow">DEVELOPER CONSOLE / {current?.label.toUpperCase() || "WORKSPACE"}</span><h1>{current?.label || "Workspace"}<span>.</span></h1><p>{current?.hint ? `${current.hint}.` : "Manage your Eidren integration from one secure workspace."}</p></div>{pathname !== "/dashboard" && <Link href="/dashboard" className="quiet-button"><LayoutDashboard size={14}/> Overview</Link>}</div>
        {children}
        <footer className="platform-footer"><span>© {new Date().getFullYear()} EIDREN DEVELOPER PLATFORM</span><span>SECURE SESSIONS · PRIVATE API KEYS</span></footer>
      </section>
    </div>
  </main>;
}
