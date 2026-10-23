import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login, sessionPath, verifyMfaLogin } from "../lib/auth";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../lib/language-context";

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = mfaChallenge ? await verifyMfaLogin(mfaChallenge, mfaCode) : await login(username, password);
      if ("mfaRequired" in session) {
        setMfaChallenge(session.challengeToken);
        setLoading(false);
        return;
      }
      navigate(sessionPath(session.user), { replace: true });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("unableToSignIn"));
    } finally {
      setLoading(false);
    }
  }

  return <main className="app-canvas grid min-h-screen place-items-center px-4 py-8 sm:px-8">
    <section className="glass-panel-strong w-full max-w-md rounded-lg px-6 py-7 sm:px-9 sm:py-9">
      <div className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-600 text-lg font-semibold text-white">A</div><span className="text-base font-semibold">Attendance<span className="text-brand-500">.</span></span></div>
        <LanguageToggle />
      </div>
      <div className="mb-7 border-b border-slate-200/70 pb-6"><h1 className="text-2xl font-semibold">{mfaChallenge ? t("twoFactorVerification") : t("welcomeBack")}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{mfaChallenge ? t("twoFactorVerificationDescription") : t("signInSubtitle")}</p></div>
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        {!mfaChallenge && <><label className="block text-sm font-semibold text-slate-700">{t("username")}<input required type="text" inputMode="text" minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="mt-2 block h-12 w-full rounded-lg border border-slate-200 px-4 text-base outline-none transition focus:border-brand-500" /></label>
        <label className="block text-sm font-semibold text-slate-700">{t("password")}<input required value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" className="mt-2 block h-12 w-full rounded-lg border border-slate-200 px-4 text-base outline-none transition focus:border-brand-500" /></label></>}
        {mfaChallenge && <label className="block text-sm font-semibold text-slate-700">{t("verificationCode")}<input required autoFocus inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={20} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} className="mt-2 block h-12 w-full rounded-lg border border-slate-200 px-4 text-base outline-none transition focus:border-brand-500" /></label>}
        {!mfaChallenge && <div className="text-right"><Link to="/forgot-password" className="text-sm font-semibold text-brand-600 hover:text-brand-500">{t("forgotPassword")}</Link></div>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p>}
        <button disabled={loading} className="flex h-12 w-full items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-wait disabled:opacity-60">{loading ? t("signingIn") : mfaChallenge ? t("verify") : t("logIn")}</button>
      </form>
    </section>
  </main>;
}
