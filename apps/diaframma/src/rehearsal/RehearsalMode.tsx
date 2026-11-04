import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { basename, formatTime, uid, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, Range, StatusBar, type IconName } from "@theatre-suite/ui";
import { api, isTauri, type ExtTabs, type RhOutput, type RhSnapshot, type RhSource } from "../lib/api";
import { pickAudioFiles } from "../lib/files";
import { useSettings, type Favorite } from "../state/settings";
import { startPlayerEvents, usePlayer } from "../state/player";
import { useUi } from "../state/ui";

const INTERNAL = "internal";

const KIND_ICON: Record<RhSource["kind"], IconName> = {
  spotify: "music",
  browser: "globe",
  media: "playF",
  vlc: "playF",
  program: "window",
  internal: "file",
};

function kindText(t: (k: string) => string, s: RhSource): string {
  switch (s.kind) {
    case "spotify":
      return t("Spotify app");
    case "browser":
      return t("Browser · last tab only");
    case "media":
      return t("Media player");
    case "vlc":
      return t("Media keys");
    case "internal":
      return t("Diaframma player · full control");
    default:
      return s.canToggle ? t("Media controls") : t("Volume and output only");
  }
}

export function RehearsalMode() {
  const t = useT();
  const [snap, setSnap] = useState<RhSnapshot | null>(null);
  const [ext, setExt] = useState<ExtTabs | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [dragFrom, setDragFrom] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverOut, setHoverOut] = useState<string | null>(null);
  const settings = useSettings((s) => s.settings);
  const player = usePlayer();
  const playerVoice = player.live?.voices.find((v) => v.trackId === `player-${player.index}`) ?? null;

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

  // The internal player appears as a source like the others.
  const chromeSource = (snap?.sources ?? []).find((x) => x.exe === "chrome.exe") ?? null;
  const sources: RhSource[] = useMemo(() => {
    let list = [...(snap?.sources ?? [])];
    // With the extension, every Chrome tab is a source of its own.
    if (ext?.connected) {
      list = list.filter((x) => x.exe !== "chrome.exe");
      for (const tab of ext.tabs) {
        const m = tab.media;
        list.push({
          id: `tab:${tab.tabId}`,
          app: t("Chrome tab"),
          exe: "chrome.exe",
          kind: "browser",
          title: m?.title || tab.title,
          artist: m?.site || "",
          thumb: null,
          status: m ? (m.paused ? "paused" : "playing") : tab.audible ? "playing" : "stopped",
          canToggle: !!m,
          canNext: !!m,
          canPrev: !!m,
          canSpeed: !!m,
          speed: m?.playbackRate ?? null,
          volume: m ? m.volume : null,
          peak: 0,
          pids: chromeSource?.pids ?? [],
          outputId: chromeSource?.outputId ?? null,
          positionSec: m?.currentTime ?? null,
          durationSec: m?.duration ?? null,
        });
      }
    }
    if (player.playlist.length) {
      const defaultOut = snap?.outputs.find((o) => o.isDefault)?.id ?? null;
      const devId = player.device ? snap?.outputs.find((o) => o.name === player.device)?.id ?? defaultOut : null;
      list.unshift({
        id: INTERNAL,
        app: "Diaframma",
        exe: "diaframma.exe",
        kind: "internal",
        title: basename(player.playlist[player.index] ?? ""),
        artist: player.playlist.length > 1 ? `${player.index + 1} / ${player.playlist.length}` : "",
        thumb: null,
        status: playerVoice ? (playerVoice.paused ? "paused" : "playing") : "stopped",
        canToggle: true,
        canNext: player.index + 1 < player.playlist.length,
        canPrev: true,
        canSpeed: true,
        speed: player.speed,
        volume: player.volume,
        peak: 0,
        pids: [],
        outputId: devId,
        positionSec: playerVoice?.positionSec ?? 0,
        durationSec: playerVoice?.durationSec ?? null,
      });
    }
    return list;
  }, [snap, ext, chromeSource, player, playerVoice, t]);

  const sel = sources.filter((s) => selected.includes(s.id));
  const speedOk = sel.length > 0 && sel.every((s) => s.canSpeed);
  const volOk = sel.length > 0 && sel.some((s) => s.volume !== null);

  // Selection follows what exists.
  useEffect(() => {
    setSelected((cur) => cur.filter((id) => sources.some((s) => s.id === id)));
  }, [sources]);
  useEffect(() => {
    if (sel.length) {
      const v = sel.find((s) => s.volume !== null)?.volume;
      if (typeof v === "number") setVolume(v);
      const sp = sel.find((s) => s.speed !== null)?.speed;
      if (typeof sp === "number") setSpeed(sp);
    }
  }, [selected.join("|")]);

  const tabId = (id: string) => (id.startsWith("tab:") ? Number(id.slice(4)) : null);
  const applyVolume = (v: number) => {
    setVolume(v);
    sel.forEach((s) => tabId(s.id) !== null && api.extCommand(tabId(s.id)!, "volume", v).catch(() => {}));
    const ext = sel.filter((s) => s.id !== INTERNAL && tabId(s.id) === null).map((s) => s.id);
    if (ext.length) api.rhSetVolume(ext, v).catch(() => {});
    if (selected.includes(INTERNAL)) usePlayer.getState().setVolume(v);
  };
  const applySpeed = (v: number) => {
    setSpeed(v);
    sel.forEach((s) => tabId(s.id) !== null && api.extCommand(tabId(s.id)!, "speed", v).catch(() => {}));
    const ext = sel.filter((s) => s.id !== INTERNAL && tabId(s.id) === null).map((s) => s.id);
    if (ext.length) api.rhSetSpeed(ext, v).catch(() => {});
    if (selected.includes(INTERNAL)) usePlayer.getState().setSpeed(v);
  };

  const media = (s: RhSource, action: "toggle" | "next" | "prev") => {
    if (s.id === INTERNAL) {
      const p = usePlayer.getState();
      if (action === "toggle") p.toggle();
      else if (action === "next") p.next();
      else p.prev();
      return;
    }
    if (tabId(s.id) !== null) {
      api.extCommand(tabId(s.id)!, action).then(() => window.setTimeout(refresh, 300)).catch(() => {});
      return;
    }
    api
      .rhMedia(s.id, action)
      .then(() => window.setTimeout(refresh, 250))
      .catch((e) => useUi.getState().showToast(String(e), "error"));
  };

  const route = (s: RhSource, out: RhOutput) => {
    if (s.id === INTERNAL) {
      usePlayer.getState().setDevice(out.isDefault ? null : out.name);
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
    api
      .rhRoute(s.id, out.isDefault ? null : out.id)
      .then(() => window.setTimeout(refresh, 200))
      .catch((e) => useUi.getState().showToast(String(e), "error"));
  };

  const star = (s: RhSource) => {
    const f: Favorite = {
      id: uid(),
      title: s.title || s.app,
      artist: s.artist || (s.kind === "browser" ? s.app : ""),
      source: s.id === INTERNAL ? "Diaframma" : s.app,
      at: new Date().toISOString(),
      positionSec: s.positionSec,
      link: s.id === INTERNAL ? usePlayer.getState().playlist[usePlayer.getState().index] ?? null : null,
    };
    useSettings.getState().update({ favorites: [f, ...useSettings.getState().settings.favorites].slice(0, 500) });
    useUi.getState().showToast(t("Added to favorites"));
  };

  const pauseAll = () => {
    api.rhPauseAll().catch(() => {});
    const p = usePlayer.getState();
    const v = p.live?.voices.find((x) => !x.paused);
    if (v) api.playerPause(v.trackId).catch(() => {});
    window.setTimeout(refresh, 300);
  };

  // Ctrl+A selects every source, Space toggles the selected ones.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || useUi.getState().mode !== "rehearsal") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.ctrlKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(sources.map((s) => s.id));
      } else if (e.key === "Escape") {
        setSelected([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sources]);

  const roleOf = (o: RhOutput): "live" | "pre" | null => settings.outputRoles[o.name] ?? null;
  const setRole = (o: RhOutput, role: "live" | "pre" | null) => {
    const roles = { ...settings.outputRoles };
    if (role) roles[o.name] = role;
    else delete roles[o.name];
    useSettings.getState().update({ outputRoles: roles });
  };
  const outputFor = (s: RhSource) => snap?.outputs.find((o) => (s.outputId ? o.id === s.outputId : o.isDefault)) ?? null;

  // ---------- Routing lines ----------
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Array<{ key: string; d: string; color: string; dashed: boolean }>>([]);
  const [dragLine, setDragLine] = useState<string | null>(null);
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

  const onDragMove = (e: React.PointerEvent) => {
    if (!dragFrom || !wrapRef.current) return;
    const base = wrapRef.current.getBoundingClientRect();
    const x2 = e.clientX - base.left;
    const y2 = e.clientY - base.top;
    const my = (dragFrom.y + y2) / 2;
    setDragLine(`M${dragFrom.x} ${dragFrom.y} C${dragFrom.x} ${my} ${x2} ${my} ${x2} ${y2}`);
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    setHoverOut(el?.closest<HTMLElement>("[data-output-id]")?.dataset.outputId ?? null);
  };
  const onDragEnd = () => {
    if (dragFrom && hoverOut) {
      const s = sources.find((x) => x.id === dragFrom.id);
      const o = snap?.outputs.find((x) => x.id === hoverOut);
      if (s && o) route(s, o);
    }
    setDragFrom(null);
    setDragLine(null);
    setHoverOut(null);
  };

  if (snap && !snap.supported && !location.search.includes("demo")) {
    return (
      <main className="df-rh" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="df-empty" style={{ maxWidth: 520 }}>
          {t("Rehearsal mode needs Windows 10 or 11: it controls the players open on the computer.")}
        </div>
      </main>
    );
  }

  const playingCount = sources.filter((s) => s.status !== "stopped").length;

  return (
    <>
      <div className="df-toolbar">
        <Button
          icon="fileAdd"
          onClick={async () => {
            const files = await pickAudioFiles(t, true);
            if (files.length) {
              usePlayer.getState().open(files);
              setSelected([INTERNAL]);
            }
          }}
        >
          {t("Open audio file")}
        </Button>
        <Button icon="pauseF" onClick={pauseAll}>
          {t("Pause all")}
        </Button>
        <span className="ts-titlebar__divider" />
        <span className="ts-pill" style={{ borderColor: sel.length ? "var(--accent-line)" : undefined, color: sel.length ? "var(--text)" : undefined }}>
          <Icon name="check" size={11} strokeWidth={2.6} />
          {sel.length ? t("{n} selected", { n: sel.length }) : t("Nothing selected")}
        </span>
        <div className={volOk ? "df-ctl" : "df-ctl df-ctl--off"} role="group" aria-label={t("Volume of the selected sources")}>
          <Icon name="volume" size={15} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("Volume")}</span>
          <Range label={t("Volume")} value={Math.round(volume * 100)} min={0} max={100} onChange={(v) => applyVolume(v / 100)} disabled={!volOk} />
          <span className="mono" style={{ width: 38, textAlign: "right", fontSize: 12, fontWeight: 600 }}>
            {Math.round(volume * 100)}%
          </span>
          <Button variant="sm" icon="reset" disabled={!volOk} onClick={() => applyVolume(1)} title={t("Reset volume to 100%")}>
            100%
          </Button>
        </div>
        <div className={speedOk ? "df-ctl" : "df-ctl df-ctl--off"} role="group" aria-label={t("Speed of the selected sources")} title={speedOk ? undefined : t("Speed works with Diaframma's player and with players that allow it")}>
          <Icon name="gauge" size={15} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("Speed")}</span>
          <Range label={t("Speed")} value={Math.round(speed * 100)} min={50} max={150} onChange={(v) => applySpeed(v / 100)} disabled={!speedOk} />
          <span className="mono" style={{ width: 38, textAlign: "right", fontSize: 12, fontWeight: 600 }}>
            {Math.round(speed * 100)}%
          </span>
          <Button variant="sm" icon="reset" disabled={!speedOk} onClick={() => applySpeed(1)} title={t("Reset speed to 100%")}>
            100%
          </Button>
        </div>
        <span className="ts-spacer" />
        <Button icon="starF" iconColor="var(--sb-fill)" onClick={() => document.getElementById("df-favs")?.scrollIntoView({ behavior: "smooth" })}>
          {t("Favorites")}
          <span className="ts-kbd" style={{ height: 18 }}>
            {settings.favorites.length}
          </span>
        </Button>
      </div>

      <main className="df-rh" onPointerMove={onDragMove} onPointerUp={onDragEnd}>
        <div ref={wrapRef} style={{ position: "relative" }}>
          <div className="df-section-head">
            <span className="ts-label">{t("Sources")}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("{n} playing or paused on this computer", { n: playingCount })}</span>
            <span className="ts-spacer" />
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("Click to select · Ctrl + click to add")}</span>
            <Button variant="ghost" icon="check" onClick={() => setSelected(sources.map((s) => s.id))} style={{ height: 26 }}>
              {t("Select all")}
              <Kbd>Ctrl A</Kbd>
            </Button>
          </div>
          {sources.length ? (
            <div className="df-sources">
              {sources.map((s) => (
                <SourceCard
                  key={s.id}
                  s={s}
                  t={t}
                  selected={selected.includes(s.id)}
                  output={outputFor(s)}
                  onSelect={(add) => setSelected((cur) => (add ? (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]) : [s.id]))}
                  onMedia={(a) => media(s, a)}
                  onStar={() => star(s)}
                  onSeek={s.id === INTERNAL ? (sec) => usePlayer.getState().seek(sec) : undefined}
                  onStartDrag={(x, y) => setDragFrom({ id: s.id, x, y })}
                  wrap={wrapRef}
                />
              ))}
            </div>
          ) : (
            <div className="df-empty">{t("No player is making sound right now. Start Spotify, a browser or a media player, or press Open audio file.")}</div>
          )}

          <div className="df-routing">
            <span style={{ position: "absolute", right: 0, bottom: 10, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-3)" }}>
              <Icon name="info" size={12} />
              {t("Drag the dot under a source onto an output to move it")}
            </span>
          </div>

          <div className="df-section-head" style={{ height: 26 }}>
            <span className="ts-label">{t("Outputs")}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              <span style={{ color: "var(--go)", fontWeight: 600 }}>{t("LIVE")}</span> {t("everyone hears it")} ·{" "}
              <span style={{ color: "var(--pre)", fontWeight: 600 }}>{t("PRE-LISTEN")}</span> {t("only you hear it")}
            </span>
          </div>
          <div className="df-outputs">
            {(snap?.outputs ?? []).map((o) => (
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
          {t("{n} sources", { n: sources.length })} · {t("{n} outputs", { n: snap?.outputs.length ?? 0 })}
        </span>
        {snap && !snap.routingAvailable && snap.supported ? <span>{t("Output per program not available on this Windows")}</span> : null}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="reset" size={12} />
          {t("When Diaframma closes, volumes and outputs go back as they were")}
        </span>
        <span className="ts-spacer" />
        <span>
          <Kbd>Ctrl A</Kbd> {t("select all")} · <Kbd>Esc</Kbd> {t("clear selection")}
        </span>
      </StatusBar>
    </>
  );
}

function SourceCard({
  s,
  t,
  selected,
  output,
  onSelect,
  onMedia,
  onStar,
  onSeek,
  onStartDrag,
  wrap,
}: {
  s: RhSource;
  t: (k: string, v?: Record<string, string | number>) => string;
  selected: boolean;
  output: RhOutput | null;
  onSelect: (add: boolean) => void;
  onMedia: (a: "toggle" | "next" | "prev") => void;
  onStar: () => void;
  onSeek?: (sec: number) => void;
  onStartDrag: (x: number, y: number) => void;
  wrap: React.RefObject<HTMLDivElement | null>;
}) {
  const progress = s.durationSec && s.positionSec !== null ? Math.min(100, (s.positionSec / s.durationSec) * 100) : null;
  return (
    <div
      className="df-source"
      data-source-id={s.id}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(e.ctrlKey)}
    >
      <div className="df-source__head">
        <span className="df-source__glyph" style={s.kind === "internal" ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}>
          <Icon name={KIND_ICON[s.kind]} size={14} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ts-ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }}>
            {s.app}
          </div>
          <div className="ts-ellipsis" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {kindText(t, s)}
          </div>
        </div>
        <span
          className="ts-pill"
          style={
            s.status === "playing"
              ? { borderColor: "var(--go-line)", color: "var(--go)", height: 18 }
              : s.status === "paused"
                ? { borderColor: "var(--sb-line)", color: "var(--sb)", height: 18 }
                : { height: 18 }
          }
        >
          {s.status === "playing" ? t("PLAYING") : s.status === "paused" ? t("PAUSED") : t("IDLE")}
        </span>
      </div>
      <div className="df-source__preview">
        <div className="df-source__thumb">
          {s.thumb ? <img src={s.thumb} alt="" width={56} height={56} style={{ borderRadius: "var(--r-sm)", objectFit: "cover" }} /> : <Icon name={KIND_ICON[s.kind]} size={22} color="var(--text-3)" />}
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
                  e.stopPropagation();
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
      <div className="df-source__controls" onClick={(e) => e.stopPropagation()}>
        <Button variant="sm" iconOnly icon="prevF" aria-label={t("Previous")} title={t("Previous")} disabled={!s.canPrev} onClick={() => onMedia("prev")} />
        <Button variant="sm" iconOnly icon={s.status === "playing" ? "pauseF" : "playF"} aria-label={t("Play / pause")} title={t("Play / pause")} disabled={!s.canToggle} onClick={() => onMedia("toggle")} />
        <Button variant="sm" iconOnly icon="nextF" aria-label={t("Next")} title={t("Next")} disabled={!s.canNext} onClick={() => onMedia("next")} />
        <Button variant="sm" iconOnly icon="star" aria-label={t("Add to favorites")} title={t("Add to favorites")} onClick={onStar} />
        <span className="ts-spacer" />
        {s.volume !== null && Math.round(s.volume * 100) !== 100 ? <span className="ts-pill" style={{ height: 18 }}>{t("Vol {n}%", { n: Math.round(s.volume * 100) })}</span> : null}
        {s.speed !== null && Math.abs(s.speed - 1) > 0.001 ? <span className="ts-pill" style={{ height: 18 }}>{t("Speed {n}%", { n: Math.round(s.speed * 100) })}</span> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
        <span className="ts-ellipsis" style={{ maxWidth: "70%" }}>
          → {output?.name ?? t("Windows default")}
        </span>
      </div>
      <button
        type="button"
        aria-label={t("Drag onto an output")}
        title={t("Drag onto an output")}
        style={{
          position: "absolute",
          left: "50%",
          bottom: -7,
          width: 14,
          height: 14,
          marginLeft: -7,
          borderRadius: "50%",
          border: "2px solid var(--bg)",
          background: "var(--accent)",
          cursor: "grab",
          padding: 0,
          zIndex: 2,
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          const base = wrap.current?.getBoundingClientRect();
          const r = e.currentTarget.getBoundingClientRect();
          if (base) onStartDrag(r.left + r.width / 2 - base.left, r.top + r.height / 2 - base.top);
        }}
      />
    </div>
  );
}

