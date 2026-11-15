import { useCallback, useEffect, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { AppLogo, Button, StatusBar, TitleBar } from "@theatre-suite/ui";
import { api, appWindow, isTauri, onEvent } from "../lib/api";
import { confirmDiscard, flushAutosave, newDoc, openDocDialog, openDocPath, restoreAutosave, saveDoc, startAutosave, startPlace } from "../lib/files";
import { APP_NAME, LOGO } from "../lib/version";
import { DEMO_SHOW, demoData } from "../model/demo";
import { newData } from "../model/defaults";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { FileMenu } from "../common/FileMenu";
import { Dialogs } from "../common/Dialogs";
import { AppToast } from "../common/AppToast";
import { SectionBar } from "./SectionBar";
import { PartsNav } from "./PartsNav";
import { StartScreen } from "./StartScreen";
import { PartView, PartStatus } from "./PartView";

export function Shell() {
  const t = useT();
  const filePath = useDoc((s) => s.filePath);
  const dirty = useDoc((s) => s.dirty);
  const show = useDoc((s) => s.show);
  const title = useDoc((s) => s.data.title);
  const canUndo = useDoc((s) => s.canUndo);
  const canRedo = useDoc((s) => s.canRedo);
  const section = useUi((s) => s.section);
  const banner = useUi((s) => s.banner);
  const [maximized, setMaximized] = useState(false);

  // Startup: crash recovery, file passed on the command line, autosave; demo data in the preview.
  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    (async () => {
      if (isTauri) {
        useDoc.getState().load(newData(t("Production")), { filePath: null, dirty: false });
        startPlace();
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
        useDoc.getState().load(demoData(), { filePath: null, dirty: false });
        useDoc.getState().setShow(DEMO_SHOW);
        if (location.search.includes("start")) useUi.getState().go(null);
        else startPlace();
      } else {
        useDoc.getState().load(newData(t("Production")), { filePath: null, dirty: false });
        startPlace();
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
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (ui.dialog) return;
      const typing = !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
      if (mod && !e.shiftKey && k === "s") {
        e.preventDefault();
        void saveDoc(t);
      } else if (mod && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        void saveDoc(t, true);
      } else if (mod && k === "o") {
        e.preventDefault();
        void openDocDialog(t);
      } else if (mod && !e.shiftKey && k === "n") {
        e.preventDefault();
        void newDoc(t);
      } else if (mod && k === ",") {
        e.preventDefault();
        ui.openDialog("settings");
      } else if (mod && !e.shiftKey && k === "z" && !typing) {
        e.preventDefault();
        useDoc.getState().undo();
      } else if (mod && ((k === "y" && !typing) || (e.shiftKey && e.code === "KeyZ" && !typing))) {
        e.preventDefault();
        useDoc.getState().redo();
      } else if (mod && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        const ids = ["rehearsals", "budget", "departments", "tour", "calendar"] as const;
        ui.go(ids[Number(e.code.slice(5)) - 1]);
      }
    },
    [t],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // Text pasted while the rehearsals are open and nothing is being typed: it is the replies to read.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const ui = useUi.getState();
      if (ui.dialog || ui.section !== "rehearsals") return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim()) return;
      e.preventDefault();
      if (useDoc.getState().data.rehearsals.dates.length === 0) {
        ui.go("rehearsals", "dates");
        ui.showToast(t("Add the dates first: the replies are read against them."), "error");
        return;
      }
      ui.go("rehearsals", "availability");
      ui.openPaste(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [t]);

  const docLabel = title.trim() || t("Production");
  const fileLabel = filePath ? basename(filePath).replace(/\.cantinella$/i, "") : `${docLabel} · ${t("not saved yet")}`;
  return (
    <div className="ts-app cn-app">
      <TitleBar
        logo={<AppLogo accentPath={LOGO.accent} inkPath={LOGO.ink} label="Cantinella" size={20} strokeWidth={7} />}
        appName="Cantinella"
        show={show}
        fileName={show ? docLabel : fileLabel}
        saveState={{ text: dirty ? t("Unsaved changes · copy kept") : filePath ? t("Saved") : t("Copy kept"), dirty }}
        version={APP_NAME}
        actions={
          <>
            <Button variant="ghost" iconOnly icon="undo" disabled={!canUndo} aria-label={t("Undo")} title={`${t("Undo")} · Ctrl Z`} onClick={() => useDoc.getState().undo()} />
            <Button variant="ghost" iconOnly icon="redo" disabled={!canRedo} aria-label={t("Redo")} title={`${t("Redo")} · Ctrl Y`} onClick={() => useDoc.getState().redo()} />
            <FileMenu />
            <Button variant="ghost" iconOnly icon="settings" aria-label={t("Settings")} title={`${t("Settings")} · Ctrl ,`} onClick={() => useUi.getState().openDialog("settings")} />
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
            ? t("Cantinella was closed unexpectedly. Your work has been restored.")
            : t("Cantinella was closed unexpectedly. Unsaved work from the last session is available.")}
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
      <SectionBar />
      <div className="cn-body">
        {section === null ? (
          <StartScreen />
        ) : (
          <>
            <PartsNav section={section} />
            <main className="cn-main">
              <PartView section={section} />
            </main>
          </>
        )}
      </div>
      <StatusBar>
        <PartStatus />
      </StatusBar>
      <Dialogs />
      <AppToast />
    </div>
  );
}
