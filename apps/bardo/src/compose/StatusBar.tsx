import { useT } from "@theatre-suite/core";
import { Icon, StatusBar } from "@theatre-suite/ui";
import { pageOfPos } from "../editor/paginate";
import { getIndex } from "../editor/plugins";
import { formatMinutes } from "../model/derive";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Where the cursor is (page, act, scene, speech) and the view options. */
export function ComposeStatus() {
  const t = useT();
  const state = useDoc((s) => s.state);
  const pages = useDoc((s) => s.pages);
  const settings = useSettings((s) => s.settings);
  const focus = useUi((s) => s.focusMode);
  if (!state) return <StatusBar>{null}</StatusBar>;
  const index = getIndex(state);
  const pos = state.selection.from;
  const block = state.selection.$from.index(0);
  const page = pageOfPos(pages, index, pos);
  const sceneIdx = index.blockScene[block] ?? -1;
  const actIdx = index.blockAct[block] ?? -1;
  const scene = sceneIdx >= 0 ? index.scenes[sceneIdx] : null;
  const scenesInAct = actIdx >= 0 ? index.acts[actIdx].scenes.length : index.scenes.length;
  const sceneInAct = scene ? (actIdx >= 0 ? index.acts[actIdx].scenes.indexOf(sceneIdx) + 1 : sceneIdx + 1) : 0;
  let speech = 0;
  for (const [p, n] of index.speechNumber) {
    if (p <= pos) speech = n;
    else break;
  }
  const tabIdx = index.tableaux.filter((x) => x.idx <= block).length;
  const z = settings.zoom;
  const setZoom = (d: number) => {
    const i = ZOOMS.findIndex((v) => Math.abs(v - z) < 0.001);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + d))];
    useSettings.getState().update({ zoom: next });
  };
  return (
    <StatusBar>
      <div className="bd-status" style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
        {page !== null && pages ? (
          <span>
            {t("Page")} <b>{`${page}/${pages.pages.length}`}</b>
          </span>
        ) : null}
        {index.acts.length ? (
          <span>
            {t("Act")} <b>{`${actIdx + 1 || "–"}/${index.acts.length}`}</b>
          </span>
        ) : null}
        {index.tableaux.length ? (
          <span>
            {t("Tableau")} <b>{`${tabIdx || "–"}/${index.tableaux.length}`}</b>
          </span>
        ) : null}
        {index.scenes.length ? (
          <span>
            {t("Scene")} <b>{`${sceneInAct || "–"}/${scenesInAct}`}</b>
          </span>
        ) : null}
        <span className="bd-status__sep" />
        {speech ? (
          <span>
            {t("Speech")} <b>{speech}</b>
          </span>
        ) : null}
        <button type="button" className="bd-status-btn" title={t("Statistics")} onClick={() => useUi.getState().openDialog("stats")}>
          <b>{index.totals.words.toLocaleString(settings.language)}</b> {t("words")} · {t("about {d}", { d: formatMinutes(index.totals.minutes) })}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="bd-status-btn" aria-pressed={settings.showMarks} title={t("Show the marks of categories and notes (they are not printed)")} onClick={() => useSettings.getState().update({ showMarks: !settings.showMarks })}>
          <Icon name="marks" size={13} />
          {t("Signs")}
        </button>
        <div role="group" aria-label={t("View")} style={{ display: "flex", gap: 1 }}>
          <button type="button" className="bd-status-btn" aria-pressed={!settings.continuous} onClick={() => useSettings.getState().update({ continuous: false })}>
            <Icon name="pages" size={13} />
            {t("Pages")}
          </button>
          <button type="button" className="bd-status-btn" aria-pressed={settings.continuous} onClick={() => useSettings.getState().update({ continuous: true })}>
            <Icon name="scroll" size={13} />
            {t("Continuous")}
          </button>
        </div>
        <button type="button" className="bd-status-btn" aria-pressed={focus} title="F11" onClick={() => useUi.getState().toggleFocus()}>
          <Icon name="focus" size={13} />
          {t("Focus")}
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <button type="button" className="bd-status-btn" aria-label={t("Zoom out")} onClick={() => setZoom(-1)}>
            <Icon name="minus" size={12} />
          </button>
          <button type="button" className="bd-status-btn mono" style={{ width: 46, justifyContent: "center" }} title={t("Back to 100%")} onClick={() => useSettings.getState().update({ zoom: 1 })}>
            {Math.round(z * 100)}%
          </button>
          <button type="button" className="bd-status-btn" aria-label={t("Zoom in")} onClick={() => setZoom(1)}>
            <Icon name="plus" size={12} />
          </button>
        </span>
      </div>
    </StatusBar>
  );
}
