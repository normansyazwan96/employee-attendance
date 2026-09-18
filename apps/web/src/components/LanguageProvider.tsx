import { useEffect, useMemo, useState, type ReactNode } from "react";
import { localeFor, translations, type Language, type TranslationKey } from "../lib/i18n";
import { LanguageContext } from "../lib/language-context";

const storageKey = "attendance.language";

function storedLanguage(): Language {
  try {
    return window.localStorage.getItem(storageKey) === "ms" ? "ms" : "en";
  } catch {
    return "en";
  }
}

export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const [language, setLanguage] = useState<Language>(storedLanguage);

  useEffect(() => {
    window.localStorage.setItem(storageKey, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({
    language,
    locale: localeFor(language),
    setLanguage,
    t: (key: TranslationKey) => translations[language][key],
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
