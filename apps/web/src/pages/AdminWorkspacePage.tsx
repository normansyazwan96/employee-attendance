import { useEffect, useMemo, useState, type FormEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AdminManagement } from "../components/AdminManagement";
import { ApprovalInbox } from "../components/ApprovalInbox";
import { AuditHistory } from "../components/AuditHistory";
import { EmployeeManagement } from "../components/EmployeeManagement";
import { DashboardShell } from "../components/layout";
import { ManagerManagement } from "../components/ManagerManagement";
import { PayrollPanel } from "../components/PayrollPanel";
import { ShiftPlanner } from "../components/ShiftPlanner";
import { WebhookDetails } from "../components/WebhookDetails";
import { WorkPolicyPanel } from "../components/WorkPolicyPanel";
import { WorkforceEmployeeDetails } from "../components/WorkforceEmployeeDetails";
import { OrganizationManagement } from "../components/OrganizationManagement";
import { AdminTimesheets } from "../components/AdminTimesheets";
import { getSelectedOrganizationId, getSession } from "../lib/auth";
import { getAdminAttendance, type AdminAttendance } from "../lib/admin-attendance";
import { useLanguage } from "../lib/language-context";
import { payrollFeatureEnabled } from "../lib/features";
import { createWorksite, deleteWorksite, getWorksites, updateWorksite, type Worksite, type WorksiteInput } from "../lib/worksites";

