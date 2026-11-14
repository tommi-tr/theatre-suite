import { useT } from "@theatre-suite/core";
import { Button, Icon, type IconName } from "@theatre-suite/ui";
import type { SectionId } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import type { PartId } from "./sections";

interface Card {
  section: SectionId;
  part: PartId;
  icon: IconName;
  title: string;
  text: string;
  invite: string;
  /** Version that brings the first part the card opens; null = available now. */
  arrives: string | null;
}

const CARDS: Card[] = [
  {
    section: "rehearsals",
    part: "dates",
    icon: "users",
    title: "Rehearsals",
    text: "Dates, who can come, scenes and a rehearsal plan to send to the company.",
    invite: "Add the dates",
    arrives: "0.2",
  },
  {
    section: "budget",
    part: "costs",
    icon: "euro",
    title: "Budget",
    text: "Costs and quotes, the theatre and its seats, how many tickets to break even.",
    invite: "Start from the costs",
    arrives: "0.4",
  },
  {
    section: "departments",
    part: "people",
    icon: "trafficLight",
    title: "Departments and contacts",
    text: "The company's contacts, then every department with its light and the things to do.",
    invite: "Add the company",
    arrives: null,
  },
  {
    section: "tour",
    part: "venues",
    icon: "truck",
    title: "Tour",
    text: "Venues and fees, technical sheet, travel, gear to load.",
    invite: "Add a venue",
    arrives: "0.8",
  },
];

/** "Where do you want to start?": shown for an empty file, full width under the section bar. */
export function StartScreen() {
  const t = useT();
  const show = useDoc((s) => s.show);
  return (
    <div className="cn-start">
      <div className="cn-start__inner">
        <header className="cn-start__head">
          <h1>{t("Where do you want to start?")}</h1>
          <p>
            {show
              ? t("The production of {show}: five independent sections, start from the one you need today.", { show: show.title })
              : t("Five independent sections: start from the one you need today. The others wait, empty, until you need them.")}
          </p>
        </header>
        <div className="cn-start__cards">
          {CARDS.map((c) => (
            <button key={c.section} type="button" className="cn-startcard" onClick={() => useUi.getState().go(c.section, c.part)}>
              <span className="cn-startcard__top">
                <span className="cn-startcard__icon">
                  <Icon name={c.icon} size={20} />
                </span>
                {c.arrives ? <span className="cn-soon">{t("Coming in {v}", { v: c.arrives })}</span> : null}
              </span>
              <span className="cn-startcard__title">{t(c.title)}</span>
              <span className="cn-startcard__text">{t(c.text)}</span>
              <span className="cn-startcard__invite">
                {t(c.invite)}
                <Icon name="chevRight" size={14} />
              </span>
            </button>
          ))}
        </div>
        <div className="cn-start__have">
          <div className="ts-label">{t("Already have something?")}</div>
          <div className="cn-start__haverow">
            <div className="cn-haveitem cn-haveitem--off">
              <Icon name="book" size={18} />
              <div>
                <div className="cn-haveitem__title">{t("Read scenes and characters from Bardo")}</div>
                <div className="cn-haveitem__text">{t("The script is only read, never changed.")}</div>
              </div>
              <span className="cn-soon">{t("Coming in {v}", { v: "0.3" })}</span>
            </div>
            <div className="cn-haveitem">
              <Icon name="addressBook" size={18} />
              <div>
                <div className="cn-haveitem__title">{t("Import the contacts (vCard, CSV)")}</div>
                <div className="cn-haveitem__text">{t("From your phone, Google Contacts, Outlook or a spreadsheet.")}</div>
              </div>
              <Button variant="sm" icon="upload" onClick={() => useUi.getState().openDialog("import")}>
                {t("Import…")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
