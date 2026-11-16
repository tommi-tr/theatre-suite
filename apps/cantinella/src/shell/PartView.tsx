import { useT } from "@theatre-suite/core";
import { Kbd } from "@theatre-suite/ui";
import type { SectionId } from "../model/types";
import { useUi } from "../store/ui";
import { ComingSoon } from "../sections/ComingSoon";
import { People, PeopleActions, PeopleStatus } from "../sections/People";
import { Dates, DatesActions, DatesStatus } from "../sections/Dates";
import { Availability, AvailabilityActions, AvailabilityStatus } from "../sections/Availability";
import { Scenes, ScenesActions, ScenesStatus } from "../sections/Scenes";
import { Plan, PlanActions, PlanStatus } from "../sections/Plan";
import { Costs, CostsActions, CostsStatus } from "../sections/Costs";
import { Seats, SeatsActions, SeatsStatus } from "../sections/Seats";
import { BreakEven, BreakEvenActions, BreakEvenStatus } from "../sections/BreakEven";
import { DepartmentsPart, DepartmentsActions, DepartmentsStatus } from "../sections/Departments";
import { Reports, ReportsActions, ReportsStatus } from "../sections/Reports";
import { Venues, VenuesActions, VenuesStatus } from "../sections/Venues";
import { GearPart, TechSheetActions, TechSheetPart, TourStatus, TourSummaryPart, TravelPart } from "../sections/TourParts";
import { addVenue } from "../sections/tourCommon";
import { CalendarActions, CalendarStatus, ListView, MonthView, WeekView } from "../sections/Calendar";
import { Button } from "@theatre-suite/ui";
import { partDef } from "./sections";

/** The open part of a section. */
export function PartView({ section }: { section: SectionId }) {
  const partId = useUi((s) => s.parts[section]);
  const part = partDef(section, partId);
  if (part.id === "people") return <People />;
  if (part.id === "dates") return <Dates />;
  if (part.id === "availability") return <Availability />;
  if (part.id === "scenes") return <Scenes />;
  if (part.id === "plan") return <Plan />;
  if (part.id === "costs") return <Costs />;
  if (part.id === "seats") return <Seats />;
  if (part.id === "breakeven") return <BreakEven />;
  if (part.id === "departments") return <DepartmentsPart />;
  if (part.id === "reports") return <Reports />;
  if (part.id === "venues") return <Venues />;
  if (part.id === "techSheet") return <TechSheetPart />;
  if (part.id === "travel") return <TravelPart />;
  if (part.id === "gear") return <GearPart />;
  if (part.id === "summary") return <TourSummaryPart />;
  if (part.id === "month") return <MonthView />;
  if (part.id === "week") return <WeekView />;
  if (part.id === "list") return <ListView />;
  return <ComingSoon section={section} part={part} />;
}

/** Actions of the open part, on the right of the section bar. */
export function PartActions({ section }: { section: SectionId }) {
  const partId = useUi((s) => s.parts[section]);
  const id = partDef(section, partId).id;
  if (id === "people") return <PeopleActions />;
  if (id === "dates") return <DatesActions />;
  if (id === "availability") return <AvailabilityActions />;
  if (id === "scenes") return <ScenesActions />;
  if (id === "plan") return <PlanActions />;
  if (id === "costs") return <CostsActions />;
  if (id === "seats") return <SeatsActions />;
  if (id === "breakeven") return <BreakEvenActions />;
  if (id === "departments") return <DepartmentsActions />;
  if (id === "reports") return <ReportsActions />;
  if (id === "venues") return <VenuesActions />;
  if (id === "techSheet") return <TechSheetActions />;
  if (id === "travel" || id === "gear" || id === "summary") return <AddVenueButton />;
  if (section === "calendar") return <CalendarActions />;
  return null;
}

/** Summary of the open part and its main shortcut, in the status bar. */
export function PartStatus() {
  const t = useT();
  const section = useUi((s) => s.section);
  const partId = useUi((s) => (s.section ? s.parts[s.section] : null));
  if (!section || !partId) {
    return (
      <>
        <span>{t("New file: choose where to start")}</span>
        <span className="ts-spacer" />
        <span>
          <Kbd>Ctrl O</Kbd> {t("open a file")}
        </span>
      </>
    );
  }
  const part = partDef(section, partId);
  if (part.id === "people") return <PeopleStatus />;
  if (part.id === "dates") return <DatesStatus />;
  if (part.id === "availability") return <AvailabilityStatus />;
  if (part.id === "scenes") return <ScenesStatus />;
  if (part.id === "plan") return <PlanStatus />;
  if (part.id === "costs") return <CostsStatus />;
  if (part.id === "seats") return <SeatsStatus />;
  if (part.id === "breakeven") return <BreakEvenStatus />;
  if (part.id === "departments") return <DepartmentsStatus />;
  if (part.id === "reports") return <ReportsStatus />;
  if (part.id === "venues") return <VenuesStatus />;
  if (section === "tour") return <TourStatus />;
  if (section === "calendar") return <CalendarStatus />;
  return (
    <>
      <span>{t("{part}: coming in Cantinella {v}", { part: t(part.label), v: part.arrives ?? "" })}</span>
      <span className="ts-spacer" />
      <span>
        <Kbd>Ctrl 1–5</Kbd> {t("sections")}
      </span>
    </>
  );
}

function AddVenueButton() {
  const t = useT();
  return (
    <Button variant="ghost" icon="plus" onClick={() => addVenue(t)}>
      {t("Add a venue")}
    </Button>
  );
}
