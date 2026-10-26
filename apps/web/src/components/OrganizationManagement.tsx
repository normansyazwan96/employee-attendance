import { useState, type FormEvent } from "react";
import { createAdminClient } from "../lib/admin-clients";
import { setSelectedOrganizationId } from "../lib/auth";
import { useLanguage } from "../lib/language-context";

const malaysiaStates = [
  ["01", "Johor"],
  ["02", "Kedah"],
  ["03", "Kelantan"],
  ["04", "Melaka"],
  ["05", "Negeri Sembilan"],
  ["06", "Pahang"],
  ["07", "Pulau Pinang"],
  ["08", "Perak"],
  ["09", "Perlis"],
  ["10", "Selangor"],
  ["11", "Terengganu"],
  ["12", "Sabah"],
  ["13", "Sarawak"],
  ["14", "Kuala Lumpur"],
  ["15", "Labuan"],
  ["16", "Putrajaya"],
] as const;

export function OrganizationManagement(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("14");
  const [isTest, setIsTest] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setError("");
    try { const client = await createAdminClient({ name, stateCode, isTest }); setSelectedOrganizationId(client.id); window.location.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Organisasi tidak dapat dicipta" : "Unable to create organization")); setBusy(false); }
  }
  return <section className="mb-8"><h2 className="text-lg font-semibold">{ms ? "Organisasi" : "Organizations"}</h2><p className="mt-1 text-sm text-slate-600">{ms ? "Cipta syarikat baharu dan jadikannya ruang kerja aktif." : "Create a new company and make it the active workspace."}</p>{error && <p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-2 xl:grid-cols-[1fr_13rem_12rem_auto]"><label className="grid gap-1 text-sm font-medium text-slate-700">{ms ? "Nama organisasi" : "Organization name"}<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"/></label><label className="grid gap-1 text-sm font-medium text-slate-700">{ms ? "Negeri organisasi" : "Organization state"}<select required value={stateCode} onChange={(event) => setStateCode(event.target.value)} className="h-11 rounded-md border border-slate-300 bg-white px-3 font-normal">{malaysiaStates.map(([code, stateName]) => <option key={code} value={code}>{stateName}</option>)}</select></label><label className="flex h-11 items-center gap-3 self-end rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={isTest} onChange={(event) => setIsTest(event.target.checked)}/><span>{ms ? "Organisasi ujian" : "Test organization"}</span></label><button disabled={busy} className="h-11 self-end rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? (ms ? "Mencipta..." : "Creating...") : (ms ? "Cipta" : "Create")}</button></form></section>;
}
