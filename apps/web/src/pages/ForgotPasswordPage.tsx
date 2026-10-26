import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../lib/language-context";
import { requestPasswordRecovery } from "../lib/password-recovery";
import { BrandMark } from "../components/BrandMark";

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

  return <main className="auth-shell app-canvas grid min-h-screen place-items-center px-4 py-8"><section className="auth-card w-full max-w-md rounded-lg px-6 py-7 sm:px-9"><div className="mb-7 flex items-center justify-between"><BrandMark inverse compact /><LanguageToggle inverse /></div><h1 className="text-2xl font-semibold text-white">{t("resetYourPassword")}</h1><p className="mt-2 text-sm leading-6 text-slate-300">{t("passwordRecoveryDescription")}</p>{sent ? <p role="status" className="mt-6 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">{t("passwordRecoverySent")}</p> : <form className="mt-6 space-y-5" onSubmit={(event) => void submit(event)}><label className="block text-sm font-semibold text-slate-200">{t("contactEmail")}<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="auth-input mt-2 h-12 w-full rounded-lg px-4 font-normal" /></label>{error && <p role="alert" className="rounded-lg bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}<button disabled={loading} className="auth-primary h-12 w-full rounded-lg text-sm font-semibold text-white disabled:opacity-60">{loading ? t("sending") : t("sendResetLink")}</button></form>}<Link className="mt-6 block text-center text-sm font-semibold text-violet-300 hover:text-white" to="/login">{t("backToLogin")}</Link></section></main>;
}
