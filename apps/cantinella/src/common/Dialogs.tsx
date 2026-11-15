import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { SettingsDialog } from "./SettingsDialog";
import { ImportDialog } from "./ImportDialog";
import { CopyListDialog } from "./CopyListDialog";
import { CopyMessageDialog } from "./CopyMessageDialog";
import { PasteDialog } from "./PasteDialog";
import { dayLabel } from "../model/rehearsals";
import { forgetPerson } from "../model/scenes";

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
    case "pasteReplies":
      return <PasteDialog />;
    case "copyMessage":
      return <CopyMessageDialog initial={(d.extra as "dates" | "reminder" | "plan" | "actor" | undefined) ?? "dates"} />;
    case "deletePerson":
      return d.extra ? <DeletePersonDialog id={d.extra} /> : null;
    case "deleteDate":
      return d.extra ? <DeleteDateDialog id={d.extra} /> : null;
    case "confirm":
      return <ConfirmDialog />;
    default:
      return null;
  }
}

/** Generic confirmation (asked with `useUi.ask`). */
function ConfirmDialog() {
  const t = useT();
  const c = useUi((s) => s.confirm);
  const close = () => useUi.getState().closeDialog();
  if (!c) return null;
  return (
    <Dialog
      title={c.title}
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
              c.run();
              close();
            }}
          >
            {c.action}
          </Button>
        </>
      }
    >
      <p className="cn-dialog-text">{c.text}</p>
    </Dialog>
  );
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
              useDoc.getState().change((d) => ({
                ...d,
                people: d.people.filter((p) => p.id !== id),
                rehearsals: forgetPerson({ ...d.rehearsals, answers: d.rehearsals.answers.filter((a) => a.personId !== id) }, id),
              }));
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

/** Confirmation before deleting a date: the replies given for it go with it. */
function DeleteDateDialog({ id }: { id: string }) {
  const t = useT();
  const date = useDoc((s) => s.data.rehearsals.dates.find((d) => d.id === id));
  const replies = useDoc((s) => s.data.rehearsals.answers.filter((a) => a.dateId === id).length);
  const close = () => useUi.getState().closeDialog();
  if (!date) return null;
  const label = dayLabel(date.day);
  return (
    <Dialog
      title={t("Delete {name}?", { name: label })}
      icon="trash"
      onClose={close}
      width={460}
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => {
              useDoc.getState().change((d) => ({
                ...d,
                rehearsals: {
                  ...d.rehearsals,
                  dates: d.rehearsals.dates.filter((x) => x.id !== id),
                  answers: d.rehearsals.answers.filter((a) => a.dateId !== id),
                  plan: d.rehearsals.plan.filter((p) => p.dateId !== id),
                },
              }));
              close();
              useUi.getState().showToast(t("{name} deleted. Ctrl Z brings it back.", { name: label }));
            }}
          >
            {t("Delete")}
          </Button>
        </>
      }
    >
      <p className="cn-dialog-text">
        {replies
          ? replies === 1
            ? t("The date is removed from the rehearsals, with the 1 reply given for it.")
            : t("The date is removed from the rehearsals, with the {n} replies given for it.", { n: replies })
          : t("The date is removed from the rehearsals.")}
      </p>
    </Dialog>
  );
}
