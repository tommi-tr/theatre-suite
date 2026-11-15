import type { TFunc } from "@theatre-suite/core";
import { formatCents, type StepTone } from "@theatre-suite/ui";
import type { Budget, Cost, CostKind, CostState, PriceRule } from "../model/budget";
import { useDoc } from "../store/doc";

export const changeB = (fn: (b: Budget) => Budget, key?: string) => useDoc.getState().change((d) => ({ ...d, budget: fn(d.budget) }), key);

/** "1.234,56 €" */
export const euro = (c: number, decimals = true) => `${formatCents(c, { decimals })} €`;
/** 1000 → "10%", 1250 → "12,5%" */
export const pct = (h: number) => `${(h / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;

export const CATEGORY_LABELS: Record<string, string> = {
  siae: "SIAE",
  rights: "Author's rights",
  actors: "Actors",
  crew: "Crew and technicians",
  direction: "Direction",
  rent: "Theatre rent",
  service: "Sound and light service",
  set: "Sets",
  costumes: "Costumes",
  promo: "Advertising and press",
  transport: "Transport",
  lodging: "Lodging",
  insurance: "Insurance",
  contributions: "Permits and contributions",
  contingency: "Contingency",
  tour: "Tour",
};
export const categoryLabel = (t: TFunc, k: string) => (k in CATEGORY_LABELS ? t(CATEGORY_LABELS[k]) : k);

export const KIND_LABELS: Record<CostKind, string> = {
  fixed: "Fixed",
  perShow: "Per performance",
  perSeat: "Per spectator",
  percent: "On the takings",
  mixed: "Mixed",
};

export const STATE_LABELS: Record<CostState, string> = { estimate: "Estimate", quote: "Quote", confirmed: "Confirmed", paid: "Paid" };
export const STATE_TONES: StepTone[] = ["draft", "neutral", "info", "ok"];
export const STATE_PILL: Record<CostState, string> = { estimate: "draft", quote: "neutral", confirmed: "info", paid: "ok" };

/** The rule of a cost in words: "the larger of 150 € and 10%", "only Platea"… */
export function ruleText(t: TFunc, c: Cost, b: Budget): string {
  const amount = euro(c.entered === "gross" ? c.amount : Math.round((c.amount * (100 + c.vat)) / 100));
  switch (c.kind) {
    case "fixed":
      return t("once");
    case "perShow":
      return t("{a} for every performance", { a: amount });
    case "perSeat": {
      const names = b.sectors.filter((s) => c.sectors.includes(s.id)).map((s) => s.name);
      return names.length ? t("{a} per spectator, only {list}", { a: amount, list: names.join(", ") }) : t("{a} per spectator", { a: amount });
    }
    case "percent":
      return t("{p} of the takings", { p: pct(c.percent) });
    case "mixed":
      return c.mix === "max" ? t("the larger of {a} and {p} of the takings", { a: amount, p: pct(c.percent) }) : t("{a} plus {p} of the takings", { a: amount, p: pct(c.percent) });
  }
}

export function ruleLabel(t: TFunc, r: PriceRule): string {
  switch (r.mode) {
    case "percent":
      return `−${pct(r.value)}`;
    case "minus":
      return `−${euro(r.value)}`;
    case "fixed":
      return t("fixed price");
    default:
      return t("base price");
  }
}
