import { useEffect, useState } from "react";
import { getAdminClients, selectOrganizationContext, type AdminClient } from "../lib/admin-clients";
import { getSelectedOrganizationId, getSession, setSelectedOrganizationId } from "../lib/auth";
import { useLanguage } from "../lib/language-context";

export function OrganizationSelector(): JSX.Element | null {
  const { language } = useLanguage();
  const session = getSession();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [selected, setSelected] = useState(getSelectedOrganizationId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (session?.user.role !== "DEV_ADMIN" && session?.user.role !== "GLOBAL_ADMIN") return;
    getAdminClients().then((items) => {
      setClients(items);
      const current = getSelectedOrganizationId();
      if (current && !items.some((item) => item.id === current)) {
        setSelected("");
        setSelectedOrganizationId("");
        window.location.reload();
      }
    }).catch(() => setFailed(true));
  }, [session?.user.role]);

  if (session?.user.role !== "DEV_ADMIN" && session?.user.role !== "GLOBAL_ADMIN") return null;
  return <label className="grid gap-0.5 text-[10px] font-semibold uppercase text-slate-500">{language === "ms" ? "Organisasi aktif" : "Active organization"}<select title={failed ? (language === "ms" ? "Organisasi tidak dapat dimuatkan" : "Organizations could not be loaded") : undefined} value={selected} onChange={(event) => { const value = event.target.value; setSelected(value); void selectOrganizationContext(value).then(() => { setSelectedOrganizationId(value); window.location.reload(); }).catch(() => setFailed(true)); }} className="h-9 max-w-48 rounded-md border border-white bg-white/75 px-2 text-xs font-semibold normal-case text-slate-700 shadow-sm">
    <option value="">{language === "ms" ? "Pilih organisasi" : "Select organization"}</option>
    {clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.isTest ? (language === "ms" ? " (Ujian)" : " (Test)") : ""}</option>)}
  </select></label>;
}
