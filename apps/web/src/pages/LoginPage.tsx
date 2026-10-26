import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { login, sessionPath, verifyMfaLogin } from "../lib/auth";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../lib/language-context";
import { BrandMark } from "../components/BrandMark";

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  return <main className="auth-shell app-canvas grid min-h-screen place-items-center px-4 py-8 sm:px-8">
    <section className="auth-card w-full max-w-md rounded-lg px-6 py-7 sm:px-9 sm:py-9">
      <div className="mb-8 flex items-center justify-between gap-3">
        <BrandMark inverse compact />
        <LanguageToggle inverse />
      </div>
      <div className="mb-7 border-b border-white/10 pb-6"><span className="auth-kicker">Workforce operations</span><h1 className="mt-3 text-3xl font-semibold text-white">{mfaChallenge ? t("twoFactorVerification") : t("welcomeBack")}</h1><p className="mt-2 text-sm leading-6 text-slate-300">{mfaChallenge ? t("twoFactorVerificationDescription") : t("signInSubtitle")}</p></div>
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        {!mfaChallenge && <><label className="block text-sm font-semibold text-slate-200">{t("username")}<input required type="text" inputMode="text" minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="auth-input mt-2 block h-12 w-full rounded-lg px-4 text-base outline-none transition" /></label>
        <div className="block text-sm font-semibold text-slate-200"><label htmlFor="login-password">{t("password")}</label><span className="relative mt-2 block"><input id="login-password" required value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" className="auth-input block h-12 w-full rounded-lg px-4 pr-12 text-base outline-none transition" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? t("hidePassword") : t("showPassword")} aria-pressed={showPassword} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-400 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-500">{showPassword ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}</button></span></div></>}
        {mfaChallenge && <label className="block text-sm font-semibold text-slate-200">{t("verificationCode")}<input required autoFocus inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={20} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} className="auth-input mt-2 block h-12 w-full rounded-lg px-4 text-base outline-none transition" /></label>}
        {!mfaChallenge && <div className="text-right"><Link to="/forgot-password" className="text-sm font-semibold text-brand-600 hover:text-brand-500">{t("forgotPassword")}</Link></div>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p>}
        <button disabled={loading} className="auth-primary flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white transition disabled:cursor-wait disabled:opacity-60"><span>{loading ? t("signingIn") : mfaChallenge ? t("verify") : t("logIn")}</span><ArrowRight aria-hidden="true" size={18} /></button>
      </form>
    </section>
  </main>;
}
