import { useState, type ReactNode } from "react";
import { Building2, CalendarDays, ClipboardCheck, ClipboardList, Clock3, FileClock, History, House, LayoutDashboard, LogOut, MapPin, Menu, ScrollText, Settings, Umbrella, UserRound, Users, WalletCards, type LucideIcon } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { getSession, logout as endSession } from "../lib/auth";
import { useLanguage } from "../lib/language-context";
import { payrollFeatureEnabled } from "../lib/features";
import { LanguageToggle } from "./LanguageToggle";
import { NotificationCenter } from "./NotificationCenter";
import { ConnectivityStatus } from "./ConnectivityStatus";
import { OrganizationSelector } from "./OrganizationSelector";
import { BrandMark } from "./BrandMark";

export function EmployeeHeader(): JSX.Element {
  const navigate = useNavigate();
  const session = getSession();
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = session?.user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "U";
  async function logout(): Promise<void> { await endSession(); navigate("/login", { replace: true }); }

  return <>
    <ConnectivityStatus />
    <header className="employee-navigation sticky top-0 z-20 mb-6 flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={() => setMenuOpen((open) => !open)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label={t("openMenu")} aria-expanded={menuOpen}><Menu aria-hidden="true" size={20} /></button>
        <BrandMark inverse compact />
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2"><LanguageToggle inverse /><NotificationCenter inverse /><NavLink to="/profile" aria-label={t("openProfile")} className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 text-xs font-bold text-white">{initials}</NavLink><button type="button" onClick={() => void logout()} title={t("logOut")} aria-label={t("logOut")} className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"><LogOut aria-hidden="true" size={18} /></button></div>
    </header>
    {menuOpen && <nav className="glass-panel absolute left-4 right-4 z-30 mx-auto max-w-[30rem] rounded-lg p-2"><NavLink onClick={() => setMenuOpen(false)} to="/employee" className="block rounded-md px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-white/70">{t("today")}</NavLink><NavLink onClick={() => setMenuOpen(false)} to="/employee/history" className="block rounded-md px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-white/70">{t("attendanceHistory")}</NavLink><NavLink onClick={() => setMenuOpen(false)} to="/employee/work" className="block rounded-md px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-white/70">{t("requests")}</NavLink><NavLink onClick={() => setMenuOpen(false)} to="/employee/payroll" className="block rounded-md px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-white/70">{t("payroll")}</NavLink></nav>}
  </>;
}

const items: Array<{ labelKey: "home" | "history" | "requests" | "payroll" | "profile"; to: string; icon: LucideIcon }> = [{ labelKey: "home", to: "/employee", icon: House }, { labelKey: "history", to: "/employee/history", icon: History }, { labelKey: "requests", to: "/employee/work", icon: ClipboardList }, { labelKey: "payroll", to: "/employee/payroll", icon: WalletCards }, { labelKey: "profile", to: "/profile", icon: UserRound }];
export function BottomNav(): JSX.Element {
  const { t } = useLanguage();
  return <nav className="bottom-navigation fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg justify-around px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">{items.map((item) => { const NavIcon = item.icon; return <NavLink key={item.labelKey} to={item.to} className={({ isActive }) => `flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1 text-[11px] font-medium ${isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}><NavIcon aria-hidden="true" size={20} /><span className="max-w-full truncate">{t(item.labelKey)}</span></NavLink>; })}</nav>;
}

export function DashboardShell({ children, title }: { children: ReactNode; title: string }): JSX.Element {
  const navigate = useNavigate();
  const session = getSession();
  const { language, t } = useLanguage();
  async function logout(): Promise<void> { await endSession(); navigate("/login", { replace: true }); }
  const ms = language === "ms";
  const nav: Array<{ label: string; to: string; icon: LucideIcon }> = session?.user.role === "GLOBAL_ADMIN"
    ? [{ label: ms ? "Organisasi" : "Organizations", to: "/global", icon: Building2 }]
    : session?.user.role === "MANAGER"
    ? [{ label: ms ? "Kelulusan" : "Approvals", to: "/manager", icon: ClipboardCheck }]
    : [
      { label: ms ? "Gambaran keseluruhan" : "Overview", to: "/admin", icon: LayoutDashboard },
      { label: ms ? "Kehadiran langsung" : "Live attendance", to: "/admin/live", icon: Clock3 },
      { label: ms ? "Lembaran masa" : "Timesheets", to: "/admin/timesheets", icon: FileClock },
      { label: t("employees"), to: "/admin/employees", icon: Users },
      { label: t("schedules"), to: "/admin/schedules", icon: CalendarDays },
      { label: ms ? "Cuti" : "Leave", to: "/admin/leave", icon: Umbrella },
      { label: t("worksites"), to: "/admin/worksites", icon: MapPin },
      ...(payrollFeatureEnabled ? [{ label: ms ? "Gaji" : "Payroll", to: "/admin/reports", icon: WalletCards }] : []),
      ...(session?.user.role === "DEV_ADMIN" ? [{ label: t("auditLogs"), to: "/admin/audit", icon: ScrollText }] : []),
      { label: ms ? "Tetapan" : "Settings", to: "/admin/settings", icon: Settings },
    ];
  const initials = session?.user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? (session?.user.role === "DEV_ADMIN" ? "DA" : "AD");

  return <div id="top" className="dashboard-shell app-canvas lg:flex"><ConnectivityStatus />
    <aside className="dashboard-sidebar hidden w-64 shrink-0 p-6 lg:block">
      <BrandMark inverse />
      <p className="mb-4 mt-11 text-xs font-semibold uppercase text-slate-500">{t("workspace")}</p>
      <nav className="space-y-1">{nav.map((item) => { const NavIcon = item.icon; return <NavLink key={item.label} end={item.to === "/admin" || item.to === "/manager" || item.to === "/global"} to={item.to} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-white/10 text-white shadow-sm" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}><NavIcon aria-hidden="true" size={17} />{item.label}</NavLink>; })}</nav>
    </aside>
    <main className="dashboard-workspace mx-auto w-full max-w-[96rem] min-w-0 px-4 pb-14 pt-5 sm:px-6 lg:px-9">
      <div className="mb-5 lg:hidden"><BrandMark compact /></div>
      <header className="workspace-header mb-8 flex flex-wrap items-center justify-between gap-4 pb-5">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase text-brand-600">{ms ? "Operasi tenaga kerja" : "Workforce operations"}</p><h1 className="mt-1 text-2xl font-semibold">{title}</h1></div>
        <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-3"><OrganizationSelector /><LanguageToggle /><NotificationCenter /><NavLink to="/profile" aria-label={t("openProfile")} className="grid h-10 w-10 place-items-center rounded-full border border-violet-200 bg-white text-xs font-bold text-brand-700 shadow-sm">{initials}</NavLink><button type="button" onClick={() => void logout()} title={t("logOut")} aria-label={t("logOut")} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink"><LogOut aria-hidden="true" size={18} /></button></div>
      </header>
      <nav className="mobile-workspace-nav -mt-3 mb-7 flex gap-1 overflow-x-auto rounded-lg p-1 lg:hidden">{nav.map((item) => <NavLink key={item.label} end={item.to === "/admin" || item.to === "/manager"} to={item.to} className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>{item.label}</NavLink>)}</nav>
      {children}
    </main>
  </div>;
}
