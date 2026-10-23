import { useState, type FormEvent } from "react";
import { beginMfaSetup, enableMfa } from "../lib/mfa";
import { useLanguage } from "../lib/language-context";

export function MfaSetup({ enabled }: { enabled: boolean }): JSX.Element {
  const { t } = useLanguage();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function begin(): Promise<void> {
    setLoading(true); setError("");
    try { setSetup(await beginMfaSetup()); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : t("unableToConfigureTwoFactor")); }
    finally { setLoading(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setLoading(true); setError("");
    try { setRecoveryCodes(await enableMfa(code)); setSetup(null); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : t("unableToConfigureTwoFactor")); }
    finally { setLoading(false); }
  }

  return <section className="mt-6 rounded-lg border border-white/80 bg-white/75 p-5 shadow-card"><div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold">{t("twoFactorAuthentication")}</h2><p className="mt-1 text-sm text-slate-600">{enabled || recoveryCodes.length ? t("twoFactorEnabled") : t("twoFactorDescription")}</p></div>{!enabled && recoveryCodes.length === 0 && !setup && <button type="button" disabled={loading} onClick={() => void begin()} className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{t("setUp")}</button>}</div>{setup && <form onSubmit={(event) => void verify(event)} className="mt-5 space-y-4 border-t border-slate-200 pt-4"><p className="text-sm text-slate-600">{t("authenticatorSecret")}</p><code className="block break-all rounded-md bg-slate-100 p-3 text-sm">{setup.secret}</code><a href={setup.uri} className="inline-block text-sm font-semibold text-brand-600">{t("openAuthenticator")}</a><label className="block text-sm font-semibold text-slate-700">{t("verificationCode")}<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 font-normal" /></label><button disabled={loading} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{t("verifyAndEnable")}</button></form>}{recoveryCodes.length > 0 && <div className="mt-5 border-t border-slate-200 pt-4"><p className="text-sm font-semibold">{t("saveRecoveryCodes")}</p><div className="mt-3 grid grid-cols-2 gap-2">{recoveryCodes.map((recoveryCode) => <code key={recoveryCode} className="rounded-md bg-slate-100 p-2 text-center text-xs">{recoveryCode}</code>)}</div></div>}{error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}</section>;
}
