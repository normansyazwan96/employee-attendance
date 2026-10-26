import { BadgeDollarSign, Landmark, ListChecks, Settings2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getSession } from "../lib/auth";
import { useLanguage } from "../lib/language-context";
import {
  createEmployeePayComponent,
  createEmployeeStatutoryProfile,
  createPayProfile,
  createPayrollComponent,
  getEmployeePayComponents,
  getEmployeeStatutoryProfiles,
  getPayProfiles,
  getPayrollComponents,
  getPayrollPermissions,
  getPayrollSettings,
  updatePayrollPermission,
  updatePayrollSettings,
  type EmployeePayComponent,
  type EmployeeStatutoryProfile,
  type EpfContributionCategory,
  type PayProfile,
  type PayrollComponent,
  type PayrollCalculationBasis,
  type PayrollComponentType,
  type PayrollPermission,
  type PayrollSettings,
  type SocsoContributionCategory,
  type PayType,
} from "../lib/payroll";
import { getWorkforceEmployees, type WorkforceEmployee } from "../lib/workforce";

type FoundationView = "setup" | "profiles" | "statutory" | "items" | "access";
const inputClass = "h-11 rounded-md border border-slate-300 bg-white/85 px-3 text-sm text-slate-900";
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

function moneyFromSen(value: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value / 100);
}
function toSen(value: string): number {
  return Math.round(Number(value) * 100);
}

function employeeName(employee: { firstName: string; lastName: string; user: { username: string } }): string {
  return `${employee.firstName} ${employee.lastName} (${employee.user.username})`;
}

