import { useCallback, useEffect, useState } from "react";
import { I18nProvider, useApplyTheme, useT } from "@theatre-suite/core";
import { AppLogo, Button, Segmented, TitleBar, Toast } from "@theatre-suite/ui";
import { ask } from "@tauri-apps/plugin-dialog";
import { DICTS } from "./i18n";
import { api, appWindow, isTauri, onEngineState, onEvent } from "./lib/api";
import { confirmDiscard, flushAutosave, newDocConfirm, openDocDialog, openDocPath, restoreAutosave, saveDoc, startAutosave } from "./lib/files";
import { startEngineSync } from "./lib/engineSync";
import { startRemoteSync } from "./lib/remote";
import { LOGO } from "./lib/logo";
import { useSettings } from "./state/settings";
import { useDoc } from "./state/doc";
import { useUi } from "./state/ui";
import { ShowMode } from "./show/ShowMode";
import { RehearsalMode } from "./rehearsal/RehearsalMode";
import { SettingsDialog } from "./common/SettingsDialog";
import { GuideDialog } from "./common/GuideDialog";
import { PhoneDialog } from "./common/PhoneDialog";
import { FileMenu } from "./common/FileMenu";

export function App() {
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  useApplyTheme(settings.theme);
  useEffect(() => {
    useSettings.getState().load();
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

function Shell() {
  const t = useT();
  const mode = useUi((s) => s.mode);
  const dialog = useUi((s) => s.dialog);
  const toast = useUi((s) => s.toast);
  const banner = useUi((s) => s.banner);
  const filePath = useDoc((s) => s.filePath);
  const dirty = useDoc((s) => s.dirty);
  const phoneOn = useSettings((s) => s.settings.phoneEnabled);
  const [maximized, setMaximized] = useState(false);

  // Startup: crash recovery, file passed on the command line, autosave, engine.
  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    (async () => {
      if (!isTauri) {
        if (location.search.includes("demo")) (await import("./lib/demo")).loadDemo();
        return;
      }
      try {
        const s = await api.sessionStart();
        if (disposed) return;
        if (s.openFile) {
          await openDocPath(t, s.openFile);
          if (s.crashed && s.autosave) useUi.getState().setBanner("crashRestoreAvailable", s.autosave);
        } else if (s.autosave) {
          const ok = await restoreAutosave(s.autosave);
          if (ok && s.crashed) useUi.getState().setBanner("crashRestored");
        }
      } catch (e) {
        useUi.getState().showToast(String(e), "error");
      }
      if (!useSettings.getState().settings.guideSeen) {
        useSettings.getState().update({ guideSeen: true });
        useUi.getState().openDialog("guide");
      }
      stops.push(startAutosave());
      stops.push(startEngineSync());
      stops.push(startRemoteSync());
      const un1 = await onEngineState((live) => useDoc.getState().setLive(live));
      const un2 = await onEvent<string>("open-file", async (path) => {
        if (await confirmDiscard(t)) await openDocPath(t, path);
      });
      stops.push(un1, un2);
      api.engineState().then((l) => useDoc.getState().setLive(l)).catch(() => {});
    })();
    return () => {
      disposed = true;
      stops.forEach((f) => f());
    };
  }, []);

  // Window state + safe close.
  useEffect(() => {
    const stops: Array<Promise<() => void>> = [];
    const refresh = () => appWindow.isMaximized().then(setMaximized);
    refresh();
    stops.push(appWindow.onResized(refresh));
    stops.push(
      appWindow.onCloseRequested(async (prevent) => {
        prevent();
        const live = useDoc.getState().live;
        if (live.voices.some((v) => !v.paused)) {
          const ok = await ask(t("Sound is playing. Close Diaframma anyway?"), { title: "Diaframma", kind: "warning", okLabel: t("Close"), cancelLabel: t("Cancel") });
          if (!ok) return;
        }
        if (!(await confirmDiscard(t))) return;
        flushAutosave();
        await appWindow.destroy();
      }),
    );
    return () => {
      stops.forEach((p) => p.then((f) => f()));
    };
  }, [t]);

  // Global shortcuts that are not specific to a mode.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (useUi.getState().dialog) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "s") {
        e.preventDefault();
        if (!useDoc.getState().locked) saveDoc(t, e.shiftKey);
      } else if (e.ctrlKey && k === "o") {
        e.preventDefault();
        if (!useDoc.getState().locked) openDocDialog(t);
      } else if (e.ctrlKey && k === "n") {
        e.preventDefault();
        if (!useDoc.getState().locked) newDocConfirm(t);
      } else if (e.ctrlKey && k === ",") {
        e.preventDefault();
        useUi.getState().openDialog("settings");
      } else if (e.key === "F1") {
        e.preventDefault();
        useUi.getState().openDialog("guide");
      }
    },
    [t],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : t("Untitled cue list");
  const ui = useUi.getState();

  return (
    <div className="ts-app">
      <TitleBar
        logo={<AppLogo accentPath={LOGO.a} inkPath={LOGO.b} label="Diaframma" />}
        appName="Diaframma"
        fileName={mode === "show" ? fileName : undefined}
        saveState={mode === "show" ? { text: dirty ? (filePath ? t("Unsaved changes · autosaved") : t("Not saved yet · autosaved")) : t("Saved"), dirty } : undefined}
        center={
          <Segmented
            ariaLabel={t("Mode")}
            value={mode}
            onChange={(m) => useUi.getState().setMode(m)}
            options={[
              { value: "show", label: t("Show"), icon: "curtain" },
              { value: "rehearsal", label: t("Rehearsal"), icon: "headphones" },
            ]}
          />
        }
        actions={
          <>
            {mode === "show" ? <FileMenu /> : null}
            <Button variant="ghost" icon="book" onClick={() => ui.openDialog("guide")} title="F1">
              {t("Guide")}
            </Button>
            <Button variant="ghost" icon="settings" onClick={() => ui.openDialog("settings")} title="Ctrl ,">
              {t("Settings")}
            </Button>
            <Button variant="ghost" icon="phone" onClick={() => ui.openDialog("phone")}>
              {t("Phone")}
              <span className={phoneOn ? "ts-dot ts-dot--go" : "ts-dot"} />
            </Button>
          </>
        }
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          close: () => appWindow.close(),
          maximized,
        }}
        labels={{ minimize: t("Minimize"), maximize: t("Maximize"), restore: t("Restore"), close: t("Close") }}
      />
      {banner ? (
        <div className="ts-banner" role="status">
          <span className="ts-dot ts-dot--sb" />
          {banner.kind === "crashRestored"
            ? t("Diaframma was closed unexpectedly. Your last session has been restored.")
            : t("Diaframma was closed unexpectedly. Unsaved work from the last session is available.")}
          <span className="ts-spacer" />
          {banner.kind === "crashRestoreAvailable" && banner.data ? (
            <Button
              variant="sm"
              icon="reset"
              onClick={async () => {
                if (await confirmDiscard(t)) await restoreAutosave(banner.data!);
                useUi.getState().setBanner(null);
              }}
            >
              {t("Restore it")}
            </Button>
          ) : null}
          <Button variant="sm" icon="x" onClick={() => useUi.getState().setBanner(null)}>
            {t("Dismiss")}
          </Button>
        </div>
      ) : null}
      {mode === "show" ? <ShowMode /> : <RehearsalMode />}
      {dialog === "settings" ? <SettingsDialog onClose={() => ui.closeDialog()} /> : null}
      {dialog === "guide" ? <GuideDialog onClose={() => ui.closeDialog()} /> : null}
      {dialog === "phone" ? <PhoneDialog onClose={() => ui.closeDialog()} /> : null}
      {toast ? <Toast message={toast.message} kind={toast.kind} onDone={() => useUi.getState().clearToast()} /> : null}
    </div>
  );
}
