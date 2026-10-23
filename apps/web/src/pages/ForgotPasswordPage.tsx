import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../lib/language-context";
import { requestPasswordRecovery } from "../lib/password-recovery";

export function ForgotPasswordPage(): JSX.Element {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setLoading(true); setError("");
    try { await requestPasswordRecovery(email); setSent(true); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : t("unableToRequestPasswordReset")); }
    finally { setLoading(false); }
  }

  return <main className="app-canvas grid min-h-screen place-items-center px-4 py-8"><section className="glass-panel-strong w-full max-w-md rounded-lg px-6 py-7 sm:px-9"><div className="mb-7 flex items-center justify-between"><span className="text-base font-semibold">Attendance<span className="text-brand-500">.</span></span><LanguageToggle /></div><h1 className="text-2xl font-semibold">{t("resetYourPassword")}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{t("passwordRecoveryDescription")}</p>{sent ? <p role="status" className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{t("passwordRecoverySent")}</p> : <form className="mt-6 space-y-5" onSubmit={(event) => void submit(event)}><label className="block text-sm font-semibold text-slate-700">{t("contactEmail")}<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 font-normal" /></label>{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button disabled={loading} className="h-12 w-full rounded-lg bg-brand-600 text-sm font-semibold text-white disabled:opacity-60">{loading ? t("sending") : t("sendResetLink")}</button></form>}<Link className="mt-6 block text-center text-sm font-semibold text-brand-600" to="/login">{t("backToLogin")}</Link></section></main>;
}
