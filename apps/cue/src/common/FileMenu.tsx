import { useEffect, useRef, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, type IconName } from "@theatre-suite/ui";
import { api, appWindow, isDemo, isTauri } from "../lib/api";
import { newDocDialog, openDemo, openDocDialog, openRecent, saveDoc } from "../lib/files";
import { exportScript, loadScript, replaceScript } from "../lib/script";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

/** The "File" menu of the title bar (always with its label, 02_design.md). */
export function FileMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const recent = useSettings((s) => s.settings.recentFiles);
  const filePath = useDoc((s) => s.filePath);
  const hasDoc = useDoc((s) => s.show !== null);
  const hasScript = useDoc((s) => s.show?.script?.kind === "pdf");
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const item = (key: string, icon: IconName, label: string, kbd: string | null, fn: () => void, opts: { disabled?: boolean; title?: string } = {}) => (
    <button
      key={key}
      type="button"
      className="cue-menu__item"
      role="menuitem"
      disabled={opts.disabled}
      title={opts.title}
      onClick={() => {
        setOpen(false);
        fn();
      }}
    >
      <Icon name={icon} size={15} />
      <span className="ts-ellipsis" style={{ flex: 1 }}>
        {label}
      </span>
      {kbd ? <Kbd>{kbd}</Kbd> : null}
    </button>
  );
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button variant="ghost" icon="save" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {t("File")}
        <Icon name="chevDown" size={12} />
      </Button>
      {open ? (
        <div className="cue-menu" role="menu">
          {item("new", "fileAdd", t("New…"), "Ctrl N", () => newDocDialog(t))}
          {item("open", "folderOpen", t("Open…"), "Ctrl O", () => openDocDialog(t))}
          {isDemo ? item("demo", "sparkle", t("Open the demo show"), null, () => void openDemo()) : null}
          <div className="cue-menu__sep" />
          {item("save", "save", t("Save"), "Ctrl S", () => saveDoc(t), { disabled: !hasDoc })}
          {item("saveAs", "save", t("Save as…"), "Ctrl Shift S", () => saveDoc(t, true), { disabled: !hasDoc })}
          {item("versions", "history", t("Versions…"), null, () => useUi.getState().openDialog("versions"), { disabled: !hasDoc })}
          <div className="cue-menu__sep" />
          {hasScript
            ? item("replaceScript", "upload", t("Replace the script…"), null, () => void replaceScript(t))
            : item("loadScript", "upload", t("Load the script…"), null, () => void loadScript(t), { disabled: !hasDoc })}
          {item("exportScript", "download", t("Export the PDF…"), null, () => void exportScript(t), { disabled: !hasScript })}
          <div className="cue-menu__sep" />
          {item("reveal", "folder", t("Show in folder"), null, () => void api.revealInFolder(filePath!).catch(() => {}), { disabled: !filePath || !isTauri })}
          {recent.length ? (
            <>
              <div className="cue-menu__sep" />
              <div className="ts-label cue-menu__label">{t("Recent")}</div>
              {recent.slice(0, 6).map((p) => item(`r:${p}`, "file", basename(p), null, () => void openRecent(t, p), { title: p }))}
            </>
          ) : null}
          <div className="cue-menu__sep" />
          {item("quit", "x", t("Quit"), "Alt F4", () => void appWindow.close())}
        </div>
      ) : null}
    </div>
  );
}
