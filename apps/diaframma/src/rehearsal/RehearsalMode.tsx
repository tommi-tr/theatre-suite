import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { formatTime, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, NumberField, Range, StatusBar, Switch, VFader, type IconName } from "@theatre-suite/ui";
import { api, isTauri, type ExtTabs, type RhOutput, type RhSnapshot, type RhSource } from "../lib/api";
import { pickAudioFiles } from "../lib/files";
import { launchpadClaims } from "../lib/launchpad";
import { INTERNAL, addFavorite, mediaAction, mergeSources, pauseAllSources, tabIdOf } from "../lib/rhModel";
import { useSettings } from "../state/settings";
import { startPlayerEvents, usePlayer } from "../state/player";
import { useRh } from "../state/rehearsal";
import { useUi } from "../state/ui";
import { EQ_BANDS, FLAT_EQ, type Eq } from "../state/types";

type T = (k: string, v?: Record<string, string | number>) => string;

const KIND_ICON: Record<RhSource["kind"], IconName> = {
  spotify: "music",
  browser: "globe",
  media: "playF",
  vlc: "playF",
  wmp: "playF",
  program: "window",
  internal: "file",
};

const OUT_ICON: Record<RhOutput["kind"], IconName> = {
  speakers: "speaker",
  headphones: "headphones",
  hdmi: "monitor",
  digital: "speaker",
  line: "speaker",
  other: "speaker",
};

function kindText(t: T, s: RhSource): string {
  switch (s.kind) {
    case "spotify":
      return t("Spotify app");
    case "browser":
      return s.id.startsWith("tab:") ? t("Chrome tab") : t("Browser · last tab only");
    case "media":
      return t("Media player");
    case "vlc":
      return t("VLC · its own keyboard shortcuts");
    case "wmp":
      return t("Media keys");
    case "internal":
      return t("Diaframma player · full control");
    default:
      return s.canToggle ? t("Media controls") : t("Volume and output only");
  }
}

function speedReason(t: T, s: RhSource): string {
  if (s.kind === "spotify") return t("Spotify does not let other programs change its speed.");
  if (s.kind === "vlc") return t("VLC does not let other programs set its speed. Open the file in Diaframma's player to change it.");
  if (s.kind === "browser") return t("A browser tab can change speed only with the Chrome extension (turn it on in Settings).");
  return t("This player does not let other programs change its speed. Open the file in Diaframma's player to change it.");
}

const pctText = (v: number) => `${Math.round(v * 100)}%`;

