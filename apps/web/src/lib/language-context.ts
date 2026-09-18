import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { Language, TranslationKey } from "./i18n";

export type LanguageContextValue = {
  language: Language;
  locale: string;
  setLanguage: Dispatch<SetStateAction<Language>>;
  t: (key: TranslationKey) => string;
};

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
