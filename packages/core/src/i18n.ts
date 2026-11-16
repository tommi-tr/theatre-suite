import { createContext, createElement, useContext, type ReactNode } from "react";

/**
 * Minimal, dependency-free i18n shared by the suite.
 * Each app defines one dictionary per language with the same keys.
 * Placeholders use {name} syntax.
 */
export type Lang = "en" | "it";
export const LANGS: { value: Lang; label: string }[] = [
  { value: "it", label: "Italiano" },
  { value: "en", label: "English" },
];

export type Dict = Record<string, string>;
export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export function makeT(dicts: Record<Lang, Dict>, lang: Lang): TFunc {
  const d = dicts[lang] ?? dicts.en;
  return (key, vars) => {
    let s = d[key] ?? dicts.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    }
    return s;
  };
}

const I18nContext = createContext<{ t: TFunc; lang: Lang }>({ t: (k) => k, lang: "en" });

export function I18nProvider({ dicts, lang, children }: { dicts: Record<Lang, Dict>; lang: Lang; children: ReactNode }) {
  return createElement(I18nContext.Provider, { value: { t: makeT(dicts, lang), lang } }, children);
}

export function useT(): TFunc {
  return useContext(I18nContext).t;
}

export function useLang(): Lang {
  return useContext(I18nContext).lang;
}
