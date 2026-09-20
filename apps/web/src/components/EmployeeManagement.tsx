import { useEffect, useState, type FormEvent } from "react";
import { createAdminEmployee, getAdminEmployees, updateAdminEmployeeStatus, type AdminEmployee, type EmployeeInput } from "../lib/admin-employees";
import { getAdminAccounts, resetManagedAccountPassword, type AdminAccount } from "../lib/admin-accounts";
import { getSession } from "../lib/auth";
import { useLanguage } from "../lib/language-context";

const emptyForm: EmployeeInput = { username: "", password: "", firstName: "", lastName: "", ownerAdminId: "" };

export function EmployeeManagement({ adminAccountsVersion = 0, preferredOwnerAdminId = "" }: { adminAccountsVersion?: number; preferredOwnerAdminId?: string }): JSX.Element {
  const { t } = useLanguage();
  const isDevAdmin = getSession()?.user.role === "DEV_ADMIN";
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [form, setForm] = useState<EmployeeInput>({ ...emptyForm });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getAdminEmployees(), isDevAdmin ? getAdminAccounts() : Promise.resolve([])])
      .then(([employeeList, adminList]) => {
        const activeAdmins = adminList.filter((admin) => admin.isActive);
        setEmployees(employeeList);
        setAdmins(activeAdmins);
        setForm((current) => ({
          ...current,
          ownerAdminId: activeAdmins.some((admin) => admin.id === preferredOwnerAdminId)
            ? preferredOwnerAdminId
            : activeAdmins.some((admin) => admin.id === current.ownerAdminId)
            ? current.ownerAdminId
            : activeAdmins[0]?.id ?? "",
        }));
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t("unableToLoadEmployees")));
  }, [adminAccountsVersion, isDevAdmin, preferredOwnerAdminId, t]);

  function change(field: keyof EmployeeInput, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const employee = await createAdminEmployee(form);
      setEmployees((current) => [...current, employee].sort((first, second) => Number(second.isActive) - Number(first.isActive) || first.username.localeCompare(second.username)));
      setForm({ ...emptyForm, ownerAdminId: isDevAdmin ? form.ownerAdminId : "" });
      setMessage(t("employeeCreated"));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("unableToCreateEmployee"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(employee: AdminEmployee): Promise<void> {
    setError("");
    try {
      const updated = await updateAdminEmployeeStatus(employee.id, !employee.isActive);
      setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("unableToUpdateEmployee"));
    }
  }

  async function reset(event: FormEvent<HTMLFormElement>, employee: AdminEmployee): Promise<void> {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await resetManagedAccountPassword(employee.id, resetPassword);
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
      <h2 className="text-lg font-bold">{t("employees")}</h2>
      <p className="text-sm text-slate-500">{t("createEmployeeAccess")}</p>
    </div>
    {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={(event) => void submit(event)} className="rounded-2xl bg-white p-5 shadow-card">
        <h3 className="font-bold">{t("addEmployee")}</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">{t("firstName")}
            <input required maxLength={80} value={form.firstName} onChange={(event) => change("firstName", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
          </label>
          <label className="text-sm font-semibold text-slate-700">{t("lastName")}
            <input required maxLength={80} value={form.lastName} onChange={(event) => change("lastName", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
          </label>
        </div>
        <label className="mt-3 block text-sm font-semibold text-slate-700">{t("username")}
          <input required type="text" inputMode="text" minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" autoComplete="username" value={form.username} onChange={(event) => change("username", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
        </label>
        <label className="mt-3 block text-sm font-semibold text-slate-700">{t("temporaryPassword")}
          <input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={form.password} onChange={(event) => change("password", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-500">{t("newPasswordRequirements")}</p>
        {isDevAdmin && <label className="mt-3 block text-sm font-semibold text-slate-700">{t("administrator")}
          <select required value={form.ownerAdminId} onChange={(event) => change("ownerAdminId", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
            <option value="">{t("selectAdministrator")}</option>
            {admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.displayName ?? admin.username} (@{admin.username}){admin.clientName ? ` - ${admin.clientName}` : ""}</option>)}
          </select>
          {admins.length === 0 && <span className="mt-2 block text-xs font-normal text-rose-600">{t("noActiveAdministrators")}</span>}
        </label>}
        <button disabled={saving || (isDevAdmin && !form.ownerAdminId)} className="mt-5 h-11 w-full rounded-xl bg-ink text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">{saving ? t("creating") : t("createEmployee")}</button>
      </form>
      <div className="grid gap-3">
        {employees.map((employee) => <article key={employee.id} className="rounded-2xl bg-white p-5 shadow-card">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">{employee.firstName} {employee.lastName}</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${employee.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{employee.isActive ? t("active") : t("inactive")}</span>
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">@{employee.username}</p>
              {isDevAdmin && <p className="mt-1 text-xs text-slate-400">{t("administrator")}: {employee.ownerAdmin ? `${employee.ownerAdmin.displayName ?? employee.ownerAdmin.username} (@${employee.ownerAdmin.username})` : t("unassigned")}</p>}
            </div>
            <div className="flex shrink-0 flex-col gap-2 text-right text-sm font-bold sm:flex-row">
              <button type="button" onClick={() => { setResetTarget(resetTarget === employee.id ? null : employee.id); setResetPassword(""); }} className="text-brand-600">{t("resetPassword")}</button>
              <button type="button" onClick={() => void toggle(employee)} className="text-brand-600">{employee.isActive ? t("deactivate") : t("reactivate")}</button>
            </div>
          </div>
          {resetTarget === employee.id && <form onSubmit={(event) => void reset(event, employee)} className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row">
            <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">{t("newTemporaryPassword")}
              <input required minLength={8} type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
            </label>
            <button disabled={saving} className="h-11 self-end rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-60">{t("setPassword")}</button>
          </form>}
        </article>)}
        {employees.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{t("noEmployeesYet")}</div>}
      </div>
    </div>
  </section>;
}