function AttendanceList(): JSX.Element {
  const { language, locale } = useLanguage(); const ms = language === "ms"; const [records, setRecords] = useState<AdminAttendance[]>([]); const [error, setError] = useState("");
  useEffect(() => { getAdminAttendance({ page: 1, pageSize: 100 }).then((page) => setRecords(page.attendance)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load attendance")); }, []);
  const time = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "--";
  return <>{error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="mt-4 overflow-x-auto rounded-lg border border-white/80 bg-white/70"><table className="w-full min-w-[46rem] text-left text-sm"><thead className="bg-white/70 text-xs uppercase text-slate-500"><tr><th className="p-4">{ms ? "Pekerja" : "Employee"}</th><th>{ms ? "Tarikh" : "Date"}</th><th>{ms ? "Masuk" : "Clock in"}</th><th>{ms ? "Keluar" : "Clock out"}</th><th>{ms ? "Bekerja" : "Worked"}</th><th>OT</th><th>{ms ? "Status" : "Status"}</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className="border-t border-slate-200"><td className="p-4 font-semibold">{record.employee.name}</td><td>{record.workDate}</td><td>{time(record.clockInAt)}</td><td>{time(record.clockOutAt)}</td><td>{record.totalWorkingHours ?? 0}h</td><td>{record.overtimeHours ?? 0}h</td><td>{record.clockOutAt ? (ms ? "Selesai" : "Complete") : (ms ? "Aktif" : "Active")}</td></tr>)}</tbody></table>{records.length === 0 && <p className="p-8 text-center text-sm text-slate-500">{ms ? "Tiada rekod." : "No records."}</p>}</div></>;
}

function WorksitesPanel(): JSX.Element {
  const { language } = useLanguage(); const ms = language === "ms"; const empty: WorksiteInput = { name: "", latitude: 3.139, longitude: 101.6869, radiusMeters: 150, isActive: true };
  const [items, setItems] = useState<Worksite[]>([]); const [form, setForm] = useState<WorksiteInput>(empty); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState("");
  useEffect(() => { getWorksites().then(setItems).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load worksites")); }, []);
  async function save(event: FormEvent): Promise<void> { event.preventDefault(); try { const saved = editing ? await updateWorksite(editing, form) : await createWorksite(form); setItems((current) => editing ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]); setEditing(null); setForm(empty); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save worksite"); } }
  return <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">{error && <p role="alert" className="xl:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<form onSubmit={(event) => void save(event)} className="glass-panel space-y-4 rounded-lg p-5"><h2 className="font-semibold">{editing ? (ms ? "Edit lokasi" : "Edit worksite") : (ms ? "Tambah lokasi" : "Add worksite")}</h2><input required placeholder={ms ? "Nama" : "Name"} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-11 w-full rounded-md border border-slate-300 bg-white/80 px-3"/><div className="grid grid-cols-2 gap-2"><input aria-label="Latitude" required type="number" step="any" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: Number(event.target.value) })} className="h-11 min-w-0 rounded-md border border-slate-300 bg-white/80 px-3"/><input aria-label="Longitude" required type="number" step="any" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: Number(event.target.value) })} className="h-11 min-w-0 rounded-md border border-slate-300 bg-white/80 px-3"/></div><input aria-label="Radius" required type="number" min="25" max="10000" value={form.radiusMeters} onChange={(event) => setForm({ ...form, radiusMeters: Number(event.target.value) })} className="h-11 w-full rounded-md border border-slate-300 bg-white/80 px-3"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })}/>{ms ? "Aktif" : "Active"}</label><button className="h-11 w-full rounded-md bg-ink text-sm font-semibold text-white">{ms ? "Simpan" : "Save"}</button></form><div className="space-y-3">{items.map((item) => <article key={item.id} className="glass-panel flex items-center justify-between gap-4 rounded-lg p-4"><div><h3 className="font-semibold">{item.name}</h3><p className="mt-1 text-sm text-slate-600">{item.radiusMeters} m · {item.latitude}, {item.longitude}</p></div><div className="flex gap-3 text-sm font-semibold"><button onClick={() => { setEditing(item.id); setForm(item); }} className="text-brand-700">{ms ? "Edit" : "Edit"}</button><button onClick={() => void deleteWorksite(item.id).then(() => setItems((current) => current.filter((site) => site.id !== item.id)))} className="text-rose-700">{ms ? "Padam" : "Delete"}</button></div></article>)}</div></div>;
}

function Overview(): JSX.Element {
  const { language } = useLanguage(); const ms = language === "ms"; const links = [["/admin/live", ms ? "Kehadiran langsung" : "Live attendance"], ["/admin/employees", ms ? "Pekerja" : "Employees"], ["/admin/leave", ms ? "Kelulusan" : "Approvals"], ...(payrollFeatureEnabled ? [["/admin/reports", ms ? "Gaji dan laporan" : "Payroll and reports"]] : [])];
  return <div className="grid gap-3 sm:grid-cols-2">{links.map(([to, label]) => <NavLink key={to} to={to} className="glass-panel rounded-lg p-5 transition hover:bg-white/90"><h2 className="font-semibold">{label}</h2><p className="mt-2 text-sm text-slate-600">{ms ? "Buka ruang kerja" : "Open workspace"}</p></NavLink>)}</div>;
}

export function AdminWorkspacePage(): JSX.Element {
  const { pathname } = useLocation(); const { language } = useLanguage(); const ms = language === "ms"; const session = getSession();
  const section = pathname.split("/")[2] || "overview";
  const titles: Record<string, string> = { overview: ms ? "Gambaran keseluruhan" : "Overview", live: ms ? "Kehadiran langsung" : "Live attendance", timesheets: ms ? "Lembaran masa" : "Timesheets", employees: ms ? "Pekerja" : "Employees", schedules: ms ? "Jadual" : "Schedules", leave: ms ? "Cuti dan kelulusan" : "Leave and approvals", worksites: ms ? "Lokasi kerja" : "Worksites", reports: ms ? "Laporan gaji" : "Payroll reports", audit: ms ? "Audit" : "Audit", settings: ms ? "Tetapan organisasi" : "Organization settings" };
  const organizationRequired = session?.user.role === "DEV_ADMIN" && !getSelectedOrganizationId();
  const content = useMemo(() => { switch (section) { case "live": return <AttendanceList/>; case "timesheets": return <AdminTimesheets/>; case "employees": return <><EmployeeManagement adminAccountsVersion={0} preferredOwnerAdminId=""/><WorkforceEmployeeDetails/></>; case "schedules": return <ShiftPlanner/>; case "leave": return <ApprovalInbox/>; case "worksites": return <WorksitesPanel/>; case "reports": return payrollFeatureEnabled ? <PayrollPanel/> : <Overview/>; case "audit": return <AuditHistory/>; case "settings": return <>{session?.user.role === "DEV_ADMIN" && <OrganizationManagement/>}<WorkPolicyPanel/><ManagerManagement/>{session?.user.role === "DEV_ADMIN" && <><AdminManagement onAdminCreated={() => undefined} onAccountsChanged={() => undefined}/><WebhookDetails/></>}</>; default: return <Overview/>; } }, [section, session?.user.role]);
  return <DashboardShell title={titles[section] ?? titles.overview}>{organizationRequired ? <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">{ms ? "Pilih organisasi di bahagian atas untuk membuka ruang kerja." : "Select an organization above to open its workspace."}</p> : content}</DashboardShell>;
}
