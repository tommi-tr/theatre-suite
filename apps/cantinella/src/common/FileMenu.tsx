import { useEffect, useRef, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd } from "@theatre-suite/ui";
import { api, isTauri } from "../lib/api";
import { confirmDiscard, newDoc, openDocDialog, openDocPath, saveDoc } from "../lib/files";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

export function FileMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const recent = useSettings((s) => s.settings.recentFiles);
  const filePath = useDoc((s) => s.filePath);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button variant="ghost" icon="save" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <span className="cn-bl-label">{t("File")}</span>
        <Icon name="chevDown" size={12} />
      </Button>
      {open ? (
        <div className="cn-menu" role="menu">
          <button type="button" role="menuitem" className="cn-menu__item" onClick={run(() => newDoc(t))}>
            <Icon name="fileAdd" size={15} />
            {t("New production")}
            <Kbd>Ctrl N</Kbd>
          </button>
          <button type="button" role="menuitem" className="cn-menu__item" onClick={run(() => openDocDialog(t))}>
            <Icon name="folderOpen" size={15} />
            {t("Open…")}
            <Kbd>Ctrl O</Kbd>
          </button>
          {recent.length ? <div className="cn-menu__label">{t("Recent")}</div> : null}
          {recent.slice(0, 6).map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className="cn-menu__item"
              title={p}
              onClick={run(async () => {
                if (!(await confirmDiscard(t))) return;
                if (isTauri && !(await api.pathExists(p))) {
                  useSettings.getState().removeRecent(p);
                  useUi.getState().showToast(t("{name} is no longer there: removed from the list.", { name: basename(p) }), "error");
                  return;
                }
                await openDocPath(t, p);
              })}
            >
              <Icon name="file" size={15} />
              <span className="ts-ellipsis">{basename(p)}</span>
            </button>
          ))}
          <div className="cn-menu__sep" />
          <button type="button" role="menuitem" className="cn-menu__item" onClick={run(() => saveDoc(t))}>
            <Icon name="save" size={15} />
            {t("Save")}
            <Kbd>Ctrl S</Kbd>
          </button>
          <button type="button" role="menuitem" className="cn-menu__item" onClick={run(() => saveDoc(t, true))}>
            <Icon name="save" size={15} />
            {t("Save as…")}
            <Kbd>Ctrl Shift S</Kbd>
          </button>
          {filePath ? (
            <button type="button" role="menuitem" className="cn-menu__item" onClick={run(() => api.revealInFolder(filePath).catch(() => {}))}>
              <Icon name="folder" size={15} />
              {t("Show in folder")}
            </button>
          ) : null}
          <div className="cn-menu__sep" />
          <button type="button" role="menuitem" className="cn-menu__item" onClick={run(() => useUi.getState().openDialog("import"))}>
            <Icon name="upload" size={15} />
            {t("Import contacts (vCard, CSV)…")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
