import { Download, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { BottomNav, EmployeeHeader } from "../components/layout";
import { downloadMyPayrollStatement, getMyPayrollStatements, type PayrollStatement } from "../lib/payroll-statements";
import { useLanguage } from "../lib/language-context";

const money = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });

export function PayrollStatementsPage(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const [statements, setStatements] = useState<PayrollStatement[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    getMyPayrollStatements().then(setStatements).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : (ms ? "Tidak dapat memuatkan penyata gaji" : "Unable to load payroll statements"))).finally(() => setLoading(false));
  }, [ms]);

  async function download(statement: PayrollStatement): Promise<void> {
    setDownloading(statement.period.id);
    setError("");
    try { await downloadMyPayrollStatement(statement.period.id, language); }
    catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Tidak dapat memuat turun penyata" : "Unable to download statement")); }
    finally { setDownloading(""); }
  }

  return <div className="app-canvas mx-auto max-w-3xl pb-28"><EmployeeHeader/><main className="px-4 sm:px-5">
    <div className="flex items-center gap-3"><ReceiptText className="text-brand-600" aria-hidden="true"/><div><p className="text-sm font-medium text-slate-500">{ms ? "Rekod pengiraan" : "Calculation records"}</p><h1 className="text-2xl font-semibold">{ms ? "Penyata gaji saya" : "My payroll statements"}</h1></div></div>
    <p className="mt-3 text-sm text-slate-600">{ms ? "Penyata dipaparkan selepas tempoh gaji dikunci. Ia bukan bukti pembayaran." : "Statements appear after a pay period is locked. They are not proof of payment."}</p>
    {error && <p role="alert" className="mt-5 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {loading && <p className="mt-8 text-sm text-slate-500">{ms ? "Memuatkan penyata..." : "Loading statements..."}</p>}
    {!loading && statements.length === 0 && <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-7 text-center"><p className="font-semibold">{ms ? "Belum ada penyata gaji" : "No payroll statements yet"}</p><p className="mt-1 text-sm text-slate-500">{ms ? "Penyata pertama anda akan muncul selepas gaji dikunci." : "Your first statement will appear after payroll is locked."}</p></div>}
    <div className="mt-6 space-y-4">{statements.map((statement) => <article key={statement.id} className="glass-panel rounded-lg p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">{statement.period.name}</h2><p className="mt-1 text-sm text-slate-500">{statement.period.startDate} - {statement.period.endDate}</p></div><button type="button" onClick={() => void download(statement)} disabled={downloading === statement.period.id} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"><Download size={16} aria-hidden="true"/>{downloading === statement.period.id ? (ms ? "Memuat turun..." : "Downloading...") : (ms ? "Muat turun PDF" : "Download PDF")}</button></div>
      <div className="mt-5 grid grid-cols-2 gap-4 border-y border-slate-200 py-4 sm:grid-cols-5"><Amount label={ms ? "Kasar" : "Gross"} value={statement.calculation.grossPaySen}/><Amount label={ms ? "Potongan" : "Deductions"} value={statement.calculation.totalDeductionsSen}/><Amount label={ms ? "Caruman majikan" : "Employer contributions"} value={statement.calculation.employerContributionsSen}/><Amount label={ms ? "Pelarasan" : "Adjustments"} value={statement.adjustmentEarningsSen - statement.adjustmentDeductionsSen}/><Amount label={ms ? "Jumlah akhir" : "Final amount"} value={statement.finalCalculatedPaySen} strong/></div>
      <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-brand-700">{ms ? "Lihat pecahan" : "View breakdown"}</summary><div className="mt-3 divide-y divide-slate-200 text-sm">{statement.calculation.lines.map((line) => <div key={line.id} className="flex justify-between gap-3 py-2"><span className="text-slate-600">{line.name}</span><span className={line.direction === "DEDUCTION" ? "text-rose-700" : line.direction === "EMPLOYER_CONTRIBUTION" ? "text-brand-700" : ""}>{line.direction === "DEDUCTION" ? "-" : ""}{money.format(line.amountSen / 100)}</span></div>)}{statement.adjustments.map((item) => <div key={item.id} className="py-2"><div className="flex justify-between gap-3"><span className="text-slate-700">{item.name}</span><span className={item.direction === "DEDUCTION" ? "text-rose-700" : "text-emerald-700"}>{item.direction === "DEDUCTION" ? "-" : "+"}{money.format(item.amountSen / 100)}</span></div><p className="mt-1 text-xs text-slate-500">{item.reason}</p></div>)}</div></details>
    </article>)}</div>
  </main><BottomNav/></div>;
}

function Amount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }): JSX.Element {
  return <div className={strong ? "text-brand-700" : ""}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold tabular-nums">{money.format(value / 100)}</p></div>;
}
