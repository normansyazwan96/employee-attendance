import { useState, type FormEvent } from "react";
import { createAdminClient } from "../lib/admin-clients";
import { setSelectedOrganizationId } from "../lib/auth";
import { useLanguage } from "../lib/language-context";

export function OrganizationManagement(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("14");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setError("");
    try { const client = await createAdminClient({ name, stateCode }); setSelectedOrganizationId(client.id); window.location.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : (ms ? "Organisasi tidak dapat dicipta" : "Unable to create organization")); setBusy(false); }
  }
  return <section className="mb-8"><h2 className="text-lg font-semibold">{ms ? "Organisasi" : "Organizations"}</h2><p className="mt-1 text-sm text-slate-600">{ms ? "Cipta syarikat baharu dan jadikannya ruang kerja aktif." : "Create a new company and make it the active workspace."}</p>{error && <p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-[1fr_8rem_auto]"><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={ms ? "Nama organisasi" : "Organization name"} className="h-11 rounded-md border border-slate-300 bg-white px-3"/><input required pattern="[0-9]{2}" value={stateCode} onChange={(event) => setStateCode(event.target.value)} aria-label={ms ? "Kod negeri Malaysia" : "Malaysian state code"} className="h-11 rounded-md border border-slate-300 bg-white px-3"/><button disabled={busy} className="h-11 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? (ms ? "Mencipta..." : "Creating...") : (ms ? "Cipta" : "Create")}</button></form></section>;
}
