import { useEffect, useRef, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd } from "@theatre-suite/ui";
import { confirmDiscard, newDoc, openDocDialog, openDocPath, openSample, saveDoc } from "../lib/files";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

export function FileMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const recent = useSettings((s) => s.settings.recentFiles);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button variant="ghost" icon="save" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("File")}
        <Icon name="chevDown" size={12} />
      </Button>
      {open ? (
        <div className="bd-menu" role="menu" style={{ top: "calc(100% + 6px)", right: 0, minWidth: 280 }}>
          <button type="button" className="bd-menu__item" onClick={run(() => newDoc(t))}>
            <Icon name="fileAdd" size={15} />
            {t("New script")}
            <Kbd>Ctrl N</Kbd>
          </button>
          <button type="button" className="bd-menu__item" onClick={run(() => openDocDialog(t))}>
            <Icon name="folderOpen" size={15} />
            {t("Open…")}
            <Kbd>Ctrl O</Kbd>
          </button>
          {recent.length ? <div className="bd-menu__label">{t("Recent")}</div> : null}
          {recent.slice(0, 6).map((p) => (
            <button
              key={p}
              type="button"
              className="bd-menu__item"
              title={p}
              onClick={run(async () => {
                if (await confirmDiscard(t)) await openDocPath(t, p);
              })}
            >
              <Icon name="file" size={15} />
              <span className="ts-ellipsis">{basename(p)}</span>
            </button>
          ))}
          <div className="bd-menu__sep" />
          <button type="button" className="bd-menu__item" onClick={run(() => saveDoc(t))}>
            <Icon name="save" size={15} />
            {t("Save")}
            <Kbd>Ctrl S</Kbd>
          </button>
          <button type="button" className="bd-menu__item" onClick={run(() => saveDoc(t, true))}>
            <Icon name="save" size={15} />
            {t("Save as…")}
            <Kbd>Ctrl Shift S</Kbd>
          </button>
          <div className="bd-menu__sep" />
          <button type="button" className="bd-menu__item" onClick={run(() => useUi.getState().openDialog("import"))}>
            <Icon name="upload" size={15} />
            {t("Import from Word or text…")}
          </button>
          <button type="button" className="bd-menu__item" onClick={run(() => useUi.getState().setPhase("send"))}>
            <Icon name="send" size={15} />
            {t("Export, print, send…")}
            <Kbd>Ctrl P</Kbd>
          </button>
          <div className="bd-menu__sep" />
          <button type="button" className="bd-menu__item" onClick={run(() => openSample(t))}>
            <Icon name="book" size={15} />
            {t("Open the example (Hamlet)")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
