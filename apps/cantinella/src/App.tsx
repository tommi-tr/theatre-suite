import { useEffect } from "react";
import { I18nProvider, useApplyTheme } from "@theatre-suite/core";
import { DICTS } from "./i18n";
import { useSettings } from "./store/settings";
import { Shell } from "./shell/Shell";

export function App() {
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  useApplyTheme(settings.theme);
  useEffect(() => {
    void useSettings.getState().load();
  }, []);
  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);
  if (!loaded) return null;
  return (
    <I18nProvider dicts={DICTS} lang={settings.language}>
      <Shell />
    </I18nProvider>
  );
}
