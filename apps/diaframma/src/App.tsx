import { useCallback, useEffect, useState } from "react";
import { I18nProvider, findShow, useApplyTheme, useT, type ShowInfo } from "@theatre-suite/core";
import { AppLogo, Button, Segmented, TitleBar, Toast, ConfirmHost, useBackToLauncher } from "@theatre-suite/ui";
import { ask } from "@tauri-apps/plugin-dialog";
import { DICTS } from "./i18n";
import { api, appWindow, isTauri, onEngineState, onEvent } from "./lib/api";
import { confirmDiscard, flushAutosave, newDocConfirm, openDocDialog, openDocPath, restoreAutosave, saveDoc, startAutosave } from "./lib/files";
import { startEngineSync } from "./lib/engineSync";
import { startRemoteSync } from "./lib/remote";
import { launchpadClaims, startLaunchpad } from "./lib/launchpad";
import { startFileMonitor } from "./lib/fileMonitor";
import { LOGO } from "./lib/logo";
import { APP_NAME } from "./lib/version";
import { useSettings } from "./state/settings";
import { useDoc } from "./state/doc";
import { useUi } from "./state/ui";
import { ShowMode } from "./show/ShowMode";
import { RehearsalMode } from "./rehearsal/RehearsalMode";
import { LaunchpadMode } from "./common/Launchpad";
import { SettingsDialog } from "./common/SettingsDialog";
import { GuideDialog } from "./common/GuideDialog";
import { PhoneDialog } from "./common/PhoneDialog";
import { VersionsDialog } from "./common/VersionsDialog";
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
  const launchpadOn = useSettings((s) => s.settings.launchpadOn);
  const [maximized, setMaximized] = useState(false);

  // The show this cue list belongs to (the launcher's index next to the file), for the title bar.
  const [show, setShow] = useState<ShowInfo | null>(null);
  useEffect(() => {
    if (!isTauri) {
      if (location.search.includes("demo")) setShow({ id: "demo", title: "Il giardino dei ciliegi", color: "#4a5fa8", dir: "C:\\Spettacoli\\Il giardino dei ciliegi" });
      return;
    }
    let alive = true;
    findShow(filePath, { exists: (p) => api.readText(p).then(() => true, () => false), read: api.readText }).then((v) => alive && setShow(v));
    return () => {
      alive = false;
    };
  }, [filePath]);
  const home = useBackToLauncher(
    show,
    { available: api.launcherAvailable, open: api.openLauncher, onError: (e) => useUi.getState().showToast(String(e), "error") },
    (name) => t("Back to Theatre Suite · {show}", { show: name }),
  );

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
      stops.push(startLaunchpad());
      stops.push(startFileMonitor());
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
      // A key that belongs to the launchpad is not an app shortcut.
      if (launchpadClaims(e)) return;
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
        show={show}
        {...home}
        version={APP_NAME}
        fileName={fileName}
        saveState={mode !== "rehearsal" ? { text: dirty ? (filePath ? t("Unsaved changes · autosaved") : t("Not saved yet · autosaved")) : t("Saved"), dirty } : undefined}
        center={
          <Segmented
            ariaLabel={t("Mode")}
            value={mode}
            onChange={(m) => useUi.getState().setMode(m)}
            options={[
              { value: "show", label: t("Show"), icon: "curtain" },
              { value: "rehearsal", label: t("Rehearsal"), icon: "headphones" },
              { value: "launchpad", label: launchpadOn ? `${t("Launchpad")} ●` : t("Launchpad"), icon: "grid" },
            ]}
          />
        }
        actions={
          <>
            {mode !== "rehearsal" ? <FileMenu /> : null}
            <Button variant="ghost" icon="book" onClick={() => ui.openDialog("guide")} title="F1">
              <span className="df-bl">{t("Guide")}</span>
            </Button>
            <Button variant="ghost" icon="settings" onClick={() => ui.openDialog("settings")} title="Ctrl ,">
              <span className="df-bl">{t("Settings")}</span>
            </Button>
            <Button variant="ghost" icon="phone" onClick={() => ui.openDialog("phone")}>
              <span className="df-bl">{t("Phone")}</span>
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
      {mode === "show" ? <ShowMode /> : mode === "rehearsal" ? <RehearsalMode /> : <LaunchpadMode />}
      {dialog === "settings" ? <SettingsDialog onClose={() => ui.closeDialog()} /> : null}
      {dialog === "guide" ? <GuideDialog onClose={() => ui.closeDialog()} /> : null}
      {dialog === "phone" ? <PhoneDialog onClose={() => ui.closeDialog()} /> : null}
      {dialog === "versions" ? <VersionsDialog onClose={() => ui.closeDialog()} /> : null}
      <ConfirmHost />
      {toast ? <Toast message={toast.message} kind={toast.kind} onDone={() => useUi.getState().clearToast()} /> : null}
    </div>
  );
}
