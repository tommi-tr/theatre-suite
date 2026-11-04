import { useEffect, useState } from "react";
import { basename, uid, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, NumberField, Range, Segmented, Switch, type IconName } from "@theatre-suite/ui";
import { pickAudioFiles } from "../lib/files";
import { comboLabel, comboProblem, isPadPlaying, padDown, padPath, padUp, suggestions, usePads } from "../lib/launchpad";
import { BUILTIN_SOUNDS, defaultPads, useSettings, type Pad, type PadMode } from "../state/settings";

const MODE_ICON: Record<PadMode, IconName> = { hold: "hand", toEnd: "toEnd", toggle: "toggle" };

export function padName(t: (k: string) => string, p: Pad): string {
  if (p.name) return p.name;
  const b = BUILTIN_SOUNDS.find((x) => x.file === p.builtin);
  return b ? t(b.name) : p.path ? basename(p.path) : "—";
}

function modeText(t: (k: string) => string, m: PadMode): string {
  return m === "hold" ? t("While held") : m === "toEnd" ? t("To the end") : t("Press again to stop");
}

/** The launchpad toggle, shown in the middle of the toolbar of both modes. */
export function LaunchpadToggle() {
  const t = useT();
  const on = useSettings((s) => s.settings.launchpadOn);
  return (
    <button
      type="button"
      className={on ? "ts-btn df-lp-toggle df-lp-toggle--on" : "ts-btn df-lp-toggle"}
      aria-pressed={on}
      onClick={() => useSettings.getState().update({ launchpadOn: !on })}
      onKeyDown={(e) => e.key === " " && e.preventDefault()}
      title={on ? t("Launchpad on: the keys you chose play their sounds") : t("Turn on the launchpad: sounds on keys of your choice")}
    >
      <Icon name="grid" size={15} />
      {t("Launchpad")}
      <span className={on ? "ts-dot ts-dot--go" : "ts-dot"} />
    </button>
  );
}

