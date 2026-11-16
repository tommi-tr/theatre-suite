import { useCallback, useEffect, useMemo, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { AppLogo, Button, ConfirmHost, Segmented, StatusBar, TitleBar, useBackToLauncher } from "@theatre-suite/ui";
import { api, appWindow, isTauri, onEvent } from "../lib/api";
import { confirmDiscard, flushAutosave, newDocDialog, openDocDialog, openDocPath, restoreAutosave, saveDoc, startAutosave } from "../lib/files";
import { APP_NAME, LOGO } from "../lib/version";
import { addressProblems, channelsInUse } from "../model/addresses";
import { useDoc } from "../store/doc";
import { useUi, type Mode } from "../store/ui";
import { FileMenu } from "../common/FileMenu";
import { SettingsDialog } from "../common/SettingsDialog";
import { VersionsDialog } from "../common/VersionsDialog";
import { NewShowDialog } from "../common/NewShowDialog";
import { AppToast } from "../common/AppToast";
import { StartScreen } from "./StartScreen";
import { SetupMode } from "../modes/SetupMode";
import { DeskMode } from "../modes/DeskMode";
import { ShowMode } from "../modes/ShowMode";

const MODES: Mode[] = ["setup", "desk", "show"];

export function Shell() {
  const t = useT();
  const doc = useDoc((s) => s.doc);
  const filePath = useDoc((s) => s.filePath);
  const dirty = useDoc((s) => s.dirty);
  const show = useDoc((s) => s.show);
  const mode = useUi((s) => s.mode);
  const dialog = useUi((s) => s.dialog);
  const banner = useUi((s) => s.banner);
  const [maximized, setMaximized] = useState(false);

  // Startup: crash recovery, file passed on the command line, autosave; the demo show with /?demo.
  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    (async () => {
      if (isTauri) {
        try {
          const s = await api.sessionStart();
          if (disposed) return;
          if (s.openFile) {
            await openDocPath(t, s.openFile);
            if (s.crashed && s.autosave) useUi.getState().setBanner("crashRestoreAvailable", s.autosave);
          } else if (s.autosave) {
            const ok = restoreAutosave(s.autosave);
            if (ok && s.crashed) useUi.getState().setBanner("crashRestored");
          }
        } catch (e) {
          useUi.getState().showToast(String(e), "error");
        }
        stops.push(
          await onEvent<string>("open-file", async (path) => {
            if (await confirmDiscard(t)) await openDocPath(t, path);
          }),
        );
        stops.push(startAutosave());
      } else if (location.search.includes("demo")) {
        const { demoDoc, DEMO_SHOW } = await import("../model/demo");
        if (disposed) return;
        useDoc.getState().load(demoDoc(), { filePath: null, dirty: false });
        useDoc.getState().setShow(DEMO_SHOW);
        if (location.search.includes("start")) useDoc.getState().close();
      }
    })();
    return () => {
      disposed = true;
      stops.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window state and safe close.
  useEffect(() => {
    const stops: Array<Promise<() => void>> = [];
    const refresh = () => appWindow.isMaximized().then(setMaximized);
    refresh();
    stops.push(appWindow.onResized(refresh));
    stops.push(
      appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (!(await confirmDiscard(t))) return;
        flushAutosave();
        if (!useDoc.getState().dirty) await api.autosaveClear().catch(() => {});
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
      const hasDoc = !!useDoc.getState().doc;
      if (mod && !e.shiftKey && k === "s") {
        e.preventDefault();
        if (hasDoc) void saveDoc(t);
      } else if (mod && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        if (hasDoc) void saveDoc(t, true);
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
      } else if (mod && !e.shiftKey && /^Digit[1-3]$/.test(e.code) && hasDoc) {
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
    show,
    { available: api.launcherAvailable, open: api.openLauncher, onError: (e) => useUi.getState().showToast(String(e), "error") },
    (name) => t("Back to Theatre Suite · {show}", { show: name }),
  );
  const docLabel = doc?.title.trim() || t("Lights");
  const fileLabel = !doc ? undefined : filePath ? basename(filePath).replace(/\.granvelo$/i, "") : `${docLabel} · ${t("not saved yet")}`;
  // The file name already says "not saved yet": the state on its right only says what is kept.
  const saveState = !doc
    ? undefined
    : dirty
      ? { text: isTauri ? t("Unsaved changes · copy kept") : t("Unsaved changes"), dirty }
      : filePath
        ? { text: t("Saved"), dirty }
        : isTauri
          ? { text: t("Copy kept"), dirty }
          : undefined;
  return (
    <div className="ts-app gv-app">
      <TitleBar
        logo={<AppLogo accentPath={LOGO.accent} inkPath={LOGO.ink} label="Granvelo" size={20} strokeWidth={LOGO.stroke(20)} />}
        appName=""
        show={show}
        {...home}
        fileName={fileLabel}
        saveState={saveState}
        version={APP_NAME}
        actions={<FileMenu />}
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
            ? t("Granvelo was closed unexpectedly. Your work has been restored.")
            : t("Granvelo was closed unexpectedly. Unsaved work from the last session is available.")}
          <span className="ts-spacer" />
          {banner.kind === "crashRestoreAvailable" && banner.data ? (
            <Button
              variant="sm"
              icon="reset"
              onClick={async () => {
                if (await confirmDiscard(t)) restoreAutosave(banner.data!);
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
      <TopBar hasDoc={!!doc} mode={mode} />
      <div className="gv-body">{!doc ? <StartScreen /> : mode === "setup" ? <SetupMode /> : mode === "desk" ? <DeskMode /> : <ShowMode />}</div>
      <StatusBar>
        <StatusLine />
      </StatusBar>
      {dialog === "settings" ? <SettingsDialog /> : null}
      {dialog === "versions" ? <VersionsDialog /> : null}
      {dialog === "newShow" ? <NewShowDialog /> : null}
      <ConfirmHost />
      <AppToast />
    </div>
  );
}

/** Under the title bar: DMX output on the left, the three modes in the centre, Undo/Redo and Settings on the right. */
function TopBar({ hasDoc, mode }: { hasDoc: boolean; mode: Mode }) {
  const t = useT();
  const canUndo = useDoc((s) => s.canUndo);
  const canRedo = useDoc((s) => s.canRedo);
  return (
    <div className="gv-topbar">
      <div className="gv-topbar__side">
        {/* Phase 1 (Granvelo 0.2) replaces this label with "Connetti" and the state of the cable. */}
        <span className="gv-dmx" title={t("The DMX output arrives with Granvelo 0.2. Until then nothing is sent to the lights.")}>
          <span className="ts-dot" />
          <span className="gv-dmx__label">{t("DMX output")}:</span>
          <span className="gv-dmx__state">{t("not connected")}</span>
        </span>
      </div>
      {hasDoc ? (
        <Segmented<Mode>
          ariaLabel={t("Mode")}
          value={mode}
          onChange={(m) => useUi.getState().setMode(m)}
          options={[
            { value: "setup", label: t("Setup"), icon: "stage" },
            { value: "desk", label: t("Desk"), icon: "bench" },
            { value: "show", label: t("Show (mode)"), icon: "curtain" },
          ]}
        />
      ) : (
        <span />
      )}
      <div className="gv-topbar__side gv-topbar__side--end">
        <Button variant="ghost" iconOnly icon="undo" disabled={!canUndo} aria-label={t("Undo")} title={`${t("Undo")} · Ctrl Z`} onClick={() => useDoc.getState().undo()} />
        <Button variant="ghost" iconOnly icon="redo" disabled={!canRedo} aria-label={t("Redo")} title={`${t("Redo")} · Ctrl Y`} onClick={() => useDoc.getState().redo()} />
        <Button variant="ghost" icon="settings" title={`${t("Settings")} · Ctrl ,`} aria-label={t("Settings")} onClick={() => useUi.getState().openSettings()}>
          <span className="gv-bl">{t("Settings")}</span>
        </Button>
      </div>
    </div>
  );
}

/** Bottom line: lights, channels used of 512, conflicts in amber. */
function StatusLine() {
  const t = useT();
  const doc = useDoc((s) => s.doc);
  const info = useMemo(() => {
    if (!doc) return null;
    const p = addressProblems(doc);
    const conflictLights = new Set([...p.conflicts.keys(), ...p.outOfRange]);
    return { lights: doc.fixtures.length, unused: doc.fixtures.filter((f) => f.unused).length, channels: channelsInUse(doc), problems: conflictLights.size, memories: doc.memories.length };
  }, [doc]);
  if (!info) return <span className="ts-muted">{t("No show open")}</span>;
  return (
    <>
      <span>{info.lights === 1 ? t("1 light") : t("{n} lights", { n: info.lights })}</span>
      {info.unused ? <span className="ts-muted">{info.unused === 1 ? t("1 not used") : t("{n} not used", { n: info.unused })}</span> : null}
      <span>{t("{n} channels used of 512", { n: info.channels })}</span>
      {info.problems ? (
        <span className="gv-status-warn">
          <span className="ts-dot ts-dot--sb" />
          {info.problems === 1 ? t("1 light with an address problem") : t("{n} lights with an address problem", { n: info.problems })}
        </span>
      ) : (
        <span className="ts-muted">{t("No address conflicts")}</span>
      )}
      <span className="ts-spacer" />
      <span className="ts-muted">{info.memories === 1 ? t("1 memory") : t("{n} memories", { n: info.memories })}</span>
    </>
  );
}