export function RehearsalMode() {
  const t = useT();
  const [snap, setSnap] = useState<RhSnapshot | null>(null);
  const [ext, setExt] = useState<ExtTabs | null>(null);
  const [dragFrom, setDragFrom] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragTo, setDragTo] = useState<{ x: number; y: number } | null>(null);
  const [hoverOut, setHoverOut] = useState<string | null>(null);
  const [eqOpen, setEqOpen] = useState(false);
  const settings = useSettings((s) => s.settings);
  const player = usePlayer();
  const levels = useRh((s) => s.levels);

  const refresh = useCallback(() => {
    if (!isTauri) {
      if (location.search.includes("demo")) import("../lib/demoRehearsal").then((m) => setSnap(m.demoSnapshot()));
      return;
    }
    api
      .rhSnapshot()
      .then(setSnap)
      .catch(() => setSnap({ supported: false, routingAvailable: false, sources: [], outputs: [], pendingRestore: 0 }));
    api
      .extTabs()
      .then(setExt)
      .catch(() => setExt(null));
  }, []);

  useEffect(() => {
    startPlayerEvents();
    refresh();
    const id = window.setInterval(refresh, 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const outputs = useMemo(() => snap?.outputs ?? [], [snap]);
  const connected = useMemo(() => outputs.filter((o) => o.connected !== false), [outputs]);
  const defaultOut = useMemo(() => connected.find((o) => o.isDefault) ?? null, [connected]);

  // The internal player and the Chrome tabs appear as sources like the others (same list as the phone).
  const chromeSource = (snap?.sources ?? []).find((x) => x.exe === "chrome.exe") ?? null;
  const sources: RhSource[] = useMemo(
    () => mergeSources(snap, ext, connected, t("Chrome tab")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, ext, player.playlist, player.index, player.speed, player.volume, player.device, player.live, connected, t],
  );

  // Levels start from what Windows has.
  useEffect(() => useRh.getState().adopt(sources), [sources]);
  // The main volume moves every source.
  const mainRef = useRef(settings.rhMain);
  useEffect(() => {
    if (mainRef.current === settings.rhMain) return;
    mainRef.current = settings.rhMain;
    useRh.getState().resend(sources);
  }, [settings.rhMain, sources]);
  // The equalizer applies to Diaframma's player.
  useEffect(() => usePlayer.getState().refreshEq(), [settings.rhEq]);

  // Diaframma chooses every output itself: a program that follows the Windows
  // default is fixed on the output it uses now, so it does not jump when Windows
  // changes its default (for example when headphones connect).
  const pinned = useRef(new Set<string>());
  useEffect(() => {
    if (!settings.pinOutputs || !snap?.routingAvailable || !defaultOut) return;
    for (const s of snap.sources) {
      if (s.outputId || !s.pids.length || pinned.current.has(s.id)) continue;
      pinned.current.add(s.id);
      api.rhRoute(s.id, defaultOut.id).catch(() => pinned.current.delete(s.id));
    }
  }, [snap, settings.pinOutputs, defaultOut]);

  const tabId = tabIdOf;
  const setSpeed = (s: RhSource, v: number) => {
    if (s.id === INTERNAL) usePlayer.getState().setSpeed(v);
    else if (tabId(s.id) !== null) api.extCommand(tabId(s.id)!, "speed", v).catch(() => {});
    else api.rhSetSpeed([s.id], v).then(() => window.setTimeout(refresh, 250)).catch(() => {});
  };

  const media = (s: RhSource, action: "toggle" | "next" | "prev") => {
    mediaAction(s.id, action)
      .then(() => window.setTimeout(refresh, s.id === INTERNAL ? 0 : 280))
      .catch((e) => useUi.getState().showToast(String(e), "error"));
  };

  const route = (s: RhSource, out: RhOutput) => {
    if (!out.connected) return;
    if (s.id === INTERNAL) {
      usePlayer.getState().setDevice(out.name);
      return;
    }
    if (tabId(s.id) !== null) {
      if (!chromeSource) return;
      useUi.getState().showToast(t("Chrome tabs share one output: the whole of Chrome moves."));
      s = chromeSource;
    }
    if (!snap?.routingAvailable) {
      useUi.getState().showToast(t("Choosing the output of each program is not available on this version of Windows."), "error");
      return;
    }
    // Always an explicit output: the Windows default never decides.
    api
      .rhRoute(s.id, out.id)
      .then(() => window.setTimeout(refresh, 150))
      .catch((e) => useUi.getState().showToast(String(e), "error"));
  };

  const star = (s: RhSource) => {
    addFavorite(s);
    useUi.getState().showToast(t("Added to favorites"));
  };

  const pauseAll = () => {
    pauseAllSources(ext);
    window.setTimeout(refresh, 300);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || useUi.getState().mode !== "rehearsal") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (launchpadClaims(e)) return;
      if (e.code === "KeyP" && !e.ctrlKey && !e.altKey && !e.repeat) {
        e.preventDefault();
        pauseAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const roleOf = (o: RhOutput): "live" | "pre" | null => settings.outputRoles[o.name] ?? null;
  const setRole = (o: RhOutput, role: "live" | "pre" | null) => {
    const roles = { ...settings.outputRoles };
    if (role) roles[o.name] = role;
    else delete roles[o.name];
    useSettings.getState().update({ outputRoles: roles });
  };
  const outputFor = (s: RhSource) => connected.find((o) => (s.outputId ? o.id === s.outputId : o.isDefault)) ?? null;

  // ---------- Routing lines ----------
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Array<{ key: string; d: string; color: string; dashed: boolean }>>([]);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const base = wrap.getBoundingClientRect();
      const out: typeof lines = [];
      for (const s of sources) {
        const card = wrap.querySelector<HTMLElement>(`[data-source-id="${CSS.escape(s.id)}"]`);
        const o = outputFor(s);
        if (!card || !o) continue;
        const oc = wrap.querySelector<HTMLElement>(`[data-output-id="${CSS.escape(o.id)}"]`);
        if (!oc) continue;
        const a = card.getBoundingClientRect();
        const b = oc.getBoundingClientRect();
        const x1 = a.left + a.width / 2 - base.left;
        const y1 = a.bottom - base.top;
        const x2 = b.left + b.width / 2 - base.left;
        const y2 = b.top - base.top;
        const my = (y1 + y2) / 2;
        const role = roleOf(o);
        out.push({
          key: s.id,
          d: `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`,
          color: role === "live" ? "var(--go)" : role === "pre" ? "var(--pre)" : "var(--text-3)",
          dashed: s.status !== "playing",
        });
      }
      setLines(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [sources, snap, settings.outputRoles]);

  // Dragging the dot under a source onto an output. The listeners live on the window (not on the dot)
  // and the source is looked up again when the dot is released, so a refresh of the list in the
  // middle of the drag (Spotify changes its data often) cannot break it.
  const latest = useRef({ sources, outputs, route });
  latest.current = { sources, outputs, route };
  const startDrag = (id: string, e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pid = e.pointerId;
    const base = wrap.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const from = { id, x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
    setDragFrom(from);
    setDragTo({ x: from.x, y: from.y });
    const hit = (ev: PointerEvent): string | null => {
      const cards = Array.from(wrap.querySelectorAll<HTMLElement>("[data-output-id]"));
      const pad = 10;
      for (const c of cards) {
        const b = c.getBoundingClientRect();
        if (ev.clientX >= b.left - pad && ev.clientX <= b.right + pad && ev.clientY >= b.top - pad && ev.clientY <= b.bottom + pad) return c.dataset.outputId ?? null;
      }
      return null;
    };
    const at = (ev: PointerEvent) => {
      const b = wrap.getBoundingClientRect();
      setDragTo({ x: ev.clientX - b.left, y: ev.clientY - b.top });
      const target = hit(ev);
      setHoverOut(target);
      return target;
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      setDragFrom(null);
      setDragTo(null);
      setHoverOut(null);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === pid) at(ev);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const target = at(ev);
      end();
      const cur = latest.current;
      const src = cur.sources.find((x) => x.id === id);
      const o = cur.outputs.find((x) => x.id === target);
      if (src && o) cur.route(src, o);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
  };
  const dragLine =
    dragFrom && dragTo ? `M${dragFrom.x} ${dragFrom.y} C${dragFrom.x} ${(dragFrom.y + dragTo.y) / 2} ${dragTo.x} ${(dragFrom.y + dragTo.y) / 2} ${dragTo.x} ${dragTo.y}` : null;

  if (snap && !snap.supported && !location.search.includes("demo")) {
    return (
      <main className="df-rh" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="df-empty" style={{ maxWidth: 520 }}>
          {t("Rehearsal mode needs Windows 10 or 11: it controls the players open on the computer.")}
        </div>
      </main>
    );
  }

  const playingCount = sources.filter((s) => s.status === "playing").length;
  const eqOn = settings.rhEq.some((g) => g !== 0);

  return (
    <>
      <div className="df-toolbar">
        <Button
          icon="fileAdd"
          onClick={async () => {
            const files = await pickAudioFiles(t, true);
            if (files.length) usePlayer.getState().open(files);
          }}
        >
          {t("Open audio file")}
        </Button>
        <button type="button" className="df-rh-pauseall" onClick={pauseAll} disabled={!playingCount} title={t("Pauses every source that plays (P)")}>
          <Icon name="pauseF" size={14} />
          {t("Pause all")}
          <Kbd>P</Kbd>
        </button>
        <span className="ts-spacer" />
        <div className="df-ctl" role="group" aria-label={t("Main volume")} title={t("Main volume: moves every source together")}>
          <Icon name="volume" size={15} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("Main")}</span>
          <Range label={t("Main volume")} value={Math.round(settings.rhMain * 100)} min={0} max={100} width={110} onChange={(v) => useSettings.getState().update({ rhMain: v / 100 })} />
          <NumberField
            className="mono df-ctl__val"
            value={settings.rhMain}
            text={pctText(settings.rhMain)}
            label={t("Main volume")}
            min={0}
            max={100}
            parse={(x) => {
              const n = Number(x.replace(",", ".").replace(/[^0-9.]/g, ""));
              return Number.isFinite(n) ? n / 100 : null;
            }}
            onCommit={(v) => useSettings.getState().update({ rhMain: Math.max(0, Math.min(1, v)) })}
          />
        </div>
        <div style={{ position: "relative" }}>
          <Button icon="sliders" on={eqOn} onClick={() => setEqOpen(!eqOpen)} aria-expanded={eqOpen} title={t("Equalizer of Diaframma's player")}>
            {t("Equalizer")}
          </Button>
          {eqOpen ? <RhEq t={t} onClose={() => setEqOpen(false)} /> : null}
        </div>
        <Button icon="starF" iconColor="var(--sb-fill)" onClick={() => document.getElementById("df-favs")?.scrollIntoView({ behavior: "smooth" })}>
          {t("Favorites")}
        </Button>
      </div>

      <main className="df-rh">
        <div ref={wrapRef} style={{ position: "relative" }}>
          <div className="df-section-head">
            <span className="ts-label">{t("Sources")}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("{n} playing on this computer", { n: playingCount })}</span>
          </div>
          {sources.length ? (
            <div className="df-sources">
              {sources.map((s) => (
                <SourceCard
                  key={s.id}
                  s={s}
                  t={t}
                  level={levels[s.id] ?? s.volume}
                  onMedia={(a) => media(s, a)}
                  onStar={() => star(s)}
                  onLevel={(v) => useRh.getState().setLevel(s, v)}
                  onSpeed={(v) => setSpeed(s, v)}
                  onSeek={s.id === INTERNAL ? (sec) => usePlayer.getState().seek(sec) : undefined}
                  onStartDrag={(e) => startDrag(s.id, e)}
                  dragging={dragFrom?.id === s.id}
                />
              ))}
            </div>
          ) : (
            <div className="df-empty">{t("No player is making sound right now. Start Spotify, a browser or a media player, or press Open audio file.")}</div>
          )}

          <div className="df-routing">
            <span className="df-routing__hint">
              <Icon name="info" size={12} />
              {t("Drag the dot under a source onto an output, or choose the output in the source")}
            </span>
          </div>

          <div className="df-section-head">
            <span className="ts-label">{t("Outputs")}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              <span style={{ color: "var(--go)", fontWeight: 600 }}>{t("LIVE")}</span> {t("everyone hears it")} ·{" "}
              <span style={{ color: "var(--pre)", fontWeight: 600 }}>{t("PRE-LISTEN")}</span> {t("only you hear it")}
            </span>
            <span className="ts-spacer" />
            <label className="df-pin" title={t("Every program stays on the output chosen here, even when Windows changes its default output (for example when headphones connect).")}>
              <Icon name="pin" size={13} />
              {t("Automatic output choice")}
              <Switch checked={settings.pinOutputs} onChange={(v) => useSettings.getState().update({ pinOutputs: v })} label={t("Automatic output choice")} />
            </label>
          </div>
          <div className="df-outputs">
            {connected.map((o) => (
              <OutputCard key={o.id} o={o} t={t} role={roleOf(o)} onRole={(r) => setRole(o, r)} target={hoverOut === o.id} />
            ))}
          </div>

          <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }} aria-hidden="true">
            {lines.map((l) => (
              <path key={l.key} d={l.d} fill="none" stroke={l.color} strokeWidth={l.dashed ? 1.75 : 2.75} strokeDasharray={l.dashed ? "5 6" : undefined} opacity={l.dashed ? 0.6 : 1} strokeLinecap="round" />
            ))}
            {dragLine ? <path d={dragLine} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeDasharray="4 4" /> : null}
          </svg>
        </div>

        <Favorites t={t} />
      </main>

      <StatusBar>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className={snap?.supported ? "ts-dot ts-dot--go" : "ts-dot"} />
          {t("{n} sources", { n: sources.length })} · {t("{n} outputs", { n: connected.length })}
        </span>
        {snap && !snap.routingAvailable && snap.supported ? <span>{t("Output per program not available on this Windows")}</span> : null}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="reset" size={12} />
          {t("When Diaframma closes, volumes and outputs go back as they were")}
        </span>
        <span className="ts-spacer" />
        <span>
          <Kbd>P</Kbd> {t("pause all")}
        </span>
      </StatusBar>
    </>
  );
}

