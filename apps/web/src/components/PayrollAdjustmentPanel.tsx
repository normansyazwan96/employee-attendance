import { Check, Mail, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getSession } from "../lib/auth";
import { createPayrollAdjustment, decidePayrollAdjustment, emailPayrollStatement, getPayrollDeliveryCapabilities, getPayrollStatementDeliveries, getPayrollStatements, getPendingPayrollAdjustments, type PayrollStatement, type PayrollStatementDelivery, type PendingPayrollAdjustment } from "../lib/payroll-statements";

const money = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });

export function PayrollAdjustmentPanel({ payPeriodId, ms }: { payPeriodId: string; ms: boolean }): JSX.Element {
  const [statements, setStatements] = useState<PayrollStatement[]>([]);
  const [pending, setPending] = useState<PendingPayrollAdjustment[]>([]);
  const [deliveries, setDeliveries] = useState<PayrollStatementDelivery[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [deliveryLanguages, setDeliveryLanguages] = useState<Record<string, "en" | "ms">>({});
  const [form, setForm] = useState({ employeeId: "", direction: "EARNING" as "EARNING" | "DEDUCTION", code: "", name: "", amount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const currentUserId = getSession()?.user.id;

  const load = useCallback(async (): Promise<void> => {
    try {
      const [items, pendingItems, deliveryItems, capabilities] = await Promise.all([getPayrollStatements(payPeriodId), getPendingPayrollAdjustments(payPeriodId), getPayrollStatementDeliveries(payPeriodId), getPayrollDeliveryCapabilities()]);
      setStatements(items);
      setPending(pendingItems);
      setDeliveries(deliveryItems);
      setEmailConfigured(capabilities.emailConfigured);
      setForm((current) => ({ ...current, employeeId: current.employeeId || items[0]?.employee.id || "" }));
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Tidak dapat memuatkan pelarasan" : "Unable to load adjustments")); }
  }, [ms, payPeriodId]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const amountSen = Math.round(Number(form.amount) * 100);
    if (!Number.isFinite(amountSen) || amountSen < 1) { setError(ms ? "Masukkan amaun yang sah" : "Enter a valid amount"); return; }
    setBusy(true);
    setError("");
    try {
      await createPayrollAdjustment(payPeriodId, { employeeId: form.employeeId, direction: form.direction, code: form.code, name: form.name, amountSen, reason: form.reason });
      setForm((current) => ({ ...current, code: "", name: "", amount: "", reason: "" }));
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Tidak dapat menambah pelarasan" : "Unable to add adjustment")); }
    finally { setBusy(false); }
  }

  async function decide(item: PendingPayrollAdjustment, outcome: "APPROVED" | "REJECTED"): Promise<void> {
    const note = decisionNotes[item.id]?.trim() ?? "";
    if (note.length < 3) { setError(ms ? "Masukkan nota keputusan sekurang-kurangnya 3 aksara" : "Enter a decision note of at least 3 characters"); return; }
    setBusy(true);
    setError("");
    try {
      await decidePayrollAdjustment(payPeriodId, item.id, { outcome, note });
      setDecisionNotes((current) => ({ ...current, [item.id]: "" }));
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Tidak dapat menyimpan keputusan" : "Unable to save decision")); }
    finally { setBusy(false); }
  }

  async function sendStatement(statement: PayrollStatement): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await emailPayrollStatement(payPeriodId, statement.id, deliveryLanguages[statement.id] ?? "en");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Tidak dapat menghantar penyata" : "Unable to send statement")); }
    finally { setBusy(false); }
  }

  const adjustments = statements.flatMap((statement) => statement.adjustments.map((adjustment) => ({ adjustment, employee: statement.employee })));
  return <section className="mt-5 border-t border-slate-200 pt-5">
    <div><h4 className="font-semibold">{ms ? "Pelarasan selepas kunci" : "Post-lock adjustments"}</h4><p className="mt-1 text-xs text-slate-500">{ms ? "Permohonan mesti diputuskan oleh pentadbir gaji lain sebelum menjejaskan penyata." : "A different payroll administrator must decide each request before it affects a statement."}</p></div>
    {error && <p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {statements.length > 0 && <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs font-semibold text-slate-600"><span className="mb-1 block">{ms ? "Pekerja" : "Employee"}</span><select required value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">{statements.map((statement) => <option key={statement.employee.id} value={statement.employee.id}>{statement.employee.firstName} {statement.employee.lastName}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600"><span className="mb-1 block">{ms ? "Jenis" : "Type"}</span><select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value as "EARNING" | "DEDUCTION" })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="EARNING">{ms ? "Pendapatan" : "Earning"}</option><option value="DEDUCTION">{ms ? "Potongan" : "Deduction"}</option></select></label>
      <label className="text-xs font-semibold text-slate-600"><span className="mb-1 block">{ms ? "Amaun (RM)" : "Amount (RM)"}</span><input required min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
      <label className="text-xs font-semibold text-slate-600"><span className="mb-1 block">{ms ? "Kod" : "Code"}</span><input required maxLength={30} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="BONUS_OCT" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm uppercase"/></label>
      <label className="text-xs font-semibold text-slate-600"><span className="mb-1 block">{ms ? "Nama" : "Name"}</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={ms ? "Nama pelarasan" : "Adjustment name"} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
      <label className="text-xs font-semibold text-slate-600"><span className="mb-1 block">{ms ? "Sebab" : "Reason"}</span><input required minLength={3} maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder={ms ? "Sebab pelarasan" : "Reason for adjustment"} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
      <button disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-3"><Plus size={16} aria-hidden="true"/>{busy ? (ms ? "Menghantar..." : "Submitting...") : (ms ? "Hantar untuk kelulusan" : "Submit for approval")}</button>
    </form>}
    {statements.length === 0 && <p className="mt-4 text-sm text-slate-500">{ms ? "Tiada hasil gaji terkunci yang boleh dilaraskan." : "There are no accessible locked payroll results to adjust."}</p>}
    {pending.length > 0 && <section className="mt-5"><h5 className="text-sm font-semibold">{ms ? "Menunggu keputusan organisasi" : "Organization approvals awaiting decision"}</h5><div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">{pending.map((item) => { const ownRequest = item.createdByUserId === currentUserId; return <div key={item.id} className="py-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.employee.firstName} {item.employee.lastName} · {item.name}</p><p className="mt-1 text-xs text-slate-500">{item.code} · {item.reason}</p><p className="mt-1 text-xs text-slate-500">{ms ? "Dihantar oleh" : "Submitted by"}: {item.createdBy?.displayName ?? item.createdBy?.username ?? "-"}</p></div><span className={item.direction === "DEDUCTION" ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>{item.direction === "DEDUCTION" ? "-" : "+"}{money.format(item.amountSen / 100)}</span></div>{ownRequest ? <p className="mt-3 text-xs font-semibold text-amber-700">{ms ? "Menunggu pentadbir gaji lain." : "Waiting for another payroll administrator."}</p> : <div className="mt-3 flex flex-col items-end gap-2 sm:flex-row"><label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-slate-600">{ms ? "Nota keputusan" : "Decision note"}<input value={decisionNotes[item.id] ?? ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [item.id]: event.target.value }))} minLength={3} maxLength={500} className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal"/></label><button type="button" disabled={busy} onClick={() => void decide(item, "APPROVED")} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50"><Check size={15}/>{ms ? "Lulus" : "Approve"}</button><button type="button" disabled={busy} onClick={() => void decide(item, "REJECTED")} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 disabled:opacity-50"><X size={15}/>{ms ? "Tolak" : "Reject"}</button></div>}</div>; })}</div></section>}
    <section className="mt-5 border-t border-slate-200 pt-5"><h5 className="text-sm font-semibold">{ms ? "Penghantaran penyata PDF" : "PDF statement delivery"}</h5><p className="mt-1 text-xs text-slate-500">{emailConfigured ? (ms ? "Hantar penyata PDF ke e-mel hubungan pekerja." : "Send a PDF statement to the employee's contact email.") : (ms ? "Penghantaran e-mel belum dikonfigurasi pada pelayan." : "Email delivery is not configured on this deployment.")}</p><div className="mt-3 divide-y divide-slate-200">{statements.map((statement) => <div key={statement.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold">{statement.employee.firstName} {statement.employee.lastName}</p><p className="text-xs text-slate-500">{statement.employee.contactEmail ?? (ms ? "Tiada e-mel hubungan" : "No contact email")}</p></div><div className="flex items-end gap-2"><label className="grid gap-1 text-xs font-semibold text-slate-600">{ms ? "Bahasa penyata" : "Statement language"}<select value={deliveryLanguages[statement.id] ?? "en"} onChange={(event) => setDeliveryLanguages((current) => ({ ...current, [statement.id]: event.target.value as "en" | "ms" }))} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-normal"><option value="en">EN</option><option value="ms">BM</option></select></label><button type="button" disabled={busy || !emailConfigured || !statement.employee.contactEmail} onClick={() => void sendStatement(statement)} className="inline-flex h-9 items-center gap-2 rounded-md border border-brand-300 bg-white px-3 text-xs font-semibold text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"><Mail size={14}/>{ms ? "E-mel PDF" : "Email PDF"}</button></div></div>)}</div>{deliveries.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase text-slate-500">{ms ? "Sejarah penghantaran" : "Delivery history"}</p><div className="mt-1 divide-y divide-slate-200">{deliveries.map((delivery) => <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"><span>{delivery.employee.firstName} {delivery.employee.lastName} · {delivery.recipientEmail} · {delivery.language.toUpperCase()}</span><span className={delivery.status === "SENT" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>{delivery.status}</span></div>)}</div></div>}</section>
    {adjustments.length > 0 && <div className="mt-5"><h5 className="text-sm font-semibold">{ms ? "Sejarah pelarasan" : "Adjustment history"}</h5><div className="mt-2 divide-y divide-slate-200">{adjustments.map(({ adjustment, employee }) => <div key={adjustment.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"><div><p className="font-semibold">{employee.firstName} {employee.lastName} · {adjustment.name}</p><p className="mt-1 text-xs text-slate-500">{adjustment.code} · {adjustment.reason}</p>{adjustment.decision && <p className="mt-1 text-xs text-slate-500">{adjustment.decision.note}</p>}</div><div className="text-right"><span className={adjustment.direction === "DEDUCTION" ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>{adjustment.direction === "DEDUCTION" ? "-" : "+"}{money.format(adjustment.amountSen / 100)}</span><span className={`mt-1 block text-[11px] font-semibold uppercase ${adjustment.status === "APPROVED" ? "text-emerald-700" : adjustment.status === "REJECTED" ? "text-rose-700" : "text-amber-700"}`}>{adjustment.status}</span></div></div>)}</div></div>}
  </section>;
}
