import type { ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import { useUi, type PanelKey } from "../store/ui";

/** The tool bar with a small button that folds it away (it comes back with one click). */
export function RibbonShell({ children }: { children: ReactNode }) {
  const t = useT();
  const hidden = useUi((s) => s.hidden.ribbon);
  const setHidden = useUi((s) => s.setHidden);
  return (
    <div className={`bd-ribbon-shell${hidden ? " is-folded" : ""}`}>
      {hidden ? null : children}
      <button type="button" className="bd-fold bd-fold--ribbon" title={hidden ? t("Show the bar") : t("Hide the bar")} aria-label={hidden ? t("Show the bar") : t("Hide the bar")} onClick={() => setHidden("ribbon", !hidden)}>
        <Icon name={hidden ? "chevDown" : "chevUp"} size={13} strokeWidth={2.2} />
        {hidden ? <span>{t("Show the bar")}</span> : null}
      </button>
    </div>
  );
}

/** Narrow strip that stands in for a folded side panel. */
export function FoldRail({ panel, side, label }: { panel: PanelKey; side: "left" | "right"; label: string }) {
  const t = useT();
  const setHidden = useUi((s) => s.setHidden);
  return (
    <div className={`bd-rail bd-rail--${side}`}>
      <button type="button" className="bd-fold" title={t("Show the panel")} aria-label={`${t("Show the panel")}: ${label}`} onClick={() => setHidden(panel, false)}>
        <Icon name={side === "left" ? "chevRight" : "chevLeft"} size={14} strokeWidth={2.2} />
      </button>
      <span className="bd-rail__label">{label}</span>
    </div>
  );
}

/** Small button in the head of a panel that folds it. */
export function FoldButton({ panel, side }: { panel: PanelKey; side: "left" | "right" }) {
  const t = useT();
  const setHidden = useUi((s) => s.setHidden);
  return (
    <button type="button" className="bd-fold" title={t("Hide the panel")} aria-label={t("Hide the panel")} onClick={() => setHidden(panel, true)}>
      <Icon name={side === "left" ? "chevLeft" : "chevRight"} size={14} strokeWidth={2.2} />
    </button>
  );
}
