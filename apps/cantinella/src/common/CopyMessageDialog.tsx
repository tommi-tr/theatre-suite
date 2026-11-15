import { useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { CopyPreview, Dialog, Segmented, Switch } from "@theatre-suite/ui";
import { copyText } from "../lib/api";
import { DEFAULT_INTRO } from "../model/defaults";
import { datesMessage, reminderMessage } from "../model/rehearsals";
import { useAvailability } from "../sections/useAvailability";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

type Which = "dates" | "reminder";

/** The messages to paste in WhatsApp: the dates, and the reminder for who has not answered. Names only. */
export function CopyMessageDialog({ initial }: { initial: Which }) {
  const t = useT();
  const [which, setWhich] = useState<Which>(initial);
  const [withPlace, setWithPlace] = useState(false);
  const intro = useDoc((s) => s.data.rehearsals.intro);
  const { dates, miss } = useAvailability();
  const anyPlace = dates.some((d) => d.place);

  const text = useMemo(() => (which === "dates" ? datesMessage(dates, { intro, withPlace }) : reminderMessage(miss.people, miss.dates)), [which, dates, intro, withPlace, miss]);

  return (
    <Dialog
      title={t("Copy the message")}
      icon="copy"
      description={which === "dates" ? t("One line for every date. Whoever answers writes yes, no or maybe next to it, and you paste the replies in Availability.") : t("Only the names of who has not answered, with the dates they are missing.")}
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
          ]}
        />
      </div>
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
        emptyText={which === "dates" ? t("Add the dates first.") : t("Everyone has answered: no reminder to send.")}
      />
    </Dialog>
  );
}
