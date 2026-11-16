import { useMemo } from "react";
import { useT } from "@theatre-suite/core";
import { useDesk } from "../../store/desk";
import { useDoc } from "../../store/doc";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { setGroupLevel } from "../../model/desk";
import { Masters, LightCards, type Density, type SelectMode } from "./Faders";
import { createGroupFromSelection, deleteGroupAsk, renameGroupTo } from "./actions";
import { scrollCardIntoView } from "./parts";

/** Selects a light of the desk (click: only it; Shift/Ctrl: add or remove). Shared by the cards and the stage. */
export function selectLight(id: string, mode: SelectMode) {
  const ui = useUi.getState();
  if (mode === "add") ui.setSelection(ui.selection.includes(id) ? ui.selection.filter((x) => x !== id) : [...ui.selection, id]);
  else ui.selectFixture(id);
}

/**
 * The faders of the live desk (the cards of the lights and, on the right, groups and Grand Master) connected to
 * `useDesk` / the document. `density`: `extended` (every channel), `compact` (one intensity per light), `mini`
 * (groups + Grand Master only). Banco uses `extended`; Show will use the three. `editable` adds the group tools.
 */
export function DeskFaders({ density, editable = false }: { density: Density; editable?: boolean }) {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const units = useSettings((s) => s.settings.units);
  const selection = useUi((s) => s.selection);
  const values = useDesk((s) => (s.blind ? s.blind.values : s.values));
  const gm = useDesk((s) => s.grandMaster);
  const blind = useDesk((s) => !!s.blind);
  const fixtures = useMemo(() => doc.fixtures, [doc.fixtures]);
  return (
    <div className={`gv-faders gv-faders--${density}`}>
      {density !== "mini" ? (
        <div className="gv-faders__cards">
          {fixtures.length === 0 ? <p className="gv-empty">{t("There are no lights yet: add them in Setup.")}</p> : null}
          <LightCards
            fixtures={fixtures}
            values={values}
            selection={selection}
            density={density}
            units={units}
            onSelect={selectLight}
            onChannel={(id, i, v) => useDesk.getState().setChannel(id, i, v)}
            onIntensity={(id, v) => useDesk.getState().setIntensity(id, v)}
          />
        </div>
      ) : null}
      <Masters
        groups={doc.groups}
        grandMaster={gm}
        density={density}
        units={units}
        disabled={blind}
        onGroupLevel={(id, v) => useDoc.getState().change((d) => setGroupLevel(d, id, v), `group:${id}`)}
        onGrandMaster={(v) => useDesk.getState().setGrandMaster(v)}
        onSelectGroup={(id) => {
          const g = doc.groups.find((x) => x.id === id);
          if (!g?.fixtureIds.length) return;
          useUi.getState().setSelection(g.fixtureIds);
          scrollCardIntoView(g.fixtureIds[0]);
        }}
        onCreate={editable ? () => createGroupFromSelection(t) : undefined}
        canCreate={selection.length > 0}
        onRename={editable ? renameGroupTo : undefined}
        onDelete={editable ? (id) => void deleteGroupAsk(t, id) : undefined}
      />
    </div>
  );
}
