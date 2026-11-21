import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { applyReplace, cancelReplace, useReplacePlan, type ReplacePlan, type ReplaceRow } from "../lib/script";

const snippet = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * "Sostituisci copione": before anything changes, one row per anchor (note, GO) with where it was and where it
 * is found in the new script. Sure ones are ticked; uncertain ones are amber and unticked until the user ticks
 * them (or picks another place); anchors not found stay where they were (page and height).
 */
export function ReplaceScriptDialog() {
  const plan = useReplacePlan((s) => s.plan);
  return plan ? <ReplaceDialog key={plan.picked.staged} plan={plan} /> : null;
}

function ReplaceDialog({ plan }: { plan: ReplacePlan }) {
  const t = useT();
  const [rows, setRows] = useState<ReplaceRow[]>(plan.rows);
  const [busy, setBusy] = useState(false);
  const sure = rows.filter((r) => r.relocation.status === "sure").length;
  const checked = rows.filter((r) => r.checked).length;
  const update = (i: number, patch: Partial<ReplaceRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const apply = async (onlySure: boolean) => {
    setBusy(true);
    const final = onlySure ? rows.map((r) => ({ ...r, checked: r.relocation.status === "sure" })) : rows;
    await applyReplace(t, { ...plan, rows: final });
  };
  const changedByUser = rows.some((r, i) => r.checked !== plan.rows[i].checked || r.choice !== 0);
  return (
    <Dialog
      title={t("Replace the script")}
      icon="pages"
      width={720}
      closeLabel={t("Close")}
      onClose={() => cancelReplace(plan)}
      description={t("{name} · {n} pages (before: {old}). Notes and GOs are looked for in the new script by their text: check them before applying.", {
        name: plan.picked.fileName,
        n: plan.picked.doc.numPages,
        old: plan.oldPages,
      })}
      footer={
        <>
          <span className="ts-muted cue-replace__sum">{t("{sure} sure · {other} to check", { sure, other: rows.length - sure })}</span>
          <span className="ts-spacer" />
          <Button onClick={() => cancelReplace(plan)} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" icon="check" onClick={() => void apply(!changedByUser)} disabled={busy}>
            {changedByUser ? t("Apply {n} anchors", { n: checked }) : t("Apply {n} sure anchors", { n: sure })}
          </Button>
        </>
      }
    >
      <div className="cue-replace">
        {rows.map((r, i) => {
          const cand = r.relocation.candidates[r.choice];
          const state = r.relocation.status;
          return (
            <label key={`${r.owner.kind}:${r.owner.id}`} className="cue-replace__row" data-state={state} data-checked={r.checked ? "" : undefined}>
              <input type="checkbox" checked={r.checked} disabled={!cand} onChange={(e) => update(i, { checked: e.target.checked })} />
              <span className="cue-replace__what">
                <span className="cue-replace__kind">{r.owner.kind === "note" ? t("Note") : r.owner.kind === "go" ? r.label : t("Speed zone")}</span>
                {r.owner.kind === "note" ? <span className="cue-replace__label">{snippet(r.label || t("Empty note"), 60)}</span> : null}
                <span className="cue-replace__quote">“{snippet(r.old.quote || t("(no text at this point)"))}”</span>
              </span>
              <span className="cue-replace__where">
                <span className="mono">{t("p. {n}", { n: r.old.page })}</span>
                <span className="cue-replace__arrow">→</span>
                {cand ? (
                  r.relocation.candidates.length > 1 && state !== "sure" ? (
                    <select className="ts-select cue-replace__pick" value={r.choice} onChange={(e) => update(i, { choice: Number(e.target.value), checked: true })} onClick={(e) => e.stopPropagation()}>
                      {r.relocation.candidates.map((c, k) => (
                        <option key={k} value={k}>
                          {t("p. {n}", { n: c.anchor.page })} · {Math.round(c.score * 100)}%
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="mono">{t("p. {n}", { n: cand.anchor.page })}</span>
                  )
                ) : (
                  <span className="mono">{t("p. {n}", { n: Math.min(r.old.page, plan.picked.doc.numPages) })}</span>
                )}
              </span>
              <span className="cue-replace__state">
                <span className={`ts-dot ${state === "sure" ? "ts-dot--go" : "ts-dot--sb"}`} />
                {state === "sure" ? t("Found") : state === "unsure" ? t("Uncertain: check") : t("Not found: stays where it was")}
              </span>
            </label>
          );
        })}
      </div>
      <p className="ts-muted cue-replace__note">{t("Unticked anchors keep their page and height. The new PDF is saved in the show file at the next save.")}</p>
    </Dialog>
  );
}
