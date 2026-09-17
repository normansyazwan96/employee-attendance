import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { DashboardShell } from "../components/layout";
import { AuditHistory } from "../components/AuditHistory";
import { ScheduleManagement } from "../components/ScheduleManagement";
import { EmployeeManagement } from "../components/EmployeeManagement";
import { exportAdminAttendance, getAdminAttendance, type AdminAttendance, type AttendanceFilters } from "../lib/admin-attendance";
import { createWorksite, deleteWorksite, getWorksites, updateWorksite, type Worksite, type WorksiteInput } from "../lib/worksites";

const time = (value: string | null): string => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "--";
const date = (value: string): string => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
const scheduleLabel = (value?: string): string => value ? value.replaceAll("_", " ") : "No schedule";
const emptyWorksite: WorksiteInput = { name: "", latitude: 40.7128, longitude: -74.006, radiusMeters: 150, isActive: true };
const WorksiteMap = lazy(() => import("../components/WorksiteMap").then(({ WorksiteMap: map }) => ({ default: map })));

export function AdminPage(): JSX.Element {
  const [attendance, setAttendance] = useState<AdminAttendance[]>([]);
  const [attendanceFilters, setAttendanceFilters] = useState<AttendanceFilters>({ page: 1, pageSize: 25 });
  const [attendancePages, setAttendancePages] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [form, setForm] = useState<WorksiteInput>({ ...emptyWorksite });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all([getAdminAttendance(attendanceFilters), getWorksites()]).then(([attendancePage, sites]) => { setAttendance(attendancePage.attendance); setAttendancePages(attendancePage.pagination); setWorksites(sites); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load admin data"));
  }, [attendanceFilters]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const records = attendance.filter((record) => record.workDate === today);
    return [["Attendance records", String(attendance.length), "Recent records", "bg-brand-50 text-brand-600"], ["Clocked in", String(records.filter((record) => !record.clockOutAt).length), "Active right now", "bg-blue-50 text-blue-600"], ["Completed", String(records.filter((record) => record.clockOutAt).length), "Finished today", "bg-emerald-50 text-emerald-600"], ["Today", String(records.length), "Employee actions", "bg-violet-50 text-violet-600"]] as const;
  }, [attendance]);

  function editWorksite(worksite: Worksite): void {
    setEditingId(worksite.id);
    setForm({ name: worksite.name, latitude: worksite.latitude, longitude: worksite.longitude, radiusMeters: worksite.radiusMeters, isActive: worksite.isActive });
  }
  function resetWorksite(): void { setEditingId(null); setForm({ ...emptyWorksite }); }
  function setNumber(field: "latitude" | "longitude" | "radiusMeters", value: string): void { setForm((current) => ({ ...current, [field]: Number(value) })); }
  async function exportAttendance(): Promise<void> { setError(""); setExporting(true); try { await exportAdminAttendance(attendanceFilters); } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to export attendance"); } finally { setExporting(false); } }
  async function saveWorksite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const saved = editingId ? await updateWorksite(editingId, form) : await createWorksite(form);
      setWorksites((current) => editingId ? current.map((site) => site.id === saved.id ? saved : site) : [...current, saved]);
      resetWorksite();
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to save worksite"); } finally { setSaving(false); }
  }
  async function removeWorksite(id: string): Promise<void> {
    if (!window.confirm("Delete this worksite?")) return;
    try { await deleteWorksite(id); setWorksites((current) => current.filter((site) => site.id !== id)); if (editingId === id) resetWorksite(); } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "Unable to delete worksite"); }
  }

  return <DashboardShell title="Admin dashboard">
    <p className="-mt-5 mb-6 text-sm text-slate-500">Live attendance and worksites for your client.</p>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{stats.map(([label, value, note, color]) => <article key={label} className="rounded-2xl bg-white p-4 shadow-card"><div className={`mb-5 grid h-9 w-9 place-items-center rounded-xl text-sm font-bold ${color}`}>{value}</div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-1 text-xs text-slate-400">{note}</p></article>)}</section>

    <section className="mt-10">
      <div className="mb-4"><h2 className="text-lg font-bold">Worksites</h2><p className="text-sm text-slate-500">Manage the places employees can clock in and out.</p></div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="overflow-hidden rounded-2xl bg-white shadow-card"><div className="h-80"><Suspense fallback={<div className="grid h-full place-items-center bg-slate-100 text-sm text-slate-500">Loading map...</div>}><WorksiteMap latitude={form.latitude} longitude={form.longitude} radiusMeters={form.radiusMeters} onLocationChange={(latitude, longitude) => setForm((current) => ({ ...current, latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) }))} /></Suspense></div><div className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">Click the map to place the worksite pin. The circle shows the allowed radius.</div></div>
        <form onSubmit={(event) => void saveWorksite(event)} className="rounded-2xl bg-white p-5 shadow-card">
          <div className="mb-5 flex items-center justify-between"><div><h3 className="font-bold">{editingId ? "Edit worksite" : "Add a worksite"}</h3><p className="mt-1 text-sm text-slate-500">Coordinates use decimal degrees.</p></div>{editingId && <button type="button" onClick={resetWorksite} className="text-sm font-bold text-brand-600">Cancel</button>}</div>
          <label className="block text-sm font-semibold text-slate-700">Name<input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-brand-500" placeholder="Head office" /></label>
          <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm font-semibold text-slate-700">Latitude<input required type="number" min="-90" max="90" step="any" value={form.latitude} onChange={(event) => setNumber("latitude", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-brand-500" /></label><label className="text-sm font-semibold text-slate-700">Longitude<input required type="number" min="-180" max="180" step="any" value={form.longitude} onChange={(event) => setNumber("longitude", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-brand-500" /></label></div>
          <label className="mt-4 block text-sm font-semibold text-slate-700">Allowed radius <span className="font-normal text-slate-500">(25 to 10,000 m)</span><input required type="number" min="25" max="10000" step="1" value={form.radiusMeters} onChange={(event) => setNumber("radiusMeters", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-brand-500" /></label>
          <label className="mt-4 flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 accent-teal-600" />Active for employee location checks</label>
          <button disabled={saving} className="mt-6 h-11 w-full rounded-xl bg-ink text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">{saving ? "Saving..." : editingId ? "Save changes" : "Add worksite"}</button>
        </form>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">{worksites.map((worksite) => <article key={worksite.id} className="flex items-start justify-between gap-4 rounded-2xl bg-white p-5 shadow-card"><div><div className="flex items-center gap-2"><h3 className="font-bold">{worksite.name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${worksite.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{worksite.isActive ? "Active" : "Inactive"}</span></div><p className="mt-2 text-sm text-slate-500">{worksite.radiusMeters} m radius</p><p className="mt-1 font-mono text-xs text-slate-400">{worksite.latitude}, {worksite.longitude}</p></div><div className="flex shrink-0 gap-3 text-sm font-bold"><button onClick={() => editWorksite(worksite)} className="text-brand-600">Edit</button><button onClick={() => void removeWorksite(worksite.id)} className="text-rose-600">Delete</button></div></article>)}</div>
      {worksites.length === 0 && <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No worksites configured yet.</div>}
    </section>

    <div id="employees"><EmployeeManagement /></div>

    <ScheduleManagement />

    <div id="audit"><AuditHistory /></div>
    <button type="button" onClick={() => void exportAttendance()} disabled={exporting} className="mt-4 h-10 rounded-lg bg-ink px-3 text-sm font-bold text-white disabled:opacity-50">{exporting ? "Exporting..." : "Export CSV"}</button>

    <section className="mt-10"><div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-card"><label className="text-xs font-bold uppercase tracking-wide text-slate-500">From<input type="date" value={attendanceFilters.from ?? ""} onChange={(event) => setAttendanceFilters((current) => ({ ...current, from: event.target.value || undefined, page: 1 }))} className="mt-1 block h-10 rounded-lg border border-slate-200 px-2 text-sm font-normal" /></label><label className="text-xs font-bold uppercase tracking-wide text-slate-500">To<input type="date" value={attendanceFilters.to ?? ""} onChange={(event) => setAttendanceFilters((current) => ({ ...current, to: event.target.value || undefined, page: 1 }))} className="mt-1 block h-10 rounded-lg border border-slate-200 px-2 text-sm font-normal" /></label><button type="button" onClick={() => setAttendanceFilters({ page: 1, pageSize: 25 })} className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600">Clear</button><span className="ml-auto text-sm text-slate-500">{attendancePages.total} records</span><button type="button" disabled={attendancePages.page <= 1} onClick={() => setAttendanceFilters((current) => ({ ...current, page: attendancePages.page - 1 }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 disabled:opacity-40">Previous</button><span className="text-sm text-slate-500">Page {attendancePages.page} of {Math.max(attendancePages.totalPages, 1)}</span><button type="button" disabled={attendancePages.page >= attendancePages.totalPages} onClick={() => setAttendanceFilters((current) => ({ ...current, page: attendancePages.page + 1 }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 disabled:opacity-40">Next</button></div></section>

    <section className="mt-10"><div className="mb-4"><h2 className="text-lg font-bold">Attendance activity</h2><p className="text-sm text-slate-500">Recent employee clock actions</p></div>{!error && attendance.length === 0 && <div className="rounded-2xl bg-white p-6 text-center shadow-card"><p className="font-bold">No attendance records yet</p><p className="mt-1 text-sm text-slate-500">Employee clock actions will appear here.</p></div>}<div className="grid gap-3 md:hidden">{attendance.map((record) => <article key={record.id} className="rounded-2xl bg-white p-5 shadow-card"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-xs font-bold">{record.employee.name.split(" ").map((part) => part[0]).join("")}</span><div><h3 className="font-bold">{record.employee.name}</h3><p className="text-sm text-slate-500">{date(record.workDate)}</p></div></div><div className="mt-4 grid grid-cols-2 text-sm"><p className="text-slate-500">Clock in <b className="block text-slate-800">{time(record.clockInAt)}</b></p><p className="text-slate-500">Clock out <b className="block text-slate-800">{time(record.clockOutAt)}</b></p></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><div><span className="block text-slate-400">Worked</span><strong className="text-sm text-slate-800">{record.totalWorkingHours ?? 0}h</strong></div><div><span className="block text-slate-400">OT</span><strong className="text-sm text-slate-800">{record.overtimeHours ?? 0}h</strong></div></div><span className="mt-4 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{record.clockOutAt ? "Completed" : "Clocked in"}</span><p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">{scheduleLabel(record.scheduleStatus)}</p></article>)}</div><div className="hidden overflow-hidden rounded-2xl bg-white shadow-card md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-5">Employee</th><th>Date</th><th>Clock in</th><th>Clock out</th><th>Worked</th><th>OT</th><th>Status</th></tr></thead><tbody>{attendance.map((record) => <tr key={record.id} className="border-t border-slate-100"><td className="p-5 font-bold">{record.employee.name}</td><td>{date(record.workDate)}</td><td>{time(record.clockInAt)}</td><td>{time(record.clockOutAt)}</td><td>{record.totalWorkingHours ?? 0}h</td><td>{record.overtimeHours ?? 0}h</td><td><span className="font-semibold text-emerald-700">{record.clockOutAt ? "Completed" : "Clocked in"}</span><span className="ml-3 text-xs font-bold uppercase tracking-wide text-slate-400">{scheduleLabel(record.scheduleStatus)}</span></td></tr>)}</tbody></table></div></section>
  </DashboardShell>;
}
