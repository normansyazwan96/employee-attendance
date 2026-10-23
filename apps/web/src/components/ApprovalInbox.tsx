import { useCallback, useEffect, useState } from "react";
import { getApprovalInbox, reviewCorrection, reviewLeave, type CorrectionRequest, type LeaveRequest } from "../lib/requests";
import { useLanguage } from "../lib/language-context";

export function ApprovalInbox(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { const result = await getApprovalInbox(); setCorrections(result.corrections); setLeave(result.leave); setError(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load approvals"); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function decide(kind: "correction" | "leave", id: string, decision: "APPROVED" | "REJECTED"): Promise<void> { setBusy(id); setError(""); try { if (kind === "correction") await reviewCorrection(id, decision); else await reviewLeave(id, decision); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to review request"); } finally { setBusy(""); } }
  const actions = (kind: "correction" | "leave", id: string) => <div className="flex gap-2"><button disabled={busy === id} onClick={() => void decide(kind, id, "APPROVED")} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{ms ? "Lulus" : "Approve"}</button><button disabled={busy === id} onClick={() => void decide(kind, id, "REJECTED")} className="rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">{ms ? "Tolak" : "Reject"}</button></div>;
  return <div className="space-y-7">
    {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <section><h2 className="text-lg font-semibold">{ms ? "Pembetulan kehadiran" : "Attendance corrections"}</h2><div className="mt-3 space-y-2">{corrections.map((item) => <article key={item.id} className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-lg p-4"><div><p className="font-semibold">{item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : "Employee"}</p><p className="mt-1 text-sm text-slate-600">{item.timesheetDay.workDate}: {item.reason}</p></div>{actions("correction", item.id)}</article>)}{corrections.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{ms ? "Tiada pembetulan menunggu." : "No corrections are waiting."}</p>}</div></section>
    <section><h2 className="text-lg font-semibold">{ms ? "Permohonan cuti" : "Leave requests"}</h2><div className="mt-3 space-y-2">{leave.map((item) => <article key={item.id} className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-lg p-4"><div><p className="font-semibold">{item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : "Employee"} · {item.leaveType.name}</p><p className="mt-1 text-sm text-slate-600">{item.startDate} - {item.endDate} · {Math.round(item.requestedMinutes / 60)}h</p></div>{actions("leave", item.id)}</article>)}{leave.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{ms ? "Tiada permohonan cuti menunggu." : "No leave requests are waiting."}</p>}</div></section>
  </div>;
}
