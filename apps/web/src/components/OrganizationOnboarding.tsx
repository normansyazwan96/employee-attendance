import { CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { getAdminAccounts } from "../lib/admin-accounts";
import { getAdminClients } from "../lib/admin-clients";
import { getSelectedOrganizationId, getSession } from "../lib/auth";
import { useLanguage } from "../lib/language-context";
import { getShiftTemplates, getWorkPolicy, getWorkforceEmployees } from "../lib/workforce";
import { getWorksites } from "../lib/worksites";

type SetupStatus = {
  administrator: boolean;
  worksite: boolean;
  policy: boolean;
  shift: boolean;
  employees: boolean;
  organizationName: string | null;
  isTest: boolean | null;
};

const emptyStatus: SetupStatus = { administrator: false, worksite: false, policy: false, shift: false, employees: false, organizationName: null, isTest: null };

export function OrganizationOnboarding(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const session = getSession();
  const selectedOrganizationId = getSelectedOrganizationId();
  const [status, setStatus] = useState<SetupStatus>(emptyStatus);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const owner = session?.user.role === "DEV_ADMIN";
      const [worksites, policy, shifts, employees, administrators, organizations] = await Promise.all([
        getWorksites(),
        getWorkPolicy(),
        getShiftTemplates(),
        getWorkforceEmployees(),
        owner ? getAdminAccounts() : Promise.resolve([]),
        owner ? getAdminClients() : Promise.resolve([]),
      ]);
      const organization = organizations.find((item) => item.id === selectedOrganizationId);
      setStatus({
        administrator: owner ? administrators.some((item) => item.isActive && item.clientId === selectedOrganizationId) : true,
        worksite: worksites.some((item) => item.isActive),
        policy: Boolean(policy),
        shift: shifts.some((item) => item.isActive),
        employees: employees.some((item) => item.employmentStatus === "ACTIVE" && item.user.isActive),
        organizationName: organization?.name ?? null,
        isTest: organization?.isTest ?? null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (ms ? "Status persediaan tidak dapat dimuatkan" : "Unable to load setup status"));
    } finally {
      setLoading(false);
    }
  }, [ms, selectedOrganizationId, session?.user.role]);

  useEffect(() => { void load(); }, [load]);
  const steps = useMemo(() => [
    { key: "administrator", complete: status.administrator, label: ms ? "Pentadbir aktif" : "Active administrator", detail: ms ? "Sekurang-kurangnya seorang pentadbir penyewa boleh mengurus organisasi." : "At least one tenant administrator can manage the organization.", to: "/admin/settings#administrators" },
    { key: "worksite", complete: status.worksite, label: ms ? "Lokasi kerja aktif" : "Active worksite", detail: ms ? "Lokasi, negeri dan geofence tersedia untuk rekod kehadiran." : "A location, state, and geofence are available for attendance.", to: "/admin/worksites" },
    { key: "policy", complete: status.policy, label: ms ? "Polisi kerja disemak" : "Work policy reviewed", detail: ms ? "Tetapan masa, rehat, GPS dan pengekalan data telah tersedia." : "Time, break, GPS, and retention settings are available.", to: "/admin/settings#work-policy" },
    { key: "shift", complete: status.shift, label: ms ? "Templat syif aktif" : "Active shift template", detail: ms ? "Waktu bekerja boleh diberikan kepada pekerja." : "Working hours can be assigned to employees.", to: "/admin/schedules" },
    { key: "employees", complete: status.employees, label: ms ? "Pekerja aktif" : "Active employees", detail: ms ? "Sekurang-kurangnya seorang pekerja bersedia untuk menggunakan sistem." : "At least one employee is ready to use the system.", to: "/admin/employees" },
  ], [ms, status]);
  const completed = steps.filter((step) => step.complete).length;

  return <section className="mb-8 border-y border-slate-200 py-5" aria-labelledby="organization-setup-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex flex-wrap items-center gap-2"><h2 id="organization-setup-title" className="text-lg font-semibold">{ms ? "Persediaan organisasi" : "Organization setup"}</h2>{status.isTest !== null && <span className={`rounded-full px-2 py-1 text-xs font-semibold ${status.isTest ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{status.isTest ? (ms ? "Ujian" : "Test") : (ms ? "Langsung" : "Live")}</span>}</div><p className="mt-1 text-sm text-slate-600">{status.organizationName ? `${status.organizationName} · ` : ""}{loading ? (ms ? "Menyemak persediaan..." : "Checking setup...") : `${completed}/${steps.length} ${ms ? "langkah selesai" : "steps complete"}`}</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} title={ms ? "Muat semula status" : "Refresh status"} className="grid size-10 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${loading ? "animate-spin" : ""}`}/><span className="sr-only">{ms ? "Muat semula status" : "Refresh status"}</span></button>
    </div>
    {status.isTest && <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{ms ? "Organisasi ini ditandakan sebagai ujian. Gunakan organisasi Langsung yang berasingan sebelum memasukkan data pelanggan sebenar." : "This organization is marked as Test. Use a separate Live organization before entering real customer data."}</p>}
    {error && <p role="alert" className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
      {steps.map((step) => <div key={step.key} className="flex items-center gap-3 py-3"><span className={step.complete ? "text-emerald-600" : "text-slate-400"}>{step.complete ? <CheckCircle2 aria-hidden="true" className="size-5"/> : <Circle aria-hidden="true" className="size-5"/>}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{step.label}</p><p className="text-xs leading-5 text-slate-600">{step.detail}</p></div>{!step.complete && <NavLink to={step.to} className="shrink-0 text-sm font-semibold text-brand-700">{ms ? "Sediakan" : "Set up"}</NavLink>}</div>)}
    </div>
  </section>;
}
