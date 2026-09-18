import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login, sessionPath } from "../lib/auth";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../lib/language-context";

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> { event.preventDefault(); setError(""); setLoading(true); try { const session = await login(username, password); navigate(sessionPath(session.user), { replace: true }); } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : t("unableToSignIn")); } finally { setLoading(false); } }
  return <main className="grid min-h-screen bg-brand-50 p-4 sm:p-8"><section className="m-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-card sm:p-10"><div className="mb-6 flex justify-end"><LanguageToggle /></div><div className="mb-10"><div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-xl font-black text-white">A</div><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Attendance</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{t("welcomeBack")}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{t("signInSubtitle")}</p></div><form className="space-y-5" onSubmit={submit}><label className="block text-sm font-semibold text-slate-700">{t("username")}<input required minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="mt-2 block h-13 w-full rounded-xl border border-slate-200 px-4 text-base outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-50" /></label><label className="block text-sm font-semibold text-slate-700">{t("password")}<input required value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" className="mt-2 block h-13 w-full rounded-xl border border-slate-200 px-4 text-base outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-50" /></label>{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p>}<button disabled={loading} className="flex h-13 w-full items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-500 disabled:cursor-wait disabled:opacity-70">{loading ? t("signingIn") : t("logIn")}</button></form></section></main>;
}
