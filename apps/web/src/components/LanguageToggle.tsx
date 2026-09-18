import { languageOptions } from "../lib/i18n";
import { useLanguage } from "../lib/language-context";

export function LanguageToggle(): JSX.Element {
  const { language, setLanguage, t } = useLanguage();
  return <div role="group" aria-label={t("language")} className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold shadow-sm">
    {languageOptions.map((option) => <button key={option.value} type="button" aria-pressed={language === option.value} aria-label={option.name} title={option.name} onClick={() => setLanguage(option.value)} className={`h-8 min-w-10 rounded-lg px-2 transition ${language === option.value ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{option.label}</button>)}
  </div>;
}
