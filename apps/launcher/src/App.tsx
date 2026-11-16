import { useEffect, useState } from "react";
import { I18nProvider, useApplyTheme, useT } from "@theatre-suite/core";
import { Button, TitleBar, Toast } from "@theatre-suite/ui";
import { DICTS, setStaticLang } from "./i18n";
import { api, appWindow } from "./lib/api";
import { useStore } from "./state/store";
import { LauncherMark } from "./components/AppLogos";
import { Home } from "./screens/Home";
import { ProjectScreen } from "./screens/Project";
import { SuiteScreen } from "./screens/Suite";
import { Dialogs } from "./dialogs/Dialogs";

export function App() {
  const settings = useStore((s) => s.settings);
  useApplyTheme(settings?.theme ?? "system");
  useEffect(() => {
    void useStore.getState().init();
  }, []);
  useEffect(() => {
    if (settings) document.documentElement.lang = settings.language;
  }, [settings?.language]);
  if (!settings) return null;
  setStaticLang(settings.language);
  return (
    <I18nProvider dicts={DICTS} lang={settings.language}>
      <Shell />
    </I18nProvider>
  );
}

function Shell() {
  const t = useT();
  const screen = useStore((s) => s.screen);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings)!;
  const [maximized, setMaximized] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void api.appInfo().then((i) => setVersion(i.version)).catch(() => {});
  }, []);

  useEffect(() => {
    const w = appWindow();
    if (!w) return;
    const refresh = () => void w.isMaximized().then(setMaximized);
    refresh();
    const stop = w.onResized(refresh);
    return () => {
      void stop.then((f) => f());
    };
  }, []);

  const showNotice = settings.weeklyCheck && !settings.updateNoticeSeen;

  return (
    <div className="ln-shell">
      <TitleBar
        logo={<LauncherMark size={20} />}
        appName={version ? `Theatre Suite ${version}` : "Theatre Suite"}
        actions={
          <>
            <Button variant="ghost" iconOnly icon="settings" aria-label={t("Settings")} title={t("Settings")} onClick={() => useStore.getState().setDialog({ kind: "settings" })} />
          </>
        }
        windowActions={{
          minimize: () => void appWindow()?.minimize(),
          toggleMaximize: () => void appWindow()?.toggleMaximize(),
          close: () => void appWindow()?.close(),
          maximized,
        }}
        labels={{ minimize: t("Minimize"), maximize: t("Maximize"), restore: t("Restore"), close: t("Close") }}
      />
      {showNotice ? <UpdateNotice /> : null}
      <main className="ln-main">
        {screen.name === "home" ? <Home /> : null}
        {screen.name === "project" ? <ProjectScreen key={screen.path} path={screen.path} /> : null}
        {screen.name === "suite" ? <SuiteScreen /> : null}
      </main>
      <Dialogs />
      {toast ? <Toast message={toast.message} kind={toast.kind} onDone={() => useStore.getState().clearToast()} ms={toast.kind === "error" ? 7000 : 4000} /> : null}
    </div>
  );
}

/** Shown once: the weekly check only looks for news, and starts only after this is read. */
function UpdateNotice() {
  const t = useT();
  const save = useStore((s) => s.saveSettings);
  return (
    <div className="ts-banner" role="status">
      <span className="ts-dot ts-dot--sb" />
      <span style={{ flex: 1 }}>
        {t("Once a week the launcher checks whether new versions exist. It only looks: it never downloads or installs anything by itself.")}
      </span>
      <Button
        variant="sm"
        onClick={async () => {
          await save({ updateNoticeSeen: true });
          void useStore.getState().checkUpdates();
        }}
      >
        {t("OK")}
      </Button>
      <Button variant="sm" onClick={() => void save({ updateNoticeSeen: true, weeklyCheck: false })}>
        {t("Turn off")}
      </Button>
    </div>
  );
}
