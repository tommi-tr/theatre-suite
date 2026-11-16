import { useEffect, useRef, useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, type IconName } from "@theatre-suite/ui";
import { api, isTauri } from "../lib/api";
import { closeDoc, confirmDiscard, newDocDialog, openDemo, openDocDialog, openDocPath, saveDoc } from "../lib/files";
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
  const hasDoc = useDoc((s) => s.doc !== null);
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
  const item = (icon: IconName, label: string, kbd: string | null, fn: () => void, opts: { disabled?: boolean; title?: string } = {}) => (
    <button
      type="button"
      className="gv-menu__item"
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
        <div className="gv-menu" role="menu">
          {item("fileAdd", t("New show…"), "Ctrl N", () => newDocDialog(t))}
          {item("folderOpen", t("Open…"), "Ctrl O", () => openDocDialog(t))}
          {item("sparkle", t("Open the demo show"), null, () => openDemo(t))}
          <div className="gv-menu__sep" />
          {item("save", t("Save"), "Ctrl S", () => saveDoc(t), { disabled: !hasDoc })}
          {item("save", t("Save as…"), "Ctrl Shift S", () => saveDoc(t, true), { disabled: !hasDoc })}
          {item("history", t("Versions…"), null, () => useUi.getState().openDialog("versions"), { disabled: !hasDoc })}
          {filePath && isTauri ? item("folder", t("Show in folder"), null, () => void api.revealInFolder(filePath).catch(() => {})) : null}
          {item("x", t("Close the show"), null, () => closeDoc(t), { disabled: !hasDoc })}
          {recent.length ? (
            <>
              <div className="gv-menu__sep" />
              <div className="ts-label gv-menu__label">{t("Recent")}</div>
              {recent.slice(0, 6).map((p) =>
                item(
                  "file",
                  basename(p),
                  null,
                  async () => {
                    if (!(await confirmDiscard(t))) return;
                    if (isTauri && !(await api.pathExists(p))) {
                      useSettings.getState().removeRecent(p);
                      useUi.getState().showToast(t("{name} is no longer there: removed from the list.", { name: basename(p) }), "error");
                      return;
                    }
                    await openDocPath(t, p);
                  },
                  { title: p },
                ),
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