/** The pads, under the main area, when the launchpad is on. */
export function LaunchpadPanel() {
  const t = useT();
  const pads = useSettings((s) => s.settings.pads);
  const live = usePads((s) => s.live);
  const [editing, setEditing] = useState<Pad | null>(null);
  const playing = (id: string) => live?.voices.find((v) => v.trackId === id && v.fading !== "out") ?? null;
  const add = async () => {
    const files = await pickAudioFiles(t, true);
    if (!files.length) return;
    const list = [...useSettings.getState().settings.pads];
    for (const f of files) list.push({ id: uid(), name: null, builtin: null, path: f, keys: [], mode: "toEnd", loop: false, volumeDb: 0 });
    useSettings.getState().update({ pads: list.slice(0, 64) });
    if (files.length === 1) setEditing(list[list.length - 1]);
  };
  return (
    <section className="df-lp" aria-label={t("Launchpad")}>
      <div className="df-lp__head">
        <Icon name="grid" size={13} color="var(--accent)" />
        <span className="ts-label" style={{ color: "var(--text)" }}>
          {t("Launchpad")}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("Press the keys shown on a pad, or click it. Space is always GO.")}</span>
        <span className="ts-spacer" />
        <Button variant="sm" icon="plus" onClick={add}>
          {t("Add sound")}
        </Button>
      </div>
      <div className="df-lp__grid">
        {pads.map((p) => {
          const v = playing(p.id);
          const missing = !padPath(p);
          const pct = v && v.durationSec > 0 ? Math.min(100, (v.positionSec / v.durationSec) * 100) : 0;
          return (
            <div
              key={p.id}
              className={["df-pad", v ? "df-pad--on" : "", missing ? "df-pad--missing" : ""].join(" ")}
              role="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("[data-edit]")) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                padDown(p);
              }}
              onPointerUp={() => padUp(p)}
              onPointerCancel={() => padUp(p)}
              title={`${padName(t, p)} · ${modeText(t, p.mode)}${p.loop ? ` · ${t("Loop")}` : ""}`}
            >
              <div className="df-pad__top">
                <span className="df-pad__name">{padName(t, p)}</span>
                <button type="button" className="df-pad__edit" data-edit aria-label={t("Edit sound")} title={t("Edit sound")} onClick={() => setEditing(p)}>
                  <Icon name="pencil" size={11} />
                </button>
              </div>
              <div className="df-pad__bottom">
                <span className={p.keys.length ? "df-pad__keys" : "df-pad__keys df-pad__keys--none"}>{p.keys.length ? comboLabel(p.keys) : t("no keys")}</span>
                <Icon name={MODE_ICON[p.mode]} size={11} color="var(--text-3)" />
                {p.loop ? <Icon name="repeat" size={11} color="var(--text-3)" /> : null}
              </div>
              {v ? <div className="df-pad__bar" style={{ width: `${pct}%` }} /> : null}
            </div>
          );
        })}
      </div>
      {editing ? <PadDialog pad={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function PadDialog({ pad, onClose }: { pad: Pad; onClose: () => void }) {
  const t = useT();
  const pads = useSettings((s) => s.settings.pads);
  const [p, setP] = useState<Pad>(pad);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const update = (patch: Partial<Pad>) => setP((x) => ({ ...x, ...patch }));
  const save = () => {
    const err = comboProblem(p.keys, pads, p.id);
    if (err) {
      setProblem(err);
      return;
    }
    useSettings.getState().update({ pads: pads.map((x) => (x.id === p.id ? p : x)) });
    onClose();
  };

  // Key capture: the next keys pressed together become the combination.
  useEffect(() => {
    if (!listening) return;
    usePads.setState({ capturing: true });
    const down = new Set<string>();
    let best: string[] = [];
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === "Escape") {
        setListening(false);
        return;
      }
      down.add(e.code);
      if (down.size > best.length) best = [...down].slice(0, 3);
    };
    const onUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      down.delete(e.code);
      if (down.size === 0 && best.length) {
        // The key that comes last is the one that fires (L, then 1).
        const err = comboProblem(best, pads, p.id);
        setProblem(err);
        if (!err) update({ keys: best });
        setListening(false);
      }
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      usePads.setState({ capturing: false });
    };
  }, [listening, pads, p.id]);

  const sugg = suggestions(pads, p.id);
  const playingNow = isPadPlaying(p.id);
  return (
    <Dialog
      title={padName(t, p)}
      icon="grid"
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="sm"
            icon="trash"
            iconColor="var(--stop)"
            onClick={() => {
              useSettings.getState().update({ pads: pads.filter((x) => x.id !== p.id) });
              onClose();
            }}
          >
            {t("Remove from the launchpad")}
          </Button>
          <span className="ts-spacer" />
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" icon="check" onClick={save}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("Name")}</div>
        </div>
        <input className="ts-input" style={{ width: 280 }} value={p.name ?? padName(t, p)} onChange={(e) => update({ name: e.currentTarget.value || null })} aria-label={t("Name")} />
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="df-set-row__label">{t("Sound")}</div>
          <div className="ts-field__hint ts-ellipsis">{p.path ?? (p.builtin ? t("Standard sound of Diaframma") : "—")}</div>
        </div>
        <Button
          variant="sm"
          icon="fileAdd"
          onClick={async () => {
            const [f] = await pickAudioFiles(t, false);
            if (f) update({ path: f, builtin: null, name: p.name });
          }}
        >
          {t("Choose file…")}
        </Button>
        <Button variant="sm" icon={playingNow ? "stopF" : "playF"} onClick={() => (playingNow ? padUp({ ...p, mode: "hold" }) : padDown({ ...p, mode: "toEnd" }))}>
          {t("Try")}
        </Button>
      </div>
      <div className="df-set-row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="df-set-row__label">{t("Keys")}</div>
          <div className="ts-field__hint">{t("Press the keys together (for example L then 1). Space, Esc, Enter, P, the arrows and Ctrl/Alt are reserved.")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            {sugg.map((s) => (
              <button key={s.label} type="button" className="ts-opt" style={{ width: "auto" }} onClick={() => (update({ keys: s.keys }), setProblem(null))}>
                <span>
                  {t(s.label)}: <b>{comboLabel(s.keys)}</b>
                </span>
              </button>
            ))}
          </div>
          {problem ? <div style={{ marginTop: 6, fontSize: 12, color: "var(--stop)" }}>{t(problem)}</div> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button type="button" className={listening ? "df-keycap df-keycap--listening" : "df-keycap"} onClick={() => setListening(!listening)}>
            <Icon name="keyboard" size={14} />
            {listening ? t("Press the keys…") : p.keys.length ? comboLabel(p.keys) : t("Choose keys")}
          </button>
          {p.keys.length ? (
            <Button variant="sm" icon="x" onClick={() => update({ keys: [] })}>
              {t("No keys")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("It plays")}</div>
        </div>
        <Segmented
          small
          ariaLabel={t("It plays")}
          value={p.mode}
          onChange={(v: PadMode) => update({ mode: v })}
          options={[
            { value: "hold", label: t("While held"), icon: "hand" },
            { value: "toEnd", label: t("To the end"), icon: "toEnd" },
            { value: "toggle", label: t("Press again to stop"), icon: "toggle" },
          ]}
        />
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("Loop")}</div>
          <div className="ts-field__hint">{t("Starts again when it ends (for alarms, rain, ringing…).")}</div>
        </div>
        <Switch checked={p.loop} onChange={(v) => update({ loop: v })} label={t("Loop")} />
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("Volume")}</div>
        </div>
        <NumberField
          className="mono"
          value={p.volumeDb}
          text={`${p.volumeDb > 0 ? "+" : ""}${p.volumeDb.toFixed(1)} dB`}
          label={t("Volume")}
          min={-40}
          max={10}
          onCommit={(v) => update({ volumeDb: Math.round(v * 2) / 2 })}
        />
        <Range label={t("Volume")} value={p.volumeDb} min={-40} max={10} step={0.5} width={160} onChange={(v) => update({ volumeDb: v })} />
      </div>
    </Dialog>
  );
}

/** "Put back the standard sounds" (keeps the user's own). */
export function restoreStandardPads() {
  const s = useSettings.getState().settings;
  const own = s.pads.filter((p) => !p.builtin);
  const std = defaultPads().map((d) => {
    const existing = s.pads.find((p) => p.id === d.id);
    return existing ?? d;
  });
  useSettings.getState().update({ pads: [...std, ...own] });
}
