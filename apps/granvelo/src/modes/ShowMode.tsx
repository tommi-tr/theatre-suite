import { useLang, useT } from "@theatre-suite/core";
import { Kbd } from "@theatre-suite/ui";
import { ComingSoon } from "../common/ComingSoon";
import { memoriesInOrder } from "../model/memories";
import { useDoc } from "../store/doc";
import { transitionParts } from "./transitionText";

/** Show, phase 0: what the Show mode will do, and the sequence of the evening (read only). */
export function ShowMode() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const inSeq = memoriesInOrder(doc).filter((m) => doc.sequence.includes(m.id));
  return (
    <div className="gv-split">
      <main className="gv-split__main">
        <ComingSoon
          icon="curtain"
          version="0.5"
          title={t("The show, memory after memory")}
          about={[
            t("The memory on stage in a green box, the next one ready in amber: GO with the space bar, Back and Pause of the transition."),
            t("Separate times to go up and down, delay, moving heads that move in the dark, memories that start by themselves."),
            t("Blackout, Fade to black and Emergency always in the same place at the bottom, and Lock against accidental changes."),
          ]}
        >
          <span className="gv-keys">
            <Kbd>{t("Space")}</Kbd> GO · <Kbd>Backspace</Kbd> {t("Back")} · <Kbd>P</Kbd> Pause
          </span>
        </ComingSoon>
      </main>
      <aside className="gv-side" aria-label={t("Sequence")}>
        <div className="gv-panel__head">
          <span className="gv-panel__title">{t("Sequence")}</span>
          <span className="gv-count">{inSeq.length}</span>
        </div>
        {inSeq.length === 0 ? (
          <p className="gv-empty">{t("No memories in the sequence yet.")}</p>
        ) : (
          <ol className="gv-memlist">
            {inSeq.map((m) => {
              const tr = transitionParts(t, lang, m.transition);
              return (
                <li key={m.id} className="gv-mem">
                  <span className="gv-mem__num">{m.number}</span>
                  <span className="gv-mem__text">
                    <span className="gv-mem__name ts-ellipsis">{m.label || t("Memory {n}", { n: m.number })}</span>
                    <span className="gv-mem__meta ts-ellipsis" title={[tr.main, ...tr.extra].join(" · ")}>
                      {[tr.main, ...tr.extra].join(" · ")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </aside>
    </div>
  );
}
