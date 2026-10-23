import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../lib/language-context";
import { resetPassword } from "../lib/password-recovery";

export function ResetPasswordPage(): JSX.Element {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const token = searchParams.get("token") ?? "";

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setError("");
    if (password !== confirmed) { setError(t("passwordsDoNotMatch")); return; }
    setLoading(true);
    try { await resetPassword(token, password); setComplete(true); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : t("unableToResetPassword")); }
    finally { setLoading(false); }
  }

  return <main className="app-canvas grid min-h-screen place-items-center px-4 py-8"><section className="glass-panel-strong w-full max-w-md rounded-lg px-6 py-7 sm:px-9"><div className="mb-7 flex items-center justify-between"><span className="text-base font-semibold">Attendance<span className="text-brand-500">.</span></span><LanguageToggle /></div><h1 className="text-2xl font-semibold">{t("chooseNewPassword")}</h1>{complete ? <p role="status" className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{t("passwordResetComplete")}</p> : <form className="mt-6 space-y-5" onSubmit={(event) => void submit(event)}><p className="text-sm text-slate-600">{t("newPasswordRequirements")}</p><label className="block text-sm font-semibold text-slate-700">{t("newPassword")}<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 font-normal" /></label><label className="block text-sm font-semibold text-slate-700">{t("confirmPassword")}<input required minLength={8} type="password" autoComplete="new-password" value={confirmed} onChange={(event) => setConfirmed(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 font-normal" /></label>{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button disabled={loading || !token} className="h-12 w-full rounded-lg bg-brand-600 text-sm font-semibold text-white disabled:opacity-60">{loading ? t("saving") : t("resetPassword")}</button></form>}<Link className="mt-6 block text-center text-sm font-semibold text-brand-600" to="/login">{t("backToLogin")}</Link></section></main>;
}