function OutputCard({ o, t, role, onRole, target }: { o: RhOutput; t: (k: string) => string; role: "live" | "pre" | null; onRole: (r: "live" | "pre" | null) => void; target: boolean }) {
  const cls = ["df-output", role === "live" ? "df-output--live" : role === "pre" ? "df-output--pre" : "", target ? "df-output--target" : ""].join(" ");
  return (
    <article className={cls} data-output-id={o.id} aria-label={o.name}>
      <span className={role === "live" ? "df-out-icon df-out-icon--live" : role === "pre" ? "df-out-icon df-out-icon--pre" : "df-out-icon"}>
        <Icon name={role === "pre" ? "headphones" : "speaker"} size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ts-ellipsis" style={{ fontSize: 13, fontWeight: 600 }} title={o.name}>
          {o.name}
        </div>
        <div className="ts-ellipsis" style={{ fontSize: 11, color: "var(--text-3)" }}>
          {role === "live" ? t("everyone hears it") : role === "pre" ? t("only you hear it") : t("No role")}
          {o.isDefault ? ` · ${t("Windows default")}` : ""}
        </div>
      </div>
      <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <select
          className="ts-select"
          style={{ height: 22, fontSize: 11, padding: "0 4px" }}
          value={role ?? ""}
          onChange={(e) => onRole((e.currentTarget.value || null) as "live" | "pre" | null)}
          aria-label={t("Role of this output")}
        >
          <option value="">{t("Set role")}</option>
          <option value="live">{t("LIVE")}</option>
          <option value="pre">{t("PRE-LISTEN")}</option>
        </select>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 72 }} aria-hidden="true">
          {[o.peakL, o.peakR].map((p, i) => (
            <div key={i} style={{ position: "relative", height: 3, borderRadius: 2, background: "var(--surface-3)", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.sqrt(p) * 100)}%`, background: role === "pre" ? "var(--pre)" : "var(--go)" }} />
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function Favorites({ t }: { t: (k: string, v?: Record<string, string | number>) => string }) {
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
