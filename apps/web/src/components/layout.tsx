import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Icon } from "./icons";
import { clearSession, getSession } from "../lib/auth";

export function EmployeeHeader(): JSX.Element {
  const navigate = useNavigate();
  const session = getSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = session?.user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "U";
  function logout(): void { clearSession(); navigate("/login", { replace: true }); }
  return <><header className="flex items-center justify-between px-5 py-5"><button onClick={() => setMenuOpen((open) => !open)} className="rounded-xl p-2 text-slate-600" aria-label="Open menu" aria-expanded={menuOpen}><Icon name="menu" className="h-6 w-6" /></button><span className="text-lg font-bold tracking-tight">Attendance</span><div className="flex items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">{initials}</div><button onClick={logout} className="text-xs font-bold text-slate-500">Log out</button></div></header>{menuOpen && <div className="mx-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-card"><NavLink onClick={() => setMenuOpen(false)} to="/employee" className="block rounded-xl px-3 py-3 text-sm font-bold text-slate-700">Today</NavLink><NavLink onClick={() => setMenuOpen(false)} to="/employee/history" className="block rounded-xl px-3 py-3 text-sm font-bold text-slate-700">Attendance history</NavLink></div>}</>;
}

const items = [{ label: "Home", to: "/employee", icon: "home" }, { label: "History", to: "/employee/history", icon: "history" }, { label: "Profile", to: "/profile", icon: "profile" }] as const;
export function BottomNav(): JSX.Element { return <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg justify-around border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"><>{items.map((item) => <NavLink key={item.label} to={item.to} className={({ isActive }) => `flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-1 text-xs font-medium ${isActive ? "text-brand-600" : "text-slate-400"}`}><Icon name={item.icon} className="h-5 w-5" />{item.label}</NavLink>)}</></nav>; }

export function DashboardShell({ children, title }: { children: ReactNode; title: string }): JSX.Element {
  const navigate = useNavigate();
  const session = getSession();
  function logout(): void { clearSession(); navigate("/login", { replace: true }); }
  const nav = [{ label: "Dashboard", href: "#top" }, { label: "Employees", href: "#employees" }, { label: "Audit Logs", href: "#audit" }];
  const initials = session?.user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? (session?.user.role === "DEV_ADMIN" ? "DA" : "AD");
  return <div id="top" className="min-h-screen bg-slate-50 lg:flex"><aside className="hidden w-64 shrink-0 bg-ink p-6 text-white lg:block"><p className="mb-10 text-xl font-bold">Attendance<span className="text-teal-300">.</span></p><p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">Workspace</p>{nav.map((item, index) => <a key={item.label} href={item.href} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${index === 0 ? "bg-white/10 font-semibold" : "text-slate-300"}`}><Icon name="grid" className="h-4 w-4" />{item.label}</a>)}</aside><main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-10"><header className="mb-7 flex items-center justify-between"><div><p className="text-sm text-slate-500">Overview</p><h1 className="text-2xl font-bold tracking-tight">{title}</h1></div><div className="flex items-center gap-3"><NavLink to="/profile" aria-label="Open profile" className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 font-bold text-brand-600">{initials}</NavLink><button onClick={logout} className="text-sm font-bold text-slate-500">Log out</button></div></header>{children}</main></div>;
}
