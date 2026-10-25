import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../lib/language-context";
import { resetPassword } from "../lib/password-recovery";
import { BrandMark } from "../components/BrandMark";

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

  return <main className="auth-shell app-canvas grid min-h-screen place-items-center px-4 py-8"><section className="auth-card w-full max-w-md rounded-lg px-6 py-7 sm:px-9"><div className="mb-7 flex items-center justify-between"><BrandMark inverse compact /><LanguageToggle inverse /></div><h1 className="text-2xl font-semibold text-white">{t("chooseNewPassword")}</h1>{complete ? <p role="status" className="mt-6 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">{t("passwordResetComplete")}</p> : <form className="mt-6 space-y-5" onSubmit={(event) => void submit(event)}><p className="text-sm text-slate-300">{t("newPasswordRequirements")}</p><label className="block text-sm font-semibold text-slate-200">{t("newPassword")}<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="auth-input mt-2 h-12 w-full rounded-lg px-4 font-normal" /></label><label className="block text-sm font-semibold text-slate-200">{t("confirmPassword")}<input required minLength={8} type="password" autoComplete="new-password" value={confirmed} onChange={(event) => setConfirmed(event.target.value)} className="auth-input mt-2 h-12 w-full rounded-lg px-4 font-normal" /></label>{error && <p role="alert" className="rounded-lg bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}<button disabled={loading || !token} className="auth-primary h-12 w-full rounded-lg text-sm font-semibold text-white disabled:opacity-60">{loading ? t("saving") : t("resetPassword")}</button></form>}<Link className="mt-6 block text-center text-sm font-semibold text-violet-300 hover:text-white" to="/login">{t("backToLogin")}</Link></section></main>;
}
