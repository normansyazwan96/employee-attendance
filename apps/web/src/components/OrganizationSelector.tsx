import { useEffect, useState } from "react";
import { getAdminClients, type AdminClient } from "../lib/admin-clients";
import { getSelectedOrganizationId, getSession, setSelectedOrganizationId } from "../lib/auth";
import { useLanguage } from "../lib/language-context";

export function OrganizationSelector(): JSX.Element | null {
  const { language } = useLanguage();
  const session = getSession();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [selected, setSelected] = useState(getSelectedOrganizationId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (session?.user.role !== "DEV_ADMIN") return;
    getAdminClients().then((items) => {
      setClients(items);
      if ((!getSelectedOrganizationId() || !items.some((item) => item.id === getSelectedOrganizationId())) && items[0]) {
        setSelectedOrganizationId(items[0].id);
        window.location.reload();
      }
    }).catch(() => setFailed(true));
  }, [session?.user.role]);

  if (session?.user.role !== "DEV_ADMIN") return null;
  return <select aria-label={language === "ms" ? "Organisasi aktif" : "Active organization"} title={failed ? (language === "ms" ? "Organisasi tidak dapat dimuatkan" : "Organizations could not be loaded") : undefined} value={selected} onChange={(event) => { setSelected(event.target.value); setSelectedOrganizationId(event.target.value); window.location.reload(); }} className="h-10 max-w-48 rounded-md border border-white bg-white/75 px-2 text-xs font-semibold text-slate-700 shadow-sm">
    {clients.length === 0 && <option value="">{language === "ms" ? "Pilih organisasi" : "Select organization"}</option>}
    {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
  </select>;
}