function RhEq({ t, onClose }: { t: T; onClose: () => void }) {
  const eq = useSettings((s) => s.settings.rhEq);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);
  const set = (i: number, v: number) => {
    const next = [...useSettings.getState().settings.rhEq] as Eq;
    next[i] = Math.max(-12, Math.min(12, Math.round(v * 2) / 2));
    useSettings.getState().update({ rhEq: next });
  };
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
  return (
    <div ref={ref} className="df-menu df-eqpop" role="dialog" aria-label={t("Equalizer")}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 12.5 }}>{t("Equalizer")}</b>
        <span className="ts-spacer" />
        <Button variant="sm" icon="reset" onClick={() => useSettings.getState().update({ rhEq: [...FLAT_EQ] })}>
          {t("Reset")}
        </Button>
      </div>
      <div className="df-eq5">
        {EQ_BANDS.map((f, i) => (
          <div key={f} className="df-fader-col">
            <NumberField className="df-fader-col__val" value={eq[i]} text={signed(eq[i])} label={`${t("Equalizer")} ${f} Hz`} min={-12} max={12} onCommit={(v) => set(i, v)} />
            <VFader label={`${t("Equalizer")} ${f} Hz`} value={eq[i]} min={-12} max={12} zero={0} step={0.5} onChange={(v) => set(i, v)} onReset={() => set(i, 0)} />
            <span className="df-fader-col__name">{f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`}</span>
          </div>
        ))}
      </div>
      <div className="ts-field__hint" style={{ marginTop: 8, maxWidth: 230 }}>
        {t("Works on the files played by Diaframma (Open audio file). Windows does not let a program equalize the others without installing an audio driver.")}
      </div>
    </div>
  );
}

function SourceCard({
  s,
  t,
  level,
  onMedia,
  onStar,
  onLevel,
  onSpeed,
  onSeek,
  onStartDrag,
  dragging,
}: {
  s: RhSource;
  t: T;
  level: number | null;
  onMedia: (a: "toggle" | "next" | "prev") => void;
  onStar: () => void;
  onLevel: (v: number) => void;
  onSpeed: (v: number) => void;
  onSeek?: (sec: number) => void;
  onStartDrag: (e: React.PointerEvent<HTMLElement>) => void;
  dragging: boolean;
}) {
  const progress = s.durationSec && s.positionSec !== null ? Math.min(100, (s.positionSec / s.durationSec) * 100) : null;
  const speedOk = s.canSpeed;
  const speed = s.speed ?? 1;
  return (
    <div className={["df-source", s.status === "playing" ? "df-source--playing" : s.status === "paused" ? "df-source--paused" : ""].join(" ")} data-source-id={s.id}>
      <div className="df-source__head">
        <span className="df-source__glyph" style={s.kind === "internal" ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}>
          <Icon name={KIND_ICON[s.kind]} size={14} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ts-ellipsis" style={{ fontSize: 12, fontWeight: 500, color: "var(--text-2)" }}>
            {s.app}
          </div>
          <div className="ts-ellipsis" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {kindText(t, s)}
          </div>
        </div>
        <span className={s.status === "playing" ? "ts-pill ts-pill--go" : s.status === "paused" ? "ts-pill ts-pill--sb" : "ts-pill"} style={{ height: 18 }}>
          {s.status === "playing" ? <Icon name="playF" size={8} /> : s.status === "paused" ? <Icon name="pauseF" size={8} /> : null}
          {s.status === "playing" ? t("PLAYING") : s.status === "paused" ? t("PAUSED") : t("IDLE")}
        </span>
      </div>
      <div className="df-source__preview">
        <div className="df-source__thumb">
          {s.thumb ? <img src={s.thumb} alt="" width={48} height={48} style={{ borderRadius: "var(--r-sm)", objectFit: "cover" }} /> : <Icon name={KIND_ICON[s.kind]} size={20} color="var(--text-3)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <div className="ts-ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }} title={s.title}>
            {s.title || "—"}
          </div>
          <div className="ts-ellipsis" style={{ fontSize: 11.5, color: "var(--text-2)" }}>
            {s.artist}
          </div>
          {progress !== null ? (
            <>
              <div
                style={{ position: "relative", height: 4, marginTop: 4, borderRadius: 2, background: "var(--surface-3)", overflow: "hidden", cursor: onSeek ? "pointer" : "default" }}
                onClick={(e) => {
                  if (!onSeek || !s.durationSec) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  onSeek(((e.clientX - r.left) / r.width) * s.durationSec);
                }}
              >
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress}%`, background: s.status === "playing" ? "var(--go)" : "var(--text-3)" }} />
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                {formatTime(s.positionSec)} / {formatTime(s.durationSec)}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="df-source__controls">
        <Button variant="sm" iconOnly icon="prevF" aria-label={t("Previous")} title={t("Previous")} disabled={!s.canPrev} onClick={() => onMedia("prev")} />
        <Button variant="sm" iconOnly icon={s.status === "playing" ? "pauseF" : "playF"} aria-label={t("Play / pause")} title={t("Play / pause")} disabled={!s.canToggle} onClick={() => onMedia("toggle")} />
        <Button variant="sm" iconOnly icon="nextF" aria-label={t("Next")} title={t("Next")} disabled={!s.canNext} onClick={() => onMedia("next")} />
        <span className="ts-spacer" />
        <Button variant="sm" iconOnly icon="star" aria-label={t("Add to favorites")} title={t("Add to favorites")} onClick={onStar} />
      </div>
      <div className={level === null ? "df-srcrow df-srcrow--off" : "df-srcrow"} title={level === null ? t("This program has no volume of its own in Windows yet: start it playing first.") : undefined}>
        <Icon name="volume" size={13} />
        <span className="df-srcrow__label">{t("Volume")}</span>
        <Range label={t("Volume of {name}", { name: s.app })} value={Math.round((level ?? 1) * 100)} min={0} max={100} width={0} disabled={level === null} onChange={(v) => onLevel(v / 100)} />
        <NumberField
          className="mono df-srcrow__val"
          value={level}
          text={level === null ? "—" : pctText(level)}
          label={t("Volume of {name}", { name: s.app })}
          disabled={level === null}
          parse={(x) => {
            const n = Number(x.replace(",", ".").replace(/[^0-9.]/g, ""));
            return Number.isFinite(n) ? n / 100 : null;
          }}
          min={0}
          max={1}
          onCommit={onLevel}
        />
        <button type="button" className="df-srcrow__reset" disabled={level === null || Math.round((level ?? 1) * 100) === 100} onClick={() => onLevel(1)} title={t("Back to 100%")}>
          100
        </button>
      </div>
      <div className={speedOk ? "df-srcrow" : "df-srcrow df-srcrow--off"} title={speedOk ? undefined : speedReason(t, s)}>
        <Icon name="gauge" size={13} />
        <span className="df-srcrow__label">{t("Speed")}</span>
        <Range label={t("Speed of {name}", { name: s.app })} value={Math.round(speed * 100)} min={50} max={150} width={0} disabled={!speedOk} onChange={(v) => onSpeed(v / 100)} />
        <NumberField
          className="mono df-srcrow__val"
          value={speedOk ? speed : null}
          text={speedOk ? pctText(speed) : "—"}
          label={t("Speed of {name}", { name: s.app })}
          disabled={!speedOk}
          parse={(x) => {
            const n = Number(x.replace(",", ".").replace(/[^0-9.]/g, ""));
            return Number.isFinite(n) ? n / 100 : null;
          }}
          min={0.5}
          max={1.5}
          onCommit={onSpeed}
          title={speedOk ? undefined : speedReason(t, s)}
        />
        <button type="button" className="df-srcrow__reset" disabled={!speedOk || Math.round(speed * 100) === 100} onClick={() => onSpeed(1)} title={t("Back to 100%")}>
          100
        </button>
      </div>
      <button
        type="button"
        className={dragging ? "df-source__dot df-source__dot--drag" : "df-source__dot"}
        aria-label={t("Drag onto an output")}
        title={t("Drag onto an output")}
        onPointerDown={onStartDrag}
      />
    </div>
  );
}

