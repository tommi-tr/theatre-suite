import { useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { CopyPreview, Dialog, Segmented, Switch } from "@theatre-suite/ui";
import { copyText } from "../lib/api";
import { DEFAULT_INTRO } from "../model/defaults";
import { datesMessage, reminderMessage } from "../model/rehearsals";
import { actorMessage, convened, planMessage } from "../model/plan";
import { useAvailability } from "../sections/useAvailability";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

type Which = "dates" | "reminder" | "plan" | "actor";

/** The messages to paste in WhatsApp: the dates, and the reminder for who has not answered. Names only. */
export function CopyMessageDialog({ initial }: { initial: Which }) {
  const t = useT();
  const [which, setWhich] = useState<Which>(initial);
  const [withPlace, setWithPlace] = useState(false);
  const intro = useDoc((s) => s.data.rehearsals.intro);
  const { dates, miss } = useAvailability();
  const anyPlace = dates.some((d) => d.place);
  const r = useDoc((s) => s.data.rehearsals);
  const people = useDoc((s) => s.data.people);
  const hasPlan = r.plan.length > 0;
  const actors = useMemo(() => {
    const ids = new Set<string>();
    for (const d of r.dates) {
      const c = convened(r.plan.filter((p) => p.dateId === d.id), r);
      c.required.forEach((x) => ids.add(x));
      c.optional.forEach((x) => ids.add(x));
    }
    return people.filter((p) => ids.has(p.id));
  }, [r, people]);
  const [actorId, setActorId] = useState<string>(actors[0]?.id ?? "");

  const text = useMemo(() => {
    if (which === "dates") return datesMessage(dates, { intro, withPlace });
    if (which === "reminder") return reminderMessage(miss.people, miss.dates);
    if (which === "plan") return planMessage(r, people);
    return actorId ? actorMessage(r, people, actorId) : "";
  }, [which, dates, intro, withPlace, miss, r, people, actorId]);
  const description =
    which === "dates"
      ? t("One line for every date. Whoever answers writes yes, no or maybe next to it, and you paste the replies in Availability.")
      : which === "reminder"
        ? t("Only the names of who has not answered, with the dates they are missing.")
        : which === "plan"
          ? t("One line for every rehearsal to come: the scenes and who is convened.")
          : t("Only the rehearsals of one person, to send in a private message.");

  return (
    <Dialog
      title={t("Copy the message")}
      icon="copy"
      description={description}
      onClose={() => useUi.getState().closeDialog()}
      width={600}
    >
      <div className="cn-copyhead">
        <Segmented
          ariaLabel={t("Message")}
          value={which}
          onChange={setWhich}
          options={[
            { value: "dates", label: t("The dates"), icon: "calendar" },
            { value: "reminder", label: t("Reminder"), icon: "message" },
            ...(hasPlan
              ? [
                  { value: "plan" as Which, label: t("Rehearsal plan"), icon: "list" as const },
                  { value: "actor" as Which, label: t("For one actor"), icon: "user" as const },
                ]
              : []),
          ]}
        />
      </div>
      {which === "actor" ? (
        <div className="cn-copyopts">
          <label className="ts-field">
            <span className="ts-label">{t("Person")}</span>
            <select className="ts-select" value={actorId} onChange={(e) => setActorId(e.currentTarget.value)}>
              {actors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {which === "dates" ? (
        <div className="cn-copyopts cn-copyopts--col">
          <label className="ts-field">
            <span className="ts-label">{t("First line")}</span>
            <textarea
              className="ts-input cn-textarea"
              rows={2}
              value={intro}
              onChange={(e) => {
                const v = e.currentTarget.value;
                useDoc.getState().change((d) => ({ ...d, rehearsals: { ...d.rehearsals, intro: v } }), "intro");
              }}
            />
            {intro !== DEFAULT_INTRO ? (
              <button type="button" className="cn-linkbtn cn-linkbtn--start" onClick={() => useDoc.getState().change((d) => ({ ...d, rehearsals: { ...d.rehearsals, intro: DEFAULT_INTRO } }))}>
                {t("Use the original text")}
              </button>
            ) : null}
          </label>
          {anyPlace ? (
            <div>
              <label className="cn-switchrow">
                <Switch checked={withPlace} onChange={setWithPlace} label={t("Add the place after the time")} />
                {t("Add the place after the time")}
              </label>
              {withPlace ? <p className="ts-field__hint">{t("Words after the time can be mistaken for the reply: if the answers are not recognised, switch it off.")}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <CopyPreview
        text={text}
        copy={async (s) => {
          try {
            await copyText(s);
          } catch (e) {
            useUi.getState().showToast(String(e), "error");
          }
        }}
        labels={{ copy: t("Copy"), copied: t("Copied") }}
        emptyText={which === "dates" ? t("Add the dates first.") : which === "reminder" ? t("Everyone has answered: no reminder to send.") : t("No rehearsals to come in the plan.")}
      />
    </Dialog>
  );
}
