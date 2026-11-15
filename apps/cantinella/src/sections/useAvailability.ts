import { useMemo } from "react";
import { currentAnswers, missing, sortDates, tablePeople, todayKey } from "../model/rehearsals";
import { useDoc } from "../store/doc";

/** What the availability table, its buttons and the status bar all need, computed once per change. */
export function useAvailability() {
  const rehearsals = useDoc((s) => s.data.rehearsals);
  const people = useDoc((s) => s.data.people);
  const today = todayKey();
  return useMemo(() => {
    const dates = sortDates(rehearsals.dates);
    const table = tablePeople(people, rehearsals.answers);
    const map = currentAnswers(rehearsals.answers);
    const miss = missing(table, dates, rehearsals.answers, today);
    return { dates, table, map, miss, today, answers: rehearsals.answers };
  }, [rehearsals, people, today]);
}
