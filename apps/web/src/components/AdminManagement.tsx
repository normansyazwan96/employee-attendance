import { useEffect, useState, type FormEvent } from "react";
import {
  createAdminAccount,
  getAdminAccounts,
  resetManagedAccountPassword,
  updateAdminAccountStatus,
  type AdminAccount,
  type AdminAccountInput,
} from "../lib/admin-accounts";
import { useLanguage } from "../lib/language-context";

const emptyForm: AdminAccountInput = { username: "", displayName: "", password: "" };

export function AdminManagement(): JSX.Element {
  const { t } = useLanguage();
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [form, setForm] = useState<AdminAccountInput>({ ...emptyForm });
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminAccounts()
      .then(setAdmins)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t("unableToLoadAdmins")));
  }, [t]);

  function change(field: keyof AdminAccountInput, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const admin = await createAdminAccount(form);
      setAdmins((current) => [...current, admin].sort((first, second) => first.username.localeCompare(second.username)));
      setForm({ ...emptyForm });
      setMessage(t("adminCreated"));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("unableToCreateAdmin"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(admin: AdminAccount): Promise<void> {
    setError("");
    setMessage("");
    try {
      const updated = await updateAdminAccountStatus(admin.id, !admin.isActive);
      setAdmins((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("unableToUpdateAdmin"));
    }
  }

  async function reset(event: FormEvent<HTMLFormElement>, admin: AdminAccount): Promise<void> {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await resetManagedAccountPassword(admin.id, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      setMessage(t("temporaryPasswordSet"));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("unableToResetPassword"));
    } finally {
      setSaving(false);
    }
  }

  return <section className="mt-10">
    <div className="mb-4">
      <h2 className="text-lg font-bold">{t("administrators")}</h2>
      <p className="text-sm text-slate-500">{t("adminManagementDescription")}</p>
    </div>
    {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={(event) => void create(event)} className="rounded-2xl bg-white p-5 shadow-card">
        <h3 className="font-bold">{t("addAdministrator")}</h3>
        <label className="mt-4 block text-sm font-semibold text-slate-700">{t("displayName")}
          <input required maxLength={120} value={form.displayName} onChange={(event) => change("displayName", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
        </label>
        <label className="mt-3 block text-sm font-semibold text-slate-700">{t("username")}
          <input required minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" autoComplete="username" value={form.username} onChange={(event) => change("username", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
        </label>
        <label className="mt-3 block text-sm font-semibold text-slate-700">{t("temporaryPassword")}
          <input required minLength={12} type="password" autoComplete="new-password" value={form.password} onChange={(event) => change("password", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-500">{t("newPasswordRequirements")}</p>
        <button disabled={saving} className="mt-5 h-11 w-full rounded-xl bg-ink text-sm font-bold text-white disabled:opacity-60">{saving ? t("creating") : t("createAdministrator")}</button>
      </form>
      <div className="grid gap-3">
        {admins.map((admin) => <article key={admin.id} className="rounded-2xl bg-white p-5 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">{admin.displayName}</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${admin.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{admin.isActive ? t("active") : t("inactive")}</span>
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">@{admin.username}</p>
              <p className="mt-1 text-xs text-slate-400">{admin.clientName}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 text-right text-sm font-bold sm:flex-row">
              <button type="button" onClick={() => { setResetTarget(resetTarget === admin.id ? null : admin.id); setResetPassword(""); }} className="text-brand-600">{t("resetPassword")}</button>
              <button type="button" onClick={() => void toggle(admin)} className="text-brand-600">{admin.isActive ? t("deactivate") : t("reactivate")}</button>
            </div>
          </div>
          {resetTarget === admin.id && <form onSubmit={(event) => void reset(event, admin)} className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row">
            <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">{t("newTemporaryPassword")}
              <input required minLength={12} type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
            </label>
            <button disabled={saving} className="h-11 self-end rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-60">{t("setPassword")}</button>
          </form>}
        </article>)}
        {admins.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{t("noAdministratorsYet")}</div>}
      </div>
    </div>
  </section>;
}
