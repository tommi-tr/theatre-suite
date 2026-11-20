import { useEffect, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { createDoc } from "../lib/files";
import { useUi } from "../store/ui";

/** Stable reference: Dialog refocuses its first button whenever `onClose` changes. */
const close = () => useUi.getState().closeDialog();

/** File → New show: only the title (everything else comes later, in Prepara). */
export function NewShowDialog() {
  const t = useT();
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // After the Dialog's own focus (parent effects run last): the title is what to type first.
  useEffect(() => input.current?.focus(), []);
  const create = () => {
    createDoc(title);
    close();
  };
  return (
    <Dialog
      title={t("New show")}
      icon="fileAdd"
      width={460}
      onClose={close}
      closeLabel={t("Close")}
      footer={
        <>
          <span className="ts-spacer" />
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" icon="check" onClick={create}>
            {t("Create the show")}
          </Button>
        </>
      }
    >
      <label className="ts-field">
        <span className="ts-label">{t("Title of the show")}</span>
        <input
          ref={input}
          className="ts-input"
          value={title}
          maxLength={200}
          placeholder={t("For example: La locandiera")}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <span className="ts-field__hint">{t("The script, the GOs and the rest come after, in Prepare.")}</span>
      </label>
    </Dialog>
  );
}
