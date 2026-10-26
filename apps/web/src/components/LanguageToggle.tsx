import { languageOptions } from "../lib/i18n";
import { useLanguage } from "../lib/language-context";

export function LanguageToggle({ inverse = false }: { inverse?: boolean }): JSX.Element {
  const { language, setLanguage, t } = useLanguage();
  return <div role="group" aria-label={t("language")} className={`language-toggle inline-flex rounded-lg border p-1 text-xs font-bold ${inverse ? "language-toggle-inverse" : ""}`}>
    {languageOptions.map((option) => <button key={option.value} type="button" aria-pressed={language === option.value} aria-label={option.name} title={option.name} onClick={() => setLanguage(option.value)} className={`h-8 min-w-10 rounded-md px-2 transition ${language === option.value ? "bg-brand-600 text-white" : inverse ? "text-slate-300 hover:bg-white/10 hover:text-white" : "text-slate-500 hover:bg-slate-100"}`}>{option.label}</button>)}
  </div>;
}