export function PayrollFoundationPanel(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const isDevAdmin = getSession()?.user.role === "DEV_ADMIN";
  const [view, setView] = useState<FoundationView>("setup");
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [employees, setEmployees] = useState<WorkforceEmployee[]>([]);
  const [profiles, setProfiles] = useState<PayProfile[]>([]);
  const [statutoryProfiles, setStatutoryProfiles] = useState<EmployeeStatutoryProfile[]>([]);
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [assignments, setAssignments] = useState<EmployeePayComponent[]>([]);
  const [permissions, setPermissions] = useState<PayrollPermission[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [profileForm, setProfileForm] = useState<{ employeeId: string; payType: PayType; baseRate: string; effectiveFrom: string; overtimeEligible: boolean }>({ employeeId: "", payType: "MONTHLY", baseRate: "", effectiveFrom: today, overtimeEligible: true });
  const [statutoryForm, setStatutoryForm] = useState<{ employeeId: string; epfCategory: EpfContributionCategory; socsoCategory: SocsoContributionCategory; eisEligible: boolean; effectiveFrom: string }>({ employeeId: "", epfCategory: "STANDARD_UNDER_60", socsoCategory: "FIRST", eisEligible: true, effectiveFrom: today });
  const [componentForm, setComponentForm] = useState<{ code: string; name: string; type: PayrollComponentType; calculationBasis: PayrollCalculationBasis; defaultValue: string; epfEligible: boolean; socsoEligible: boolean; eisEligible: boolean }>({ code: "", name: "", type: "EARNING", calculationBasis: "FIXED_AMOUNT", defaultValue: "", epfEligible: true, socsoEligible: true, eisEligible: true });
  const [assignmentForm, setAssignmentForm] = useState({ employeeId: "", payrollComponentId: "", amount: "", totalAmount: "", effectiveFrom: today, effectiveTo: "", consentReference: "", notes: "" });

  const load = useCallback(async () => {
    try {
      const [nextSettings, nextEmployees, nextProfiles, nextStatutoryProfiles, nextComponents, nextAssignments, nextPermissions] = await Promise.all([
        getPayrollSettings(),
        getWorkforceEmployees(),
        getPayProfiles(),
        getEmployeeStatutoryProfiles(),
        getPayrollComponents(),
        getEmployeePayComponents(),
        isDevAdmin ? getPayrollPermissions() : Promise.resolve([]),
      ]);
      setSettings(nextSettings);
      setEmployees(nextEmployees);
      setProfiles(nextProfiles);
      setStatutoryProfiles(nextStatutoryProfiles);
      setComponents(nextComponents);
      setAssignments(nextAssignments);
      setPermissions(nextPermissions);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (ms ? "Data gaji tidak dapat dimuatkan" : "Unable to load payroll data"));
    }
  }, [isDevAdmin, ms]);

  useEffect(() => { void load(); }, [load]);

  const selectedComponent = useMemo(() => components.find((item) => item.id === assignmentForm.payrollComponentId), [assignmentForm.payrollComponentId, components]);

  async function saveSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!settings) return;
    setBusy("settings");
    try {
      const updated = await updatePayrollSettings({
        jurisdiction: settings.jurisdiction,
        payFrequency: settings.payFrequency,
        normalDailyMinutes: settings.normalDailyMinutes,
        normalWeeklyMinutes: settings.normalWeeklyMinutes,
        salaryDivisor: settings.salaryDivisor,
        statutoryContributionsEnabled: settings.statutoryContributionsEnabled,
      });
      setSettings(updated);
      setNotice(ms ? "Tetapan gaji disimpan." : "Payroll settings saved.");
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save settings"); }
    finally { setBusy(""); }
  }

  async function submitStatutoryProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy("statutory");
    try {
      await createEmployeeStatutoryProfile(statutoryForm);
      setStatutoryForm({ ...statutoryForm, employeeId: "", effectiveFrom: today });
      setNotice(ms ? "Profil caruman berkanun ditambah." : "Statutory contribution profile added.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to add statutory profile"); }
    finally { setBusy(""); }
  }

  async function submitProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!settings) return;
    setBusy("profile");
    try {
      await createPayProfile({
        employeeId: profileForm.employeeId,
        payType: profileForm.payType,
        baseRateSen: toSen(profileForm.baseRate),
        normalDailyMinutes: settings.normalDailyMinutes,
        normalWeeklyMinutes: settings.normalWeeklyMinutes,
        overtimeEligible: profileForm.overtimeEligible,
        effectiveFrom: profileForm.effectiveFrom,
      });
      setProfileForm({ ...profileForm, employeeId: "", baseRate: "", effectiveFrom: today });
      setNotice(ms ? "Profil gaji ditambah." : "Pay profile added.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to add pay profile"); }
    finally { setBusy(""); }
  }

  async function submitComponent(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy("component");
    try {
      const percentage = componentForm.calculationBasis === "PERCENTAGE";
      await createPayrollComponent({
        code: componentForm.code,
        name: componentForm.name,
        type: componentForm.type,
        calculationBasis: componentForm.calculationBasis,
        defaultAmountSen: percentage ? 0 : toSen(componentForm.defaultValue),
        defaultPercentageBps: percentage ? Math.round(Number(componentForm.defaultValue) * 100) : null,
        epfEligible: componentForm.type === "EARNING" && componentForm.epfEligible,
        socsoEligible: componentForm.type === "EARNING" && componentForm.socsoEligible,
        eisEligible: componentForm.type === "EARNING" && componentForm.eisEligible,
      });
      setComponentForm({ code: "", name: "", type: "EARNING", calculationBasis: "FIXED_AMOUNT", defaultValue: "", epfEligible: true, socsoEligible: true, eisEligible: true });
      setNotice(ms ? "Item gaji ditambah." : "Payroll item added.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to add payroll item"); }
    finally { setBusy(""); }
  }

  async function submitAssignment(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedComponent) return;
    setBusy("assignment");
    try {
      const percentage = selectedComponent.calculationBasis === "PERCENTAGE";
      await createEmployeePayComponent({
        employeeId: assignmentForm.employeeId,
        payrollComponentId: assignmentForm.payrollComponentId,
        amountSen: percentage ? 0 : toSen(assignmentForm.amount),
        percentageBasisPoints: percentage ? Math.round(Number(assignmentForm.amount) * 100) : null,
        totalAmountSen: selectedComponent.type === "ADVANCE_REPAYMENT" ? toSen(assignmentForm.totalAmount) : null,
        effectiveFrom: assignmentForm.effectiveFrom,
        effectiveTo: assignmentForm.effectiveTo || null,
        consentReference: assignmentForm.consentReference || null,
        notes: assignmentForm.notes || null,
      });
      setAssignmentForm({ employeeId: "", payrollComponentId: "", amount: "", totalAmount: "", effectiveFrom: today, effectiveTo: "", consentReference: "", notes: "" });
      setNotice(ms ? "Item pekerja ditambah." : "Employee payroll item added.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to assign payroll item"); }
    finally { setBusy(""); }
  }

  const tabs = [
    { id: "setup" as const, icon: Settings2, label: ms ? "Tetapan" : "Setup" },
    { id: "profiles" as const, icon: BadgeDollarSign, label: ms ? "Profil gaji" : "Pay profiles" },
    { id: "statutory" as const, icon: Landmark, label: ms ? "Caruman" : "Contributions" },
    { id: "items" as const, icon: ListChecks, label: ms ? "Item gaji" : "Pay items" },
    ...(isDevAdmin ? [{ id: "access" as const, icon: ShieldCheck, label: ms ? "Akses" : "Access" }] : []),
  ];

  return <div className="space-y-6">
    <div role="tablist" aria-label={ms ? "Tetapan asas gaji" : "Payroll foundation"} className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      {tabs.map(({ id, icon: Icon, label }) => <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold ${view === id ? "bg-ink text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}><Icon size={16}/>{label}</button>)}
    </div>
    <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{ms ? "Pengiraan sahaja. Tiada pembayaran akan dibuat." : "Calculation only. No payment will be initiated."}</div>
    {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    {view === "setup" && settings && <form onSubmit={(event) => void saveSettings(event)} className="glass-panel grid gap-4 rounded-lg p-5 md:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium">{ms ? "Bidang kuasa" : "Jurisdiction"}<select value={settings.jurisdiction} onChange={(event) => setSettings({ ...settings, jurisdiction: event.target.value as PayrollSettings["jurisdiction"] })} className={inputClass}><option value="PENINSULAR_LABUAN">{ms ? "Semenanjung Malaysia dan Labuan" : "Peninsular Malaysia and Labuan"}</option><option value="SABAH">Sabah</option><option value="SARAWAK">Sarawak</option></select></label>
      <label className="grid gap-1 text-sm font-medium">{ms ? "Kekerapan gaji" : "Pay frequency"}<select value={settings.payFrequency} onChange={(event) => setSettings({ ...settings, payFrequency: event.target.value as PayrollSettings["payFrequency"] })} className={inputClass}><option value="MONTHLY">{ms ? "Bulanan" : "Monthly"}</option><option value="SEMI_MONTHLY">{ms ? "Dua kali sebulan" : "Twice monthly"}</option><option value="WEEKLY">{ms ? "Mingguan" : "Weekly"}</option></select></label>
      <label className="grid gap-1 text-sm font-medium">{ms ? "Minit kerja sehari" : "Normal minutes per day"}<input type="number" min={60} max={1440} value={settings.normalDailyMinutes} onChange={(event) => setSettings({ ...settings, normalDailyMinutes: Number(event.target.value) })} className={inputClass}/></label>
      <label className="grid gap-1 text-sm font-medium">{ms ? "Minit kerja seminggu" : "Normal minutes per week"}<input type="number" min={60} max={10080} value={settings.normalWeeklyMinutes} onChange={(event) => setSettings({ ...settings, normalWeeklyMinutes: Number(event.target.value) })} className={inputClass}/></label>
      <label className="grid gap-1 text-sm font-medium">{ms ? "Pembahagi gaji bulanan" : "Monthly salary divisor"}<input type="number" min={1} max={31} value={settings.salaryDivisor} onChange={(event) => setSettings({ ...settings, salaryDivisor: Number(event.target.value) })} className={inputClass}/></label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={settings.statutoryContributionsEnabled} onChange={(event) => setSettings({ ...settings, statutoryContributionsEnabled: event.target.checked })}/><span>{ms ? "Aktifkan pengiraan KWSP, PERKESO dan SIP" : "Enable EPF, SOCSO, and EIS calculations"}</span></label>
      <div className="grid content-end gap-1 text-sm"><span className="text-slate-500">{ms ? "Versi peraturan" : "Rule version"}</span><strong>{settings.rulePackVersion}</strong></div>
      <div className="grid content-end gap-1 text-sm md:col-span-2"><span className="text-slate-500">{ms ? "Versi caruman berkanun" : "Statutory contribution version"}</span><strong>{settings.statutoryRuleVersion}</strong><span className="text-xs text-slate-500">{ms ? "Aktifkan hanya selepas profil caruman setiap pekerja disediakan." : "Enable only after every employee has a contribution profile."}</span></div>
      <button disabled={busy === "settings"} className="h-11 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white md:col-span-2">{busy === "settings" ? (ms ? "Menyimpan..." : "Saving...") : (ms ? "Simpan tetapan" : "Save settings")}</button>
    </form>}

    {view === "profiles" && <div className="space-y-5">
      <form onSubmit={(event) => void submitProfile(event)} className="glass-panel grid gap-3 rounded-lg p-5 md:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">{ms ? "Pekerja" : "Employee"}<select required value={profileForm.employeeId} onChange={(event) => setProfileForm({ ...profileForm, employeeId: event.target.value })} className={inputClass}><option value="">{ms ? "Pilih pekerja" : "Select employee"}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.user.username})</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Jenis gaji" : "Pay type"}<select value={profileForm.payType} onChange={(event) => setProfileForm({ ...profileForm, payType: event.target.value as typeof profileForm.payType })} className={inputClass}><option value="MONTHLY">{ms ? "Bulanan" : "Monthly"}</option><option value="DAILY">{ms ? "Harian" : "Daily"}</option><option value="HOURLY">{ms ? "Setiap jam" : "Hourly"}</option></select></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Kadar asas (RM)" : "Base rate (RM)"}<input required type="number" min="0.01" step="0.01" value={profileForm.baseRate} onChange={(event) => setProfileForm({ ...profileForm, baseRate: event.target.value })} className={inputClass}/></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Berkuat kuasa dari" : "Effective from"}<input required type="date" value={profileForm.effectiveFrom} onChange={(event) => setProfileForm({ ...profileForm, effectiveFrom: event.target.value })} className={inputClass}/></label>
        <label className="flex h-11 items-center gap-2 text-sm"><input type="checkbox" checked={profileForm.overtimeEligible} onChange={(event) => setProfileForm({ ...profileForm, overtimeEligible: event.target.checked })}/>{ms ? "Layak kerja lebih masa" : "Overtime eligible"}</label>
        <button disabled={busy === "profile"} className="h-11 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white">{ms ? "Tambah profil" : "Add profile"}</button>
      </form>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">{ms ? "Pekerja" : "Employee"}</th><th className="px-3 py-2">{ms ? "Jenis" : "Type"}</th><th className="px-3 py-2">{ms ? "Kadar" : "Rate"}</th><th className="px-3 py-2">{ms ? "Berkuat kuasa" : "Effective"}</th><th className="px-3 py-2">OT</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id} className="border-b border-slate-100"><td className="px-3 py-3 font-medium">{employeeName(profile.employee)}</td><td className="px-3 py-3">{profile.payType}</td><td className="px-3 py-3">{moneyFromSen(profile.baseRateSen)}</td><td className="px-3 py-3">{profile.effectiveFrom}{profile.effectiveTo ? ` - ${profile.effectiveTo}` : ""}</td><td className="px-3 py-3">{profile.overtimeEligible ? (ms ? "Ya" : "Yes") : (ms ? "Tidak" : "No")}</td></tr>)}</tbody></table>{profiles.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{ms ? "Belum ada profil gaji." : "No pay profiles yet."}</p>}</div>
    </div>}

    {view === "statutory" && <div className="space-y-5">
      <div><h4 className="font-semibold">{ms ? "Profil caruman pekerja" : "Employee contribution profiles"}</h4><p className="mt-1 text-xs text-slate-500">{ms ? "Tetapkan kategori berkuat kuasa sebelum mengaktifkan pengiraan caruman organisasi." : "Assign effective-dated categories before enabling organization contribution calculations."}</p></div>
      <form onSubmit={(event) => void submitStatutoryProfile(event)} className="glass-panel grid gap-3 rounded-lg p-5 md:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">{ms ? "Pekerja" : "Employee"}<select required value={statutoryForm.employeeId} onChange={(event) => setStatutoryForm({ ...statutoryForm, employeeId: event.target.value })} className={inputClass}><option value="">{ms ? "Pilih pekerja" : "Select employee"}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.user.username})</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">EPF / KWSP<select value={statutoryForm.epfCategory} onChange={(event) => setStatutoryForm({ ...statutoryForm, epfCategory: event.target.value as EpfContributionCategory })} className={inputClass}><option value="STANDARD_UNDER_60">{ms ? "Standard bawah 60 (Bahagian A)" : "Standard under 60 (Part A)"}</option><option value="PR_OR_PRE_1998_60_PLUS">{ms ? "PR / ahli pra-1998 umur 60+ (Bahagian C)" : "PR / pre-1998 member age 60+ (Part C)"}</option><option value="MALAYSIAN_60_PLUS">{ms ? "Warganegara umur 60+ (Bahagian E)" : "Malaysian citizen age 60+ (Part E)"}</option><option value="NON_MALAYSIAN">{ms ? "Bukan warganegara (Bahagian F)" : "Non-Malaysian (Part F)"}</option><option value="EXEMPT">{ms ? "Dikecualikan" : "Exempt"}</option></select></label>
        <label className="grid gap-1 text-sm font-medium">SOCSO / PERKESO<select value={statutoryForm.socsoCategory} onChange={(event) => setStatutoryForm({ ...statutoryForm, socsoCategory: event.target.value as SocsoContributionCategory })} className={inputClass}><option value="FIRST">{ms ? "Kategori pertama" : "First category"}</option><option value="SECOND">{ms ? "Kategori kedua" : "Second category"}</option><option value="EXEMPT">{ms ? "Dikecualikan" : "Exempt"}</option></select></label>
        <label className="flex h-11 items-center gap-2 text-sm"><input type="checkbox" checked={statutoryForm.eisEligible} onChange={(event) => setStatutoryForm({ ...statutoryForm, eisEligible: event.target.checked })}/>{ms ? "Layak SIP" : "EIS eligible"}</label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Berkuat kuasa" : "Effective from"}<input required type="date" value={statutoryForm.effectiveFrom} onChange={(event) => setStatutoryForm({ ...statutoryForm, effectiveFrom: event.target.value })} className={inputClass}/></label>
        <button disabled={busy === "statutory"} className="h-11 self-end rounded-md bg-brand-600 px-4 text-sm font-semibold text-white">{ms ? "Tambah profil caruman" : "Add contribution profile"}</button>
      </form>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">{ms ? "Pekerja" : "Employee"}</th><th className="px-3 py-2">EPF</th><th className="px-3 py-2">SOCSO</th><th className="px-3 py-2">EIS</th><th className="px-3 py-2">{ms ? "Berkuat kuasa" : "Effective"}</th></tr></thead><tbody>{statutoryProfiles.map((profile) => <tr key={profile.id} className="border-b border-slate-100"><td className="px-3 py-3 font-medium">{employeeName(profile.employee)}</td><td className="px-3 py-3">{profile.epfCategory}</td><td className="px-3 py-3">{profile.socsoCategory}</td><td className="px-3 py-3">{profile.eisEligible ? (ms ? "Layak" : "Eligible") : (ms ? "Dikecualikan" : "Exempt")}</td><td className="px-3 py-3">{profile.effectiveFrom}{profile.effectiveTo ? ` - ${profile.effectiveTo}` : ""}</td></tr>)}</tbody></table>{statutoryProfiles.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{ms ? "Belum ada profil caruman." : "No contribution profiles yet."}</p>}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-brand-700"><a href="https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025" target="_blank" rel="noreferrer">EPF / KWSP</a><a href="https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf" target="_blank" rel="noreferrer">SOCSO / PERKESO</a><a href="https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf" target="_blank" rel="noreferrer">EIS / SIP</a></div>
    </div>}

    {view === "items" && <div className="space-y-6">
      <form onSubmit={(event) => void submitComponent(event)} className="glass-panel grid gap-3 rounded-lg p-5 md:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">{ms ? "Kod item" : "Item code"}<input required value={componentForm.code} onChange={(event) => setComponentForm({ ...componentForm, code: event.target.value })} className={inputClass}/></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Nama item" : "Item name"}<input required value={componentForm.name} onChange={(event) => setComponentForm({ ...componentForm, name: event.target.value })} className={inputClass}/></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Jenis item" : "Item type"}<select value={componentForm.type} onChange={(event) => setComponentForm({ ...componentForm, type: event.target.value as typeof componentForm.type, calculationBasis: event.target.value === "ADVANCE_REPAYMENT" ? "FIXED_AMOUNT" : componentForm.calculationBasis })} className={inputClass}><option value="EARNING">{ms ? "Pendapatan" : "Earning"}</option><option value="DEDUCTION">{ms ? "Potongan" : "Deduction"}</option><option value="ADVANCE_REPAYMENT">{ms ? "Bayaran balik pendahuluan" : "Advance repayment"}</option></select></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Asas pengiraan" : "Calculation basis"}<select value={componentForm.calculationBasis} disabled={componentForm.type === "ADVANCE_REPAYMENT"} onChange={(event) => setComponentForm({ ...componentForm, calculationBasis: event.target.value as typeof componentForm.calculationBasis })} className={inputClass}><option value="FIXED_AMOUNT">{ms ? "Amaun tetap" : "Fixed amount"}</option><option value="PER_DAY">{ms ? "Setiap hari" : "Per day"}</option><option value="PER_HOUR">{ms ? "Setiap jam" : "Per hour"}</option><option value="PERCENTAGE">{ms ? "Peratus" : "Percentage"}</option></select></label>
        <label className="grid gap-1 text-sm font-medium">{componentForm.calculationBasis === "PERCENTAGE" ? (ms ? "Peratus lalai" : "Default percentage") : (ms ? "Amaun lalai (RM)" : "Default amount (RM)")}<input required type="number" min="0.01" step="0.01" value={componentForm.defaultValue} onChange={(event) => setComponentForm({ ...componentForm, defaultValue: event.target.value })} className={inputClass}/></label>
        {componentForm.type === "EARNING" && <div className="flex min-h-11 flex-wrap items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={componentForm.epfEligible} onChange={(event) => setComponentForm({ ...componentForm, epfEligible: event.target.checked })}/>EPF</label><label className="flex items-center gap-2"><input type="checkbox" checked={componentForm.socsoEligible} onChange={(event) => setComponentForm({ ...componentForm, socsoEligible: event.target.checked })}/>SOCSO</label><label className="flex items-center gap-2"><input type="checkbox" checked={componentForm.eisEligible} onChange={(event) => setComponentForm({ ...componentForm, eisEligible: event.target.checked })}/>EIS</label></div>}
        <button disabled={busy === "component"} className="h-11 rounded-md bg-ink px-4 text-sm font-semibold text-white">{ms ? "Tambah item" : "Add item"}</button>
      </form>

      <form onSubmit={(event) => void submitAssignment(event)} className="grid gap-3 border-y border-slate-200 py-5 md:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">{ms ? "Pekerja" : "Employee"}<select required value={assignmentForm.employeeId} onChange={(event) => setAssignmentForm({ ...assignmentForm, employeeId: event.target.value })} className={inputClass}><option value="">{ms ? "Pilih pekerja" : "Select employee"}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.user.username})</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Item gaji" : "Payroll item"}<select required value={assignmentForm.payrollComponentId} onChange={(event) => { const component = components.find((item) => item.id === event.target.value); const defaultValue = component?.calculationBasis === "PERCENTAGE" ? String((component.defaultPercentageBps ?? 0) / 100) : String((component?.defaultAmountSen ?? 0) / 100); setAssignmentForm({ ...assignmentForm, payrollComponentId: event.target.value, amount: defaultValue, totalAmount: "", consentReference: "" }); }} className={inputClass}><option value="">{ms ? "Pilih item gaji" : "Select payroll item"}</option>{components.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">{selectedComponent?.calculationBasis === "PERCENTAGE" ? (ms ? "Peratus" : "Percentage") : (ms ? "Amaun setiap tempoh (RM)" : "Amount per period (RM)")}<input required type="number" min="0.01" step="0.01" value={assignmentForm.amount} onChange={(event) => setAssignmentForm({ ...assignmentForm, amount: event.target.value })} className={inputClass}/></label>
        {selectedComponent?.type === "ADVANCE_REPAYMENT" && <label className="grid gap-1 text-sm font-medium">{ms ? "Jumlah pendahuluan (RM)" : "Total advance (RM)"}<input required type="number" min="0.01" step="0.01" value={assignmentForm.totalAmount} onChange={(event) => setAssignmentForm({ ...assignmentForm, totalAmount: event.target.value })} className={inputClass}/></label>}
        <label className="grid gap-1 text-sm font-medium">{ms ? "Berkuat kuasa dari" : "Effective from"}<input required type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm({ ...assignmentForm, effectiveFrom: event.target.value })} className={inputClass}/></label>
        <label className="grid gap-1 text-sm font-medium">{ms ? "Berkuat kuasa hingga (pilihan)" : "Effective to (optional)"}<input type="date" value={assignmentForm.effectiveTo} onChange={(event) => setAssignmentForm({ ...assignmentForm, effectiveTo: event.target.value })} className={inputClass}/></label>
        {selectedComponent && selectedComponent.type !== "EARNING" && <label className="grid gap-1 text-sm font-medium">{ms ? "Rujukan kebenaran" : "Authorization reference"}<input required value={assignmentForm.consentReference} onChange={(event) => setAssignmentForm({ ...assignmentForm, consentReference: event.target.value })} className={inputClass}/></label>}
        <label className="grid gap-1 text-sm font-medium">{ms ? "Nota (pilihan)" : "Notes (optional)"}<input value={assignmentForm.notes} onChange={(event) => setAssignmentForm({ ...assignmentForm, notes: event.target.value })} className={inputClass}/></label>
        <button disabled={busy === "assignment" || !selectedComponent} className="h-11 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{ms ? "Tetapkan kepada pekerja" : "Assign to employee"}</button>
      </form>

      <div className="space-y-2">{assignments.map((assignment) => <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-3 text-sm"><div><strong>{employeeName(assignment.employee)}</strong><p className="text-slate-600">{assignment.payrollComponent.name} · {assignment.percentageBasisPoints ? `${assignment.percentageBasisPoints / 100}%` : moneyFromSen(assignment.amountSen)}{assignment.totalAmountSen ? ` · ${ms ? "Baki" : "Balance"} ${moneyFromSen(assignment.outstandingAmountSen ?? 0)}` : ""}</p></div><span className="text-xs text-slate-500">{assignment.effectiveFrom}{assignment.effectiveTo ? ` - ${assignment.effectiveTo}` : ""}</span></div>)}{assignments.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{ms ? "Belum ada item pekerja." : "No employee payroll items yet."}</p>}</div>
    </div>}

    {view === "access" && <div className="divide-y divide-slate-200 border-y border-slate-200">{permissions.map((permission) => <label key={permission.id} className="flex items-center justify-between gap-4 py-4 text-sm"><span><strong>{permission.user.displayName ?? permission.user.username}</strong><span className="ml-2 text-slate-500">@{permission.user.username}</span></span><input type="checkbox" checked={permission.canManagePayroll} disabled={busy === permission.id || !permission.user.isActive} onChange={async (event) => { setBusy(permission.id); try { await updatePayrollPermission(permission.id, event.target.checked); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update access"); } finally { setBusy(""); } }}/></label>)}</div>}
  </div>;
}
