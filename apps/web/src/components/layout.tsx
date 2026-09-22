import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Icon } from "./icons";
import { clearSession, getSession } from "../lib/auth";
import { useLanguage } from "../lib/language-context";
import { LanguageToggle } from "./LanguageToggle";

export function EmployeeHeader(): JSX.Element {
  const navigate = useNavigate();
  const session = getSession();
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = session?.user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "U";
  function logout(): void { clearSession(); navigate("/login", { replace: true }); }

  return <>
    <header className="glass-navigation sticky top-0 z-20 mb-6 flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={() => setMenuOpen((open) => !open)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-white/70" aria-label={t("openMenu")} aria-expanded={menuOpen}><Icon name="menu" className="h-5 w-5" /></button>
        <span className="truncate text-base font-semibold">Attendance<span className="text-brand-500">.</span></span>
      </div>
      <div className="flex shrink-0 items-center gap-2"><LanguageToggle /><NavLink to="/profile" aria-label={t("openProfile")} className="grid h-9 w-9 place-items-center rounded-full border border-white bg-white/75 text-xs font-bold text-brand-600">{initials}</NavLink><button type="button" onClick={logout} className="text-xs font-semibold text-slate-600 hover:text-ink">{t("logOut")}</button></div>
    </header>
    {menuOpen && <nav className="glass-panel absolute left-4 right-4 z-30 mx-auto max-w-[30rem] rounded-lg p-2"><NavLink onClick={() => setMenuOpen(false)} to="/employee" className="block rounded-md px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-white/70">{t("today")}</NavLink><NavLink onClick={() => setMenuOpen(false)} to="/employee/history" className="block rounded-md px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-white/70">{t("attendanceHistory")}</NavLink></nav>}
  </>;
}

const items = [{ labelKey: "home", to: "/employee", icon: "home" }, { labelKey: "history", to: "/employee/history", icon: "history" }, { labelKey: "profile", to: "/profile", icon: "profile" }] as const;
export function BottomNav(): JSX.Element {
  const { t } = useLanguage();
  return <nav className="glass-navigation fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg justify-around border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">{items.map((item) => <NavLink key={item.labelKey} to={item.to} className={({ isActive }) => `flex min-w-16 flex-col items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium ${isActive ? "bg-white/70 text-brand-600" : "text-slate-500"}`}><Icon name={item.icon} className="h-5 w-5" />{t(item.labelKey)}</NavLink>)}</nav>;
}

export function DashboardShell({ children, title }: { children: ReactNode; title: string }): JSX.Element {
  const navigate = useNavigate();
  const session = getSession();
  const { t } = useLanguage();
  function logout(): void { clearSession(); navigate("/login", { replace: true }); }
  const nav = [{ label: t("dashboard"), href: "#top" }, { label: t("employees"), href: "#employees" }, { label: t("auditLogs"), href: "#audit" }];
  const initials = session?.user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? (session?.user.role === "DEV_ADMIN" ? "DA" : "AD");

  return <div id="top" className="app-canvas lg:flex">
    <aside className="glass-sidebar hidden w-60 shrink-0 p-6 lg:block">
      <p className="mb-11 text-lg font-semibold">Attendance<span className="text-brand-500">.</span></p>
      <p className="mb-4 text-xs font-semibold uppercase text-slate-500">{t("workspace")}</p>
      <nav className="space-y-1">{nav.map((item, index) => <a key={item.label} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-white/75 ${index === 0 ? "bg-white/80 text-brand-600 shadow-sm" : "text-slate-600"}`}><Icon name="grid" className="h-4 w-4" />{item.label}</a>)}</nav>
    </aside>
    <main className="mx-auto w-full max-w-7xl min-w-0 px-4 pb-14 pt-5 sm:px-6 lg:px-9">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-300/50 pb-5">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase text-brand-600">{t("overview")}</p><h1 className="mt-1 text-2xl font-semibold">{title}</h1></div>
        <div className="flex items-center gap-2 sm:gap-3"><LanguageToggle /><NavLink to="/profile" aria-label={t("openProfile")} className="grid h-10 w-10 place-items-center rounded-full border border-white bg-white/75 text-xs font-bold text-brand-600 shadow-sm">{initials}</NavLink><button type="button" onClick={logout} className="text-sm font-semibold text-slate-600 hover:text-ink">{t("logOut")}</button></div>
      </header>
      <nav className="glass-navigation -mt-3 mb-7 flex gap-1 overflow-x-auto rounded-lg border p-1 lg:hidden">{nav.map((item) => <a key={item.label} href={item.href} className="whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white/75">{item.label}</a>)}</nav>
      {children}
    </main>
  </div>;
}
