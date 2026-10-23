import { useCallback, useEffect, useState } from "react";
import { getWorkforceTimesheets, type WorkforceTimesheet } from "../lib/workforce";
import { useLanguage } from "../lib/language-context";

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function hours(minutes: number): string { return (minutes / 60).toFixed(2); }

export function AdminTimesheets(): JSX.Element {
  const { language } = useLanguage(); const ms = language === "ms";
  const [filters, setFilters] = useState({ from: isoDate(-31), to: isoDate(0) });
  const [items, setItems] = useState<WorkforceTimesheet[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); try { setItems((await getWorkforceTimesheets({ ...filters, limit: 100 })).data); setError(""); } catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Lembaran masa tidak dapat dimuatkan" : "Unable to load timesheets")); } finally { setLoading(false); } }, [filters, ms]);
  useEffect(() => { void load(); }, [load]);
  return <div><div className="mb-4 flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">{ms ? "Dari" : "From"}<input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label><label className="text-xs font-semibold text-slate-600">{ms ? "Hingga" : "To"}<input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label><button type="button" onClick={() => void load()} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">{ms ? "Muat semula" : "Refresh"}</button></div>{error && <p role="alert" className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{loading ? <p className="py-10 text-center text-sm text-slate-500">{ms ? "Memuatkan lembaran masa..." : "Loading timesheets..."}</p> : <div className="overflow-x-auto rounded-lg border border-white/80 bg-white/70"><table className="w-full min-w-[64rem] text-left text-sm"><thead className="bg-white/80 text-xs uppercase text-slate-500"><tr><th className="p-4">{ms ? "Pekerja" : "Employee"}</th><th>{ms ? "Tarikh" : "Date"}</th><th>{ms ? "Biasa" : "Regular"}</th><th>OT</th><th>{ms ? "Cuti berbayar" : "Paid leave"}</th><th>{ms ? "Cuti tanpa gaji" : "Unpaid leave"}</th><th>{ms ? "Lewat" : "Late"}</th><th>{ms ? "Tidak hadir" : "Absent"}</th><th>{ms ? "Keadaan" : "State"}</th><th>{ms ? "Pengecualian" : "Exceptions"}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-200"><td className="p-4"><span className="font-semibold">{item.employee.firstName} {item.employee.lastName}</span><span className="block text-xs text-slate-500">{item.employee.employeeNumber ?? `@${item.employee.user.username}`}</span></td><td>{item.workDate}</td><td>{hours(item.regularMinutes)}h</td><td>{hours(item.overtimeMinutes)}h</td><td>{hours(item.paidLeaveMinutes)}h</td><td>{hours(item.unpaidLeaveMinutes)}h</td><td>{item.lateMinutes}m</td><td>{item.isAbsent ? (ms ? "Ya" : "Yes") : "-"}</td><td><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">{item.state}</span></td><td className="max-w-56 py-3 text-xs text-rose-700">{item.exceptionCodes.join(", ") || "-"}</td></tr>)}</tbody></table>{items.length === 0 && <p className="p-8 text-center text-sm text-slate-500">{ms ? "Tiada lembaran masa dalam julat ini." : "No timesheets in this range."}</p>}</div>}</div>;
}
