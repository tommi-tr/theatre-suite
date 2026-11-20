import { useCallback, useEffect, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { AppLogo, Button, ConfirmHost, KeyCommand, KeyCommandBar, Segmented, StatusBar, TitleBar, useBackToLauncher } from "@theatre-suite/ui";
import { api, appWindow, isDemo, isTauri, onEvent } from "../lib/api";
import { cancelAutosave, confirmDiscard, newDocDialog, openDemo, openDocDialog, openDocPath, restoreAutosave, saveDoc, startAutosave } from "../lib/files";
import { APP_NAME, LOGO } from "../lib/version";
import { useDoc } from "../store/doc";
import { MODES, useUi, type Mode } from "../store/ui";
import { FileMenu } from "../common/FileMenu";
import { SettingsDialog } from "../common/SettingsDialog";
import { VersionsDialog } from "../common/VersionsDialog";
import { NewShowDialog } from "../common/NewShowDialog";
import { AppToast } from "../common/AppToast";
import { StartScreen } from "./StartScreen";
import { PrepareMode } from "../modes/PrepareMode";
import { startProjectionSync } from "../lib/projection";
import { ProjectionsMode } from "../modes/ProjectionsMode";
import { ControlsMode } from "../modes/ControlsMode";
import { ShowMode } from "../modes/ShowMode";
import { ReplaceScriptDialog } from "../script/ReplaceScriptDialog";
import { addNoteHere } from "../script/ScriptStage";
import { startScriptSync, useScriptDoc } from "../script/store";
import { applySavedOutputs } from "../settings/outputStatus";
import { startAudioSync, startLibrarySync } from "../store/library";
import { startOutputs } from "../store/outputs";
import { startRunSync } from "../show/run";
import { startFollow } from "../script/follow";
import { LockButton, LockVeil, ShowStatusLine } from "../show/ShowParts";
import { lockBlocks } from "../show/useShowKeys";

export function Shell() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const filePath = useDoc((s) => s.filePath);
  const dirty = useDoc((s) => s.dirty);
  const band = useDoc((s) => s.band);
  const mode = useUi((s) => s.mode);
  const dialog = useUi((s) => s.dialog);
  const banner = useUi((s) => s.banner);
  const instance = useUi((s) => s.instance);
  const [maximized, setMaximized] = useState(false);

  // The PDF of the script follows the open show.
  useEffect(() => startScriptSync(), []);
  // The memories and tracks of the linked files follow the show; the sound output chosen last time is asked again.
  useEffect(() => {
    void applySavedOutputs();
    const stops = [startLibrarySync(), startAudioSync(), startOutputs(), startRunSync(), startFollow(), startProjectionSync()];
    return () => stops.forEach((f) => f());
  }, []);

  // Startup: file passed on the command line, crash recovery offered ("Recupera"); the demo show with /?demo.
  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    (async () => {
      if (isTauri) {
        try {
          const s = await api.sessionStart();
          if (disposed) return;
          useUi.getState().setInstance(s.instance);
          if (s.openFile) await openDocPath(t, s.openFile);
          // After a crash the last state is offered, never applied by itself; after a normal exit there is nothing to recover.
          if (s.crashed && s.autosave) useUi.getState().setBanner("crashRestoreAvailable", s.autosave);
          else if (s.autosave) await api.autosaveClear().catch(() => {});
        } catch (e) {
          useUi.getState().showToast(String(e), "error");
        }
        stops.push(
          await onEvent<string>("open-file", async (path) => {
            if (await confirmDiscard(t)) await openDocPath(t, path);
          }),
        );
        stops.push(startAutosave());
      } else if (isDemo && !new URLSearchParams(location.search).has("start")) {
        await openDemo();
      }
    })();
    return () => {
      disposed = true;
      stops.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window state and safe close: unsaved changes are asked about, then the autosave is no longer needed.
  useEffect(() => {
    const stops: Array<Promise<() => void>> = [];
    const refresh = () => appWindow.isMaximized().then(setMaximized);
    refresh();
    stops.push(appWindow.onResized(refresh));
    stops.push(
      appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (!(await confirmDiscard(t))) return;
        // No pending autosave may land after the clear: it is cancelled, not flushed.
        await cancelAutosave();
        await api.autosaveClear().catch(() => {});
        await appWindow.destroy();
      }),
    );
    return () => {
      stops.forEach((p) => p.then((f) => f()));
    };
  }, [t]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (ui.dialog) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const typing = !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
      const hasDoc = !!useDoc.getState().show;
      // Lock (Show): no other file, settings, undo or mode; saving still works.
      if (lockBlocks(e)) {
        e.preventDefault();
        return;
      }
      if (mod && !e.shiftKey && k === "s") {
        e.preventDefault();
        // A key held down repeats: one save is enough.
        if (hasDoc && !e.repeat) void saveDoc(t);
      } else if (mod && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        if (hasDoc && !e.repeat) void saveDoc(t, true);
      } else if (mod && !e.shiftKey && k === "o") {
        e.preventDefault();
        void openDocDialog(t);
      } else if (mod && !e.shiftKey && k === "n") {
        e.preventDefault();
        void newDocDialog(t);
      } else if (mod && k === ",") {
        e.preventDefault();
        ui.openSettings();
      } else if (mod && !e.shiftKey && k === "z" && !typing) {
        e.preventDefault();
        useDoc.getState().undo();
      } else if (mod && ((k === "y" && !typing) || (e.shiftKey && e.code === "KeyZ" && !typing))) {
        e.preventDefault();
        useDoc.getState().redo();
      } else if (mod && !e.shiftKey && /^Digit[1-4]$/.test(e.code) && hasDoc) {
        e.preventDefault();
        ui.setMode(MODES[Number(e.code.slice(5)) - 1]);
      }
    },
    [t],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const home = useBackToLauncher(
    band,
    { available: api.launcherAvailable, open: api.openLauncher, onError: (e) => useUi.getState().showToast(String(e), "error") },
    (name) => t("Back to Theatre Suite · {show}", { show: name }),
  );
  const docLabel = show?.title.trim() || t("Untitled show");
  const fileLabel = !show ? undefined : filePath ? basename(filePath).replace(/\.tcue$/i, "") : `${docLabel} · ${t("not saved yet")}`;
  // The file name already says "not saved yet": the state on its right only says what is kept.
  const saveState = !show
    ? undefined
    : dirty
      ? { text: isTauri ? t("Unsaved changes · copy kept") : t("Unsaved changes"), dirty }
      : filePath
        ? { text: t("Saved"), dirty }
        : undefined;
  const modeLabel = (m: Mode) => (m === "prepare" ? t("Prepare") : m === "projections" ? t("Projections") : m === "controls" ? t("Controls") : t("Show (mode)"));
  return (
    <div className="ts-app cue-app" data-mode={show ? mode : undefined}>
      <TitleBar
        logo={<AppLogo accentPath="" accentDots={LOGO.dots} inkPath={LOGO.ink} label="Cue" size={20} strokeWidth={LOGO.stroke(20)} />}
        appName=""
        show={band}
        {...home}
        fileName={fileLabel}
        saveState={saveState}
        version={instance > 1 ? `${APP_NAME} · ${t("Instance {n}", { n: instance })}` : APP_NAME}
        center={
          show ? (
            <Segmented<Mode>
              ariaLabel={t("Mode")}
              value={mode}
              onChange={(m) => useUi.getState().setMode(m)}
              options={[
                { value: "prepare", label: modeLabel("prepare"), icon: "pencil" },
                { value: "projections", label: modeLabel("projections"), icon: "image" },
                { value: "controls", label: modeLabel("controls"), icon: "trafficLight" },
                { value: "show", label: modeLabel("show"), icon: "curtain" },
              ]}
            />
          ) : null
        }
        actions={
          <>
            {show && mode === "show" ? <LockButton /> : null}
            <FileMenu />
            <Button variant="ghost" iconOnly icon="settings" title={`${t("Settings")} · Ctrl ,`} aria-label={t("Settings")} onClick={() => useUi.getState().openSettings()} />
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
            ? t("Cue was closed unexpectedly. Your work has been recovered: nothing was sent to lights, sound or screens.")
            : t("Cue was closed unexpectedly. The show as it was a moment before can be recovered.")}
          <span className="ts-spacer" />
          {banner.kind === "crashRestoreAvailable" && banner.data ? (
            <Button
              variant="sm"
              icon="reset"
              onClick={async () => {
                if (!(await confirmDiscard(t))) return;
                const ok = await restoreAutosave(banner.data!, t);
                useUi.getState().setBanner(ok ? "crashRestored" : null);
              }}
            >
              {t("Recover")}
            </Button>
          ) : null}
          <Button variant="sm" icon="x" onClick={() => useUi.getState().setBanner(null)}>
            {t("Dismiss")}
          </Button>
        </div>
      ) : null}
      <main className="cue-body">
        {!show ? <StartScreen /> : mode === "prepare" ? <PrepareMode /> : mode === "projections" ? <ProjectionsMode /> : mode === "controls" ? <ControlsMode /> : <ShowMode />}
      </main>
      <StatusBar>
        <StatusLine />
      </StatusBar>
      {dialog === "settings" ? <SettingsDialog /> : null}
      {dialog === "versions" ? <VersionsDialog /> : null}
      {dialog === "newShow" ? <NewShowDialog /> : null}
      <ReplaceScriptDialog />
      <LockVeil />
      <ConfirmHost />
      <AppToast />
    </div>
  );
}

