import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { FixtureSymbol } from "../../common/FixtureSymbol";
import { CHANNEL_INFO, channelColor, channelLabel, fixtureType } from "../../model/fixtureTypes";
import { intensityOf } from "../../model/desk";
import { intensityIndexes, valuesOf, visibleLight } from "../../model/universe";
import type { Fixture, FixtureValues, Group, Id } from "../../model/types";
import type { Units } from "../../store/settings";
import { lightName, symbolRotation } from "../setup/common";
import { Fader } from "./Fader";
import { InlineEdit, cardId } from "./parts";

/**
 * The fader area of the desk, as props-only components (no stores) so that Banco and Show use the very same ones:
 * - `extended`: a card per light with one fader per channel;
 * - `compact`: a narrow card per light with one fader for its intensity;
 * - `mini`: no lights, only the groups and the Grand Master (`Masters`).
 */
export type Density = "extended" | "compact" | "mini";

export type SelectMode = "one" | "add";

export interface LightCardsProps {
  fixtures: readonly Fixture[];
  values: FixtureValues;
  selection: readonly Id[];
  density: Density;
  units: Units;
  onSelect: (id: Id, mode: SelectMode) => void;
  onChannel: (id: Id, index: number, value: number) => void;
  onIntensity: (id: Id, level: number) => void;
  /** Every fader still (Show: Lock, emergency). */
  disabled?: boolean;
}

/** What the single fader of the compact density moves: the intensity, or the first channel of a light that has none (smoke). */
export const compactTarget = (f: Pick<Fixture, "channels">): "intensity" | "first" => (intensityIndexes(f).length ? "intensity" : "first");

