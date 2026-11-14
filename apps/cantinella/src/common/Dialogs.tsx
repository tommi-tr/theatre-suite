import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { SettingsDialog } from "./SettingsDialog";
import { ImportDialog } from "./ImportDialog";
import { CopyListDialog } from "./CopyListDialog";

/** Shows the window asked for (one at a time). */
export function Dialogs() {
  const d = useUi((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case "settings":
      return <SettingsDialog />;
    case "import":
      return <ImportDialog />;
    case "copyList":
      return <CopyListDialog />;
    case "deletePerson":
      return d.extra ? <DeletePersonDialog id={d.extra} /> : null;
    default:
      return null;
  }
}

/** Confirmation before deleting: "Cancel" is the default choice. */
function DeletePersonDialog({ id }: { id: string }) {
  const t = useT();
  const person = useDoc((s) => s.data.people.find((p) => p.id === id));
  const close = () => useUi.getState().closeDialog();
  if (!person) return null;
  return (
    <Dialog
      title={t("Delete {name}?", { name: person.name || t("this person") })}
      icon="trash"
      onClose={close}
      width={440}
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => {
              useDoc.getState().change((d) => ({ ...d, people: d.people.filter((p) => p.id !== id) }));
              useUi.getState().selectPerson(null);
              close();
              useUi.getState().showToast(t("{name} deleted. Ctrl Z brings it back.", { name: person.name }));
            }}
          >
            {t("Delete")}
          </Button>
        </>
      }
    >
      <p className="cn-dialog-text">{t("The person is removed from the contacts of this production.")}</p>
    </Dialog>
  );
}
