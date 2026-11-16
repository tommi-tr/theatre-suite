import { useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { fmtSize } from "../lib/format";
import { pickFolder } from "../lib/pick";
import { explain } from "../lib/text";
import type { ShowNode } from "../lib/types";
import { useStore } from "../state/store";

/** Copy of a show (for example a tour version): a new folder with all the files, inside the original or elsewhere. */
export function CopyDialog({ node }: { node: ShowNode }) {
  const t = useT();
  const [name, setName] = useState(`${node.title} · ${t("copy")}`);
  const [where, setWhere] = useState<"inside" | "elsewhere">("inside");
  const [nested, setNested] = useState("");
  const [other, setOther] = useState("");
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.nestedDefault(node.path).then(setNested).catch(() => {});
    void api.copySize(node.path).then(setSize).catch(() => {});
  }, [node.path]);

  const dest = where === "inside" ? nested : other;
  const create = async () => {
    if (!name.trim() || !dest) return;
    setBusy(true);
    setError("");
    try {
      const path = await api.showCopy(node.path, dest, name.trim());
      await useStore.getState().refreshShows(true);
      useStore.getState().setDialog(null);
      useStore.getState().showToast(t("Copy created."));
      if (useStore.getState().screen.name === "project") await useStore.getState().openShow(path);
    } catch (e) {
      setError(explain(t, e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("Make a copy of “{title}”", { title: node.title })}
      icon="duplicate"
      width={560}
      onClose={() => useStore.getState().setDialog(null)}
      description={t("Useful for versions of a tour. A new folder is created with all the files of the show; the original is not touched.")}
      footer={
        <>
          <span className="ln-dim ln-foot-note">{size !== null ? t("About {size} will be copied", { size: fmtSize(size) }) : ""}</span>
          <Button onClick={() => useStore.getState().setDialog(null)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim() || !dest || busy} onClick={() => void create()}>
            {busy ? t("Copying…") : t("Make the copy")}
          </Button>
        </>
      }
    >
      <div className="ln-form">
        <label className="ln-field">
          <span className="ln-field__label">{t("Name of the copy")}</span>
          <input className="ln-input" value={name} autoFocus onChange={(e) => setName(e.currentTarget.value)} />
        </label>

        <fieldset className="ln-radios">
          <legend className="ln-field__label">{t("Where")}</legend>
          <label className={`ln-radio${where === "inside" ? " is-on" : ""}`}>
            <input type="radio" name="where" checked={where === "inside"} onChange={() => setWhere("inside")} />
            <span>
              <strong>{t("Inside the original show")}</strong>
              <small>{nested || "…"}</small>
            </span>
          </label>
          <label className={`ln-radio${where === "elsewhere" ? " is-on" : ""}`}>
            <input type="radio" name="where" checked={where === "elsewhere"} onChange={() => setWhere("elsewhere")} />
            <span>
              <strong>{t("In another folder")}</strong>
              <small>{other || t("Choose a folder, for example a USB stick or a shared folder")}</small>
            </span>
            {where === "elsewhere" ? (
              <Button variant="sm" onClick={() => void pickFolder(t("Choose where to put the copy"), other || undefined).then((d) => d && setOther(d))}>{t("Choose…")}</Button>
            ) : null}
          </label>
        </fieldset>
        {error ? <div className="ln-error">{error}</div> : null}
      </div>
    </Dialog>
  );
}
