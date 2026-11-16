import { useLang, useT } from "@theatre-suite/core";
import { ComingSoon } from "../common/ComingSoon";
import { litCount } from "../model/memories";
import { useDoc } from "../store/doc";
import { transitionParts } from "./transitionText";

/** Banco, phase 0: what the desk will do, and the memories of the show (read only). */
export function DeskMode() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const memories = [...doc.memories].sort((a, b) => a.number - b.number);
  return (
    <div className="gv-split">
      <main className="gv-split__main">
        <ComingSoon
          icon="bench"
          version="0.4"
          title={t("The virtual desk")}
          about={[
            t("A card for every light with its faders in the colours of the light; the mouse wheel moves a fader, a click lets you type the value."),
            t("A colour picker for coloured lights, the group faders and the Grand Master."),
            t("Save the stage as a memory, see when it has been changed and not saved, restore it; Blind to change a memory without touching the stage."),
          ]}
        >
          {t("Meanwhile the memories of the show are listed here, as they are saved in the file.")}
        </ComingSoon>
      </main>
      <aside className="gv-side" aria-label={t("Memories")}>
        <div className="gv-panel__head">
          <span className="gv-panel__title">{t("Memories")}</span>
          <span className="gv-count">{memories.length}</span>
        </div>
        {memories.length === 0 ? (
          <p className="gv-empty">{t("No memories yet.")}</p>
        ) : (
          <ul className="gv-memlist">
            {memories.map((m) => (
              <li key={m.id} className="gv-mem">
                <span className="gv-mem__num">{m.number}</span>
                <span className="gv-mem__text">
                  <span className="gv-mem__name ts-ellipsis">{m.label || t("Memory {n}", { n: m.number })}</span>
                  <span className="gv-mem__meta ts-ellipsis">
                    {[(litCount(doc, m.state) === 1 ? t("1 light on") : t("{n} lights on", { n: litCount(doc, m.state) })), transitionParts(t, lang, m.transition).main].join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
