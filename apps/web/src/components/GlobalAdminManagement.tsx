import { useEffect, useState, type FormEvent } from "react";
import { createGlobalAdminAccount, getGlobalAdminAccounts, resetGlobalAdminPassword, updateGlobalAdminAccountStatus, type AdminAccount, type AdminAccountInput } from "../lib/admin-accounts";
import { useLanguage } from "../lib/language-context";

const emptyForm: AdminAccountInput = { username: "", displayName: "", password: "" };

export function GlobalAdminManagement(): JSX.Element {
  const { language } = useLanguage();
  const ms = language === "ms";
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [form, setForm] = useState<AdminAccountInput>(emptyForm);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { getGlobalAdminAccounts().then(setAccounts).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load global administrators")); }, []);

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const account = await createGlobalAdminAccount(form);
      setAccounts((current) => [...current, account].sort((a, b) => a.username.localeCompare(b.username)));
      setForm(emptyForm);
      setMessage(ms ? "Pentadbir global dicipta." : "Global administrator created.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create global administrator"); }
    finally { setSaving(false); }
  }

  async function toggle(account: AdminAccount): Promise<void> {
    try {
      const updated = await updateGlobalAdminAccountStatus(account.id, !account.isActive);
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update global administrator"); }
  }

  async function reset(event: FormEvent, account: AdminAccount): Promise<void> {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      await resetGlobalAdminPassword(account.id, resetPassword);
      setResetTarget(null); setResetPassword("");
      setMessage(ms ? "Kata laluan sementara ditetapkan." : "Temporary password set.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to reset password"); }
    finally { setSaving(false); }
  }

  return <section className="mt-10">
    <div className="mb-4"><h2 className="text-lg font-bold">{ms ? "Pentadbir global" : "Global administrators"}</h2><p className="text-sm text-slate-500">{ms ? "Akaun sokongan baca sahaja tanpa akses kepada operasi organisasi." : "Read-only support accounts without access to organization operations."}</p></div>
    {error && <p role="alert" className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={(event) => void create(event)} className="glass-panel rounded-lg p-5">
        <h3 className="font-semibold">{ms ? "Tambah pentadbir global" : "Add global administrator"}</h3>
        <label className="mt-4 grid gap-1 text-sm font-medium text-slate-700">{ms ? "Nama paparan" : "Display name"}<input required maxLength={120} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} className="h-11 rounded-md border border-slate-300 bg-white/80 px-3 font-normal" /></label>
        <label className="mt-3 grid gap-1 text-sm font-medium text-slate-700">{ms ? "Nama pengguna" : "Username"}<input required minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className="h-11 rounded-md border border-slate-300 bg-white/80 px-3 font-normal" /></label>
        <label className="mt-3 grid gap-1 text-sm font-medium text-slate-700">{ms ? "Kata laluan sementara" : "Temporary password"}<input required minLength={8} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="h-11 rounded-md border border-slate-300 bg-white/80 px-3 font-normal" /></label>
        <button disabled={saving} className="mt-5 h-11 w-full rounded-md bg-ink text-sm font-semibold text-white disabled:opacity-60">{saving ? (ms ? "Menyimpan..." : "Saving...") : (ms ? "Cipta akaun" : "Create account")}</button>
      </form>
      <div className="overflow-hidden rounded-lg border border-white/80 bg-white/70">
        {accounts.map((account) => <div key={account.id} className="border-b border-slate-200 p-4 last:border-0"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate font-semibold">{account.displayName || account.username}</p><p className="truncate text-sm text-slate-500">@{account.username}</p></div><div className="flex shrink-0 gap-3 text-sm font-semibold"><button type="button" onClick={() => setResetTarget(resetTarget === account.id ? null : account.id)} className="text-brand-700">{ms ? "Tetap semula" : "Reset"}</button><button type="button" onClick={() => void toggle(account)} className="text-brand-700">{account.isActive ? (ms ? "Nyahaktif" : "Deactivate") : (ms ? "Aktifkan" : "Activate")}</button></div></div>{resetTarget === account.id && <form onSubmit={(event) => void reset(event, account)} className="mt-3 flex gap-2 border-t border-slate-200 pt-3"><label className="min-w-0 flex-1 text-sm font-medium text-slate-700">{ms ? "Kata laluan sementara baharu" : "New temporary password"}<input required minLength={8} type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-normal" /></label><button disabled={saving} className="h-10 self-end rounded-md bg-ink px-4 text-sm font-semibold text-white">{ms ? "Tetapkan" : "Set"}</button></form>}</div>)}
        {accounts.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{ms ? "Tiada pentadbir global." : "No global administrators."}</p>}
      </div>
    </div>
  </section>;
}
