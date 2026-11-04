import { useEffect, useState } from "react";

export type ThemePref = "dark" | "light" | "system";

/** Applies data-theme on <html> from the user preference, following the OS when "system". */
export function useApplyTheme(pref: ThemePref): "dark" | "light" {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const effective = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);
  return effective;
}
