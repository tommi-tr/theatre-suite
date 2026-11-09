import { useCallback, useEffect, useState } from "react";
import { I18nProvider, basename, useApplyTheme, useT } from "@theatre-suite/core";
import { AppLogo, Button, Icon, Segmented, TitleBar } from "@theatre-suite/ui";
import { redo, undo } from "prosemirror-history";
import { DICTS } from "./i18n";
import { api, appWindow, isTauri, onEvent } from "./lib/api";
import { confirmDiscard, flushAutosave, newDoc, openDocDialog, openDocPath, restoreAutosave, saveDoc, startAutosave } from "./lib/files";
import { LOGO } from "./lib/version";
import { newScriptDoc } from "./model/defaults";
import { sampleDoc } from "./model/sample";
import { insertPart, removeCategory } from "./editor/commands";
import { setNodeViewTranslator } from "./editor/nodeviews";
import { useDoc, useData } from "./store/doc";
import { useSettings } from "./store/settings";
import { useUi } from "./store/ui";
import { ComposePhase } from "./compose/ComposePhase";
import { FormatStyle } from "./compose/Editor";
import { markWithCategory, newNote } from "./compose/actions";
import { FileMenu } from "./common/FileMenu";
import { Dialogs } from "./common/Dialogs";
import { BardoToast } from "./common/BardoToast";
import { FormatPhase } from "./format/FormatPhase";
import { SendPhase } from "./send/SendPhase";
import { PrintRoot } from "./send/PrintView";

export function App() {
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  useApplyTheme(settings.theme);
  useEffect(() => {
    useSettings
      .getState()
      .load()
      .then(() => {
        // First document: a new empty script (startup may replace it with a file or a recovered copy).
        if (!useDoc.getState().doc) useDoc.getState().load(newScriptDoc(useSettings.getState().settings.docLang), { filePath: null, dirty: false, versions: [] });
      });
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
  setNodeViewTranslator(t);
  const phase = useUi((s) => s.phase);
  const banner = useUi((s) => s.banner);
  const filePath = useDoc((s) => s.filePath);
  const dirty = useDoc((s) => s.dirty);
  const hasDoc = useDoc((s) => !!s.doc);
  const data = useData();
  const [maximized, setMaximized] = useState(false);

  // Startup: crash recovery, file passed on the command line, autosave.
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
      } else if (location.search.includes("demo")) {
        useDoc.getState().load(sampleDoc(useSettings.getState().settings.language), { filePath: null, dirty: false, versions: [] });
      }
      if (!useSettings.getState().settings.guideSeen) {
        useSettings.getState().update({ guideSeen: true });
        useUi.getState().openDialog("guide");
      }
      stops.push(startAutosave());
    })();
    return () => {
      disposed = true;
      stops.forEach((f) => f());
    };
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
      const view = useDoc.getState().view;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && k === "s") {
        e.preventDefault();
        saveDoc(t);
      } else if (mod && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        saveDoc(t, true);
      } else if (mod && k === "o") {
        e.preventDefault();
        openDocDialog(t);
      } else if (mod && !e.shiftKey && k === "n") {
        e.preventDefault();
        newDoc(t);
      } else if (mod && k === "p") {
        e.preventDefault();
        ui.setPhase("send");
      } else if (mod && k === ",") {
        e.preventDefault();
        ui.openDialog("settings");
      } else if (e.key === "F1") {
        e.preventDefault();
        ui.openDialog("guide");
      } else if (e.defaultPrevented || ui.phase !== "compose" || !view) {
        return;
      } else if (mod && k === "f") {
        e.preventDefault();
        ui.setFind({ open: true, replace: false });
      } else if (mod && k === "h") {
        e.preventDefault();
        ui.setFind({ open: true, replace: true });
      } else if (e.key === "F11") {
        e.preventDefault();
        ui.toggleFocus();
      } else if (mod && e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        newNote(view, t);
      } else if (mod && e.shiftKey && /^Digit[123]$/.test(e.code)) {
        e.preventDefault();
        insertPart(view, (["act", "tableau", "scene"] as const)[Number(e.code.slice(5)) - 1]);
      } else if (mod && !e.shiftKey && e.code === "Digit0") {
        e.preventDefault();
        removeCategory(view);
      } else if (mod && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const cats = useDoc.getState().state ? (useDoc.getState().state!.doc.attrs.data?.categories ?? []) : [];
        const cat = cats[Number(e.code.slice(5)) - 1];
        if (cat) {
          e.preventDefault();
          markWithCategory(view, t, cat.id);
        }
      }
    },
    [t],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const ui = useUi.getState();
  const title = data?.meta.title.trim();
  const fileLabel = filePath ? basename(filePath).replace(/\.bardo$/i, "") : t("Not saved yet");
  const view = useDoc.getState().view;
  return (
    <div className="ts-app">
      <FormatStyle />
      <TitleBar
        logo={<AppLogo accentPath={LOGO.accent} inkPath={LOGO.ink} label="Bardo" />}
        appName="Bardo"
        fileName={title ? `${title.toLocaleUpperCase()} — ${fileLabel}` : fileLabel}
        saveState={{ text: dirty ? (filePath ? t("Unsaved changes · copy kept") : t("Not saved yet · copy kept")) : t("Saved"), dirty }}
        center={
          <Segmented
            ariaLabel={t("Phase")}
            value={phase}
            onChange={(p) => useUi.getState().setPhase(p)}
            options={[
              { value: "compose", label: t("Compose"), icon: "pen" },
              { value: "format", label: t("Format"), icon: "type" },
              { value: "send", label: t("Send"), icon: "send" },
            ]}
          />
        }
        actions={
          <>
            <Button variant="ghost" iconOnly icon="undo" aria-label={t("Undo")} title={`${t("Undo")} · Ctrl Z`} onClick={() => view && undo(view.state, view.dispatch)} />
            <Button variant="ghost" iconOnly icon="redo" aria-label={t("Redo")} title={`${t("Redo")} · Ctrl Y`} onClick={() => view && redo(view.state, view.dispatch)} />
            {phase === "compose" ? (
              <label className="bd-search" title={`${t("Find")} · Ctrl F`}>
                <Icon name="search" size={14} />
                <input aria-label={t("Find")} placeholder={t("Find")} onFocus={(e) => (e.currentTarget.blur(), ui.setFind({ open: true, replace: false }))} />
              </label>
            ) : null}
            <FileMenu />
            <Button variant="ghost" iconOnly icon="book" aria-label={t("Guide")} onClick={() => ui.openDialog("guide")} title={`${t("Guide")} · F1`} />
            <Button variant="ghost" iconOnly icon="settings" aria-label={t("Settings")} onClick={() => ui.openDialog("settings")} title={`${t("Settings")} · Ctrl ,`} />
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
          {banner.kind === "crashRestored" ? t("Bardo was closed unexpectedly. Your work has been restored.") : t("Bardo was closed unexpectedly. Unsaved work from the last session is available.")}
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
      <div className="bd-body">
        {hasDoc ? <ComposePhase /> : null}
        {phase === "format" ? (
          <div className="bd-cover">
            <FormatPhase />
          </div>
        ) : null}
        {phase === "send" ? (
          <div className="bd-cover">
            <SendPhase />
          </div>
        ) : null}
      </div>
      <Dialogs />
      <BardoToast />
      <PrintRoot />
    </div>
  );
}