function Meter({ l, r, color }: { l: number; r: number; color: string }) {
  // One drawing for both channels, so they always have the same size.
  const w = (p: number) => Math.min(100, Math.sqrt(Math.max(0, p)) * 100);
  return (
    <svg className="df-meter" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="100" height="4" rx="2" fill="var(--surface-3)" />
      <rect x="0" y="6" width="100" height="4" rx="2" fill="var(--surface-3)" />
      <rect x="0" y="0" width={w(l)} height="4" rx="2" fill={color} />
      <rect x="0" y="6" width={w(r)} height="4" rx="2" fill={color} />
    </svg>
  );
}

function OutputCard({ o, t, role, onRole, target }: { o: RhOutput; t: T; role: "live" | "pre" | null; onRole: (r: "live" | "pre" | null) => void; target: boolean }) {
  const cls = ["df-output", role === "live" ? "df-output--live" : role === "pre" ? "df-output--pre" : "", target ? "df-output--target" : "", o.connected === false ? "df-output--off" : ""].join(" ");
  const vol = o.volume;
  return (
    <article className={cls} data-output-id={o.connected === false ? undefined : o.id} aria-label={o.name} title={o.connected === false ? t("Not connected") : o.name}>
      <div className="df-output__top">
        <span className={role === "live" ? "df-out-icon df-out-icon--live" : role === "pre" ? "df-out-icon df-out-icon--pre" : "df-out-icon"}>
          <Icon name={role === "pre" ? "headphones" : OUT_ICON[o.kind] ?? "speaker"} size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ts-ellipsis" style={{ fontSize: 13, fontWeight: 600 }} title={o.name}>
            {o.name}
          </div>
          <div className="ts-ellipsis" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {o.connected === false ? t("Not connected") : role === "live" ? t("everyone hears it") : role === "pre" ? t("only you hear it") : t("No role")}
            {o.isDefault ? ` · ${t("Windows default")}` : ""}
          </div>
        </div>
      </div>
      {o.connected !== false ? (
        <div className="df-output__bottom">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              className="ts-select"
              style={{ height: 22, fontSize: 11, padding: "0 4px", flex: "none" }}
              value={role ?? ""}
              onChange={(e) => onRole((e.currentTarget.value || null) as "live" | "pre" | null)}
              aria-label={t("Role of this output")}
            >
              <option value="">{t("Set role")}</option>
              <option value="live">{t("LIVE")}</option>
              <option value="pre">{t("PRE-LISTEN")}</option>
            </select>
            <Meter l={o.peakL} r={o.peakR} color={role === "pre" ? "var(--pre)" : "var(--go)"} />
          </div>
          <div className={vol === null ? "df-srcrow df-srcrow--off" : "df-srcrow"} style={{ padding: 0 }}>
            <Icon name="volume" size={13} />
            <Range label={t("Volume of {name}", { name: o.name })} value={Math.round((vol ?? 1) * 100)} min={0} max={100} width={0} disabled={vol === null} onChange={(v) => api.rhSetOutputVolume(o.id, v / 100).catch(() => {})} />
            <NumberField
              className="mono df-srcrow__val"
              value={vol}
              text={vol === null ? "—" : pctText(vol)}
              label={t("Volume of {name}", { name: o.name })}
              disabled={vol === null}
              parse={(x) => {
                const n = Number(x.replace(",", ".").replace(/[^0-9.]/g, ""));
                return Number.isFinite(n) ? n / 100 : null;
              }}
              min={0}
              max={1}
              onCommit={(v) => api.rhSetOutputVolume(o.id, v).catch(() => {})}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Favorites({ t }: { t: T }) {
  const favorites = useSettings((s) => s.settings.favorites);
  const rows = favorites.map((f) => [f.title, f.artist, f.source, new Date(f.at).toLocaleString(), f.positionSec !== null ? formatTime(f.positionSec) : "", f.link ?? ""]);
  const header = [t("Title"), t("Artist / channel"), t("Source"), t("Time"), t("Minute"), t("Link or file")];
  const csv = () => [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  return (
    <section id="df-favs" className="df-favs" aria-label={t("Favorites")}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 8px 0 12px", borderBottom: favorites.length ? "1px solid var(--border)" : undefined }}>
        <Icon name="starF" size={14} color="var(--sb-fill)" />
        <span style={{ fontWeight: 600 }}>{t("Favorites")}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{favorites.length ? t("{n} saved", { n: favorites.length }) : t("Press ★ on a source to remember what is playing")}</span>
        <span className="ts-spacer" />
        <Button
          variant="sm"
          icon="download"
          disabled={!favorites.length}
          onClick={async () => {
            const path = await save({ defaultPath: "Favorites.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
            if (path) api.writeText(path, "﻿" + csv()).then(() => useUi.getState().showToast(t("Favorites exported"))).catch((e) => useUi.getState().showToast(String(e), "error"));
          }}
        >
          {t("Export CSV")}
        </Button>
        <Button
          variant="sm"
          icon="copy"
          disabled={!favorites.length}
          onClick={() =>
            navigator.clipboard
              .writeText([header, ...rows].map((r) => r.join("\t")).join("\n"))
              .then(() => useUi.getState().showToast(t("Copied")))
              .catch(() => {})
          }
        >
          {t("Copy")}
        </Button>
        <Button variant="sm" icon="phone" disabled={!favorites.length} onClick={() => useUi.getState().openDialog("phone")} title={t("Open the phone page to see the favorites on your phone")}>
          {t("Send to phone")}
        </Button>
      </div>
      {favorites.length ? (
        <table>
          <thead>
            <tr>
              {header.map((h) => (
                <th key={h}>{h}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {favorites.map((f, i) => (
              <tr key={f.id}>
                {rows[i].map((c, k) => (
                  <td key={k} title={String(c)}>
                    {c}
                  </td>
                ))}
                <td style={{ width: 30 }}>
                  <Button
                    variant="sm"
                    iconOnly
                    icon="x"
                    aria-label={t("Remove")}
                    title={t("Remove")}
                    onClick={() => useSettings.getState().update({ favorites: favorites.filter((x) => x.id !== f.id) })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
