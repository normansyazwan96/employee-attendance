import { useEffect, useState } from "react";
import { DashboardShell } from "../components/layout";
import { getAdminAccounts, type AdminAccount } from "../lib/admin-accounts";
import { getAdminClients, type AdminClient } from "../lib/admin-clients";
import { getSelectedOrganizationId } from "../lib/auth";
import { useLanguage } from "../lib/language-context";

export function GlobalAdminPage(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [error, setError] = useState("");
  const selectedOrganization = getSelectedOrganizationId();

  useEffect(() => {
    Promise.all([getAdminClients(), getAdminAccounts()])
      .then(([clientItems, adminItems]) => { setClients(clientItems); setAdmins(adminItems); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load platform directory"));
  }, []);

  return <DashboardShell title={ms ? "Direktori platform" : "Platform directory"}>
    <div className="mb-6 max-w-3xl">
      <p className="text-sm leading-6 text-slate-600">{ms ? "Akses baca sahaja untuk organisasi dan pentadbir penyewa. Data kehadiran, gaji, cuti, lokasi kerja dan audit tidak tersedia untuk peranan ini." : "Read-only access to organizations and tenant administrators. Attendance, payroll, leave, worksite, and audit data are not available to this role."}</p>
    </div>
    {error && <p role="alert" className="mb-5 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <section className="grid gap-6 xl:grid-cols-2">
      <div>
        <h2 className="mb-3 text-base font-semibold">{ms ? "Organisasi" : "Organizations"} <span className="font-normal text-slate-500">({clients.length})</span></h2>
        <div className="overflow-hidden rounded-lg border border-white/80 bg-white/70">
          {clients.map((client) => <div key={client.id} className={`flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm last:border-0 ${client.id === selectedOrganization ? "bg-violet-50" : ""}`}><span className="font-semibold text-slate-800">{client.name}</span>{client.isTest && <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{ms ? "Ujian" : "Test"}</span>}</div>)}
          {clients.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{ms ? "Tiada organisasi." : "No organizations."}</p>}
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-base font-semibold">{ms ? "Pentadbir organisasi" : "Organization administrators"} <span className="font-normal text-slate-500">({admins.length})</span></h2>
        <div className="overflow-hidden rounded-lg border border-white/80 bg-white/70">
          {admins.map((admin) => <div key={admin.id} className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 text-sm last:border-0"><div className="min-w-0"><p className="truncate font-semibold text-slate-800">{admin.displayName || admin.username}</p><p className="truncate text-xs text-slate-500">@{admin.username} · {admin.clientName}</p></div><span className={`shrink-0 text-xs font-semibold ${admin.isActive ? "text-emerald-700" : "text-slate-500"}`}>{admin.isActive ? (ms ? "Aktif" : "Active") : (ms ? "Tidak aktif" : "Inactive")}</span></div>)}
          {admins.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{ms ? "Tiada pentadbir." : "No administrators."}</p>}
        </div>
      </div>
    </section>
  </DashboardShell>;
}