/** Bottom line: the script and the GOs of the show; on the right the commands of the mode, and that Windows stays awake. */
function StatusLine() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const mode = useUi((s) => s.mode);
  const ready = useScriptDoc((s) => s.status === "ready");
  if (show && mode === "show") return <ShowStatusLine />;
  return (
    <>
      {show ? (
        <>
          <span>{show.script?.kind === "pdf" ? t("Script: {name} · {n} pages", { name: show.script.fileName || "script.pdf", n: show.script.pageCount }) : t("No script yet")}</span>
          <span className="ts-muted">{show.notes.length === 1 ? t("1 note") : t("{n} notes", { n: show.notes.length })}</span>
          <span className="ts-muted">{show.gos.length === 1 ? t("1 GO") : t("{n} GO", { n: show.gos.length })}</span>
        </>
      ) : (
        <span className="ts-muted">{t("No show open")}</span>
      )}
      <span className="ts-spacer" />
      {show && mode === "prepare" && ready ? (
        <KeyCommandBar>
          <KeyCommand keys="K" title={t("A note where the pointer is (or at the reading line)")} onClick={() => void addNoteHere()}>
            {t("Note")}
          </KeyCommand>
        </KeyCommandBar>
      ) : null}
      {isTauri || isDemo ? (
        <span className="ts-muted cue-awake" title={t("While Cue is open, Windows does not go to sleep and the screen stays on.")}>
          <span className="ts-dot ts-dot--go" />
          {t("Screen always on")}
        </span>
      ) : null}
    </>
  );
}
