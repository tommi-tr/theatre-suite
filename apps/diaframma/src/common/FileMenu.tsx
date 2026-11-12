import { useEffect, useRef, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, type IconName } from "@theatre-suite/ui";
import { confirmDiscard, exportCsv, newDocConfirm, openDocDialog, openDocPath, saveDoc } from "../lib/files";
import { useDoc } from "../state/doc";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";

export function FileMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const locked = useDoc((s) => s.locked);
  const recent = useSettings((s) => s.settings.recentFiles);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const item = (icon: IconName, label: string, kbd: string | null, fn: () => void) => (
    <button
      type="button"
      className="df-menu__item"
      role="menuitem"
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
      <Button variant="ghost" icon="save" onClick={() => setOpen((v) => !v)} disabled={locked} aria-haspopup="menu" aria-expanded={open}>
        {t("Save")}
        <Icon name="chevDown" size={13} />
      </Button>
      {open ? (
        <div className="df-menu" role="menu">
          {item("save", t("Save"), "Ctrl S", () => saveDoc(t))}
          {item("save", t("Save as…"), "Ctrl Shift S", () => saveDoc(t, true))}
          {item("history", t("Versions…"), null, () => useUi.getState().openDialog("versions"))}
          {item("folderOpen", t("Open cue list…"), "Ctrl O", () => openDocDialog(t))}
          {item("fileAdd", t("New cue list"), "Ctrl N", () => newDocConfirm(t))}
          {item("download", t("Export cue list (CSV)…"), null, () => exportCsv(t))}
          {recent.length ? (
            <>
              <div className="df-menu__sep" />
              <div className="ts-label" style={{ padding: "6px 10px 4px" }}>
                {t("Recent")}
              </div>
              {recent.slice(0, 6).map((p) =>
                item("file", basename(p), null, async () => {
                  if (await confirmDiscard(t)) await openDocPath(t, p);
                }),
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
