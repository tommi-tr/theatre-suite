import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { AlertBand, Button, Icon, OutputPill, type OutputPillState } from "@theatre-suite/ui";
import type { DmxErrorCode, DmxStatus, LinkState } from "../lib/dmx";
import { useOutput } from "../store/output";
import { useUi } from "../store/ui";
import { useShow } from "../store/show";
import "./output.css";

type T = ReturnType<typeof useT>;

/** "DMX USB Pro · connesso", "Uscita simulata", "Cavo scollegato · riprovo…" */
export function linkLabel(t: T, link: LinkState): string {
  switch (link.state) {
    case "idle":
      return t("Not connected");
    case "connecting":
      return t("Connecting…");
    case "connected":
      return link.kind === "pro" ? t("DMX USB Pro · connected") : t("Open DMX · connected");
    case "simulated":
      return t("Simulated output");
    case "lost":
      return t("Cable unplugged · retrying…");
    case "error":
      return t("Not connected");
  }
}

export const kindLabel = (t: T, kind: "pro" | "open") => (kind === "pro" ? t("Pro (with its own processor)") : t("Open DMX (simple FTDI cable)"));

function seconds(t: T, ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? t("{n} s", { n: s }) : t("{n} min", { n: Math.floor(s / 60) });
}

/** Re-renders every second while `on` (for "da 12 s"). */
function useTicking(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setN((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [on]);
}

/** What went wrong with "Connetti", in plain words. */
export function problemText(t: T, code: DmxErrorCode): { title: string; text: string } {
  switch (code) {
    case "noCable":
      return {
        title: t("No USB-DMX cable found"),
        text: t("Plug the cable into a USB port of the computer and press Connect again. The first time, Windows downloads the driver by itself from Windows Update: it can take a minute."),
      };
    case "notFound":
      return { title: t("The chosen cable is not there"), text: t("Check that the cable is plugged in, or choose “Automatic choice” in Settings → DMX output.") };
    case "busy":
      return { title: t("The cable is used by another program"), text: t("Close the other lighting programs (or anything else that uses the cable) and try again.") };
    case "openFailed":
      return { title: t("The cable does not answer"), text: t("Unplug the cable, plug it back in and try again. If it keeps happening, look at the list in Settings → DMX output.") };
    case "chooseCable":
      return {
        title: t("Which one is the DMX cable?"),
        text: t("There are several USB adapters that could be the cable and none answered by itself. Choose it in Settings → DMX output, then press Connect."),
      };
    case "engineStopped":
      return {
        title: t("The DMX output stopped after an internal error"),
        text: t("The lights keep their last state. Granvelo restarted the output without sending anything: press Connect to go on."),
      };
  }
}

function Popover({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="gv-out-pop" role="dialog">
      {children}
    </div>
  );
}

function Facts({ status }: { status: DmxStatus }) {
  const t = useT();
  const live = useOutput((s) => s.live);
  const link = status.link;
  const d = status.device;
  const rows: [string, ReactNode][] = [];
  if (d) rows.push([t("Device"), `${d.name}${d.manufacturer && !d.name.includes(d.manufacturer) ? ` · ${d.manufacturer}` : ""} · ${d.port}`]);
  if (link.state === "connected" || link.state === "lost") rows.push([t("Type"), kindLabel(t, link.kind)]);
  if (status.detail) rows.push([t("Details"), status.detail]);
  if (link.state === "connected" || link.state === "simulated") rows.push([t("Updates"), t("{n} per second", { n: Math.round(live.fps) })]);
  if (!rows.length) return null;
  return (
    <dl className="gv-out-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Top bar, left: the state of the DMX output, "Connetti", and a small panel with the details. */
export function OutputChip() {
  const t = useT();
  const status = useOutput((s) => s.status);
  const problemOpen = useOutput((s) => s.problemOpen);
  const locked = useShow((s) => s.locked);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void useOutput.getState().init();
  }, []);
  const link = status.link;
  useTicking(open && link.state === "lost");
  const out = useOutput.getState();
  const settings = () => {
    setOpen(false);
    out.setProblemOpen(false);
    useUi.getState().openSettings("dmx");
  };
  const run = (fn: () => Promise<void>) => () => {
    setOpen(false);
    fn().catch((e) => useUi.getState().showToast(String(e), "error"));
  };

  if (link.state === "idle" || link.state === "error") {
    const problem = link.state === "error" ? problemText(t, link.code) : null;
    return (
      <div className="gv-out">
        <Button icon="plug" className="gv-out-connect" title={t("Connect the USB-DMX cable. Until then nothing is sent to the lights.")} onClick={run(() => out.connect())}>
          {t("Connect")}
        </Button>
        {problem && problemOpen ? (
          <Popover onClose={() => out.setProblemOpen(false)}>
            <div className="gv-out-pop__head">
              <span className="ts-dot ts-dot--stop" />
              <strong>{problem.title}</strong>
            </div>
            <p className="gv-out-pop__text">{problem.text}</p>
            {link.state === "error" && link.code !== "noCable" ? <p className="gv-out-pop__detail">{link.message}</p> : null}
            <div className="gv-out-pop__actions">
              <Button variant="primary" icon="reset" onClick={run(() => out.connect())}>
                {t("Try again")}
              </Button>
              <Button icon="monitor" onClick={run(() => out.useSimulated())}>
                {t("Use the simulated output")}
              </Button>
            </div>
            <button type="button" className="gv-out-pop__link" onClick={settings}>
              <Icon name="settings" size={13} />
              {t("Output settings…")}
            </button>
          </Popover>
        ) : null}
      </div>
    );
  }

  const dot = link.state === "connected" ? "ts-dot--go" : link.state === "lost" ? "ts-dot--stop" : "";
  const pill: OutputPillState = link.state === "connected" ? "ok" : link.state === "lost" ? "stop" : "idle";
  return (
    <div className="gv-out">
      <OutputPill state={pill} busy={link.state === "connecting"} open={open} label={linkLabel(t, link)} aria-haspopup="dialog" title={t("DMX output")} onClick={() => setOpen((v) => !v)} />
      {open ? (
        <Popover onClose={() => setOpen(false)}>
          <div className="gv-out-pop__head">
            <span className={`ts-dot ${dot}`} />
            <strong>{linkLabel(t, link)}</strong>
          </div>
          {link.state === "simulated" ? (
            <p className="gv-out-pop__text">{t("No cable: Granvelo works as if there were one, but sends nothing to the lights.")}</p>
          ) : null}
          {link.state === "lost" ? (
            <p className="gv-out-pop__text">
              {t("The cable was unplugged {time} ago. Granvelo tries to reconnect it every second (attempts: {n}). Plug it back into the same or another USB port.", {
                time: seconds(t, Date.now() - link.sinceMs),
                n: link.attempts,
              })}
            </p>
          ) : null}
          {link.state === "connecting" ? <p className="gv-out-pop__text">{t("Granvelo is looking for the cable and asking it what type it is.")}</p> : null}
          <Facts status={status} />
          <div className="gv-out-pop__actions">
            {link.state === "simulated" ? (
              <Button variant="primary" icon="plug" onClick={run(() => out.connect())}>
                {t("Connect the cable")}
              </Button>
            ) : null}
            <Button icon="x" disabled={locked} title={locked ? t("Lock is on: hold the Lock button or press Ctrl L to unlock.") : undefined} onClick={run(() => out.disconnect())}>
              {t("Disconnect")}
            </Button>
          </div>
          <button type="button" className="gv-out-pop__link" onClick={settings}>
            <Icon name="settings" size={13} />
            {t("Output settings…")}
          </button>
        </Popover>
      ) : null}
    </div>
  );
}

/** Red band under the top bar while the cable is lost. */
export function OutputBanner() {
  const t = useT();
  const link = useOutput((s) => s.status.link);
  if (link.state !== "lost") return null;
  return (
    <AlertBand
      tone="stop"
      title={t("USB-DMX cable unplugged.")}
      action={{ label: t("Output settings…"), icon: "settings", onClick: () => useUi.getState().openSettings("dmx") }}
    >
      {t("Granvelo keeps trying to reconnect it; as soon as it is back, the lights get the current state at once.")}
    </AlertBand>
  );
}