export function LightCards({ fixtures, values, selection, density, units, onSelect, onChannel, onIntensity, disabled = false }: LightCardsProps) {
  const t = useT();
  if (density === "mini") return null;
  const sel = new Set(selection);
  return (
    <div className={`gv-lcards gv-lcards--${density}`} role="group" aria-label={t("Lights")}>
      {fixtures.map((f) => {
        const row = valuesOf(f, values);
        const type = fixtureType(f.typeId);
        const vis = visibleLight(f, row);
        const lens = vis.hue && vis.level > 0 ? vis.color : null;
        const off = f.unused;
        const still = off || disabled;
        const name = lightName(t, f);
        return (
          <section
            key={f.id}
            id={cardId(f.id)}
            className="gv-lcard"
            data-selected={sel.has(f.id) ? "" : undefined}
            data-unused={off ? "" : undefined}
            aria-label={`${f.number} ${name}`}
          >
            <button
              type="button"
              className="gv-lcard__head"
              title={[name, off ? t("not used in this production") : f.address === null ? t("no address") : null].filter(Boolean).join(" · ")}
              onClick={(e) => onSelect(f.id, e.shiftKey || e.ctrlKey || e.metaKey ? "add" : "one")}
            >
              <FixtureSymbol kind={type.symbol} state={off ? "unused" : "normal"} rotate={symbolRotation(f)} size={density === "compact" ? 18 : 22} lens={lens} />
              <span className="gv-lcard__num">{f.number}</span>
              {density === "extended" ? <span className="gv-lcard__name ts-ellipsis">{name}</span> : null}
            </button>
            {density === "extended" ? (
              <div className="gv-lcard__note">{off ? t("not used") : f.address === null ? t("no address") : " "}</div>
            ) : null}
            <div className="gv-lcard__faders">
              {density === "extended"
                ? f.channels.map((ch, i) => {
                    const lab = channelLabel(ch);
                    const text = lab.custom ? lab.text : t(lab.text);
                    const info = CHANNEL_INFO[ch.function];
                    return (
                      <Fader
                        key={i}
                        value={row[i]}
                        onChange={(v) => onChannel(f.id, i, v)}
                        label={`${f.number} · ${text}`}
                        shortLabel={text}
                        color={channelColor(ch.function, f.typeId)}
                        swatch={info.kind === "color" || ch.function === "dimmer"}
                        sub={f.address === null ? "–" : String(f.address + i)}
                        units={units}
                        disabled={still}
                      />
                    );
                  })
                : (() => {
                    const first = compactTarget(f) === "first";
                    const level = first ? (row[0] ?? 0) : intensityOf(f, row);
                    return (
                      <Fader
                        value={level}
                        onChange={(v) => (first ? onChannel(f.id, 0, v) : onIntensity(f.id, v))}
                        label={`${f.number} · ${name}`}
                        shortLabel={String(f.number)}
                        color={vis.hue ?? "var(--text-2)"}
                        units={units}
                        disabled={still}
                        narrow
                      />
                    );
                  })()}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export interface MastersProps {
  groups: readonly Group[];
  grandMaster: number;
  density: Density;
  units: Units;
  /** Groups and Grand Master cannot be moved (Blind: the stage does not change). */
  disabled?: boolean;
  onGroupLevel: (id: Id, level: number) => void;
  onGrandMaster: (level: number) => void;
  /** Click on a group name: selects its lights. */
  onSelectGroup?: (id: Id) => void;
  /** Banco only: make a group from the selected lights, rename, delete. */
  onCreate?: () => void;
  canCreate?: boolean;
  onRename?: (id: Id, name: string) => void;
  onDelete?: (id: Id) => void;
}

/** The group faders and the Grand Master. */
export function Masters({ groups, grandMaster, density, units, disabled, onGroupLevel, onGrandMaster, onSelectGroup, onCreate, canCreate, onRename, onDelete }: MastersProps) {
  const t = useT();
  const [renaming, setRenaming] = useState<Id | null>(null);
  const narrow = density !== "extended";
  return (
    <div className={`gv-masters gv-masters--${density}`}>
      <div className="gv-masters__groups" role="group" aria-label={t("Groups")}>
        {groups.map((g) => (
          <div key={g.id} className="gv-group">
            <Fader
              value={g.level}
              onChange={(v) => onGroupLevel(g.id, v)}
              label={t("Group {name}", { name: g.name })}
              shortLabel={g.name}
              color="var(--text-2)"
              units={units}
              disabled={disabled}
              narrow={narrow}
              resetTo={255}
            />
            <div className="gv-group__tools">
              {renaming === g.id ? (
                <InlineEdit
                  value={g.name}
                  label={t("Group name")}
                  onCommit={(v) => {
                    setRenaming(null);
                    if (v.trim()) onRename?.(g.id, v);
                  }}
                  onCancel={() => setRenaming(null)}
                  width={64}
                />
              ) : (
                <>
                  {onSelectGroup ? (
                    <button type="button" className="gv-group__sel" title={t("Select the lights of this group")} aria-label={t("Select the lights of this group")} onClick={() => onSelectGroup(g.id)}>
                      <Icon name="check" size={12} />
                    </button>
                  ) : null}
                  {onRename ? (
                    <button type="button" className="gv-group__sel" title={t("Rename")} aria-label={t("Rename")} onClick={() => setRenaming(g.id)}>
                      <Icon name="pencil" size={12} />
                    </button>
                  ) : null}
                  {onDelete ? (
                    <button type="button" className="gv-group__sel" title={t("Delete the group")} aria-label={t("Delete the group")} onClick={() => onDelete(g.id)}>
                      <Icon name="trash" size={12} />
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ))}
        {onCreate ? (
          <div className="gv-group gv-group--new">
            <Button variant="ghost" iconOnly icon="plus" disabled={!canCreate} aria-label={t("Make a group from the selected lights")} title={canCreate ? t("Make a group from the selected lights") : t("Select some lights first")} onClick={onCreate} />
          </div>
        ) : null}
        {!groups.length && !onCreate ? <p className="gv-empty">{t("No groups.")}</p> : null}
      </div>
      <div className="gv-masters__gm">
        <Fader
          value={grandMaster}
          onChange={onGrandMaster}
          label={t("Grand Master")}
          shortLabel={t("Grand Master")}
          color="var(--accent)"
          units={units}
          disabled={disabled}
          narrow={narrow}
          resetTo={255}
        />
      </div>
    </div>
  );
}
