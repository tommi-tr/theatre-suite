import { useEffect, useRef, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, HoldButton, Icon, Kbd } from "@theatre-suite/ui";
import { linkApi, type ChatMessage } from "../lib/link";
import { linkPanel, reservationView, type LinkInfo, type LinkPanel as Panel } from "../model/link";
import { useLink } from "../store/link";
import { useSettings } from "../store/settings";
import { actionKeyText } from "./keys";
import { useUi } from "../store/ui";
import "./linkpanel.css";

/** The panel for the current link, re-computed every second while the link is lost ("Scollegato da 0:04" counts). */
export function useLinkPanel(): { info: LinkInfo; panel: Panel } {
  const t = useT();
  const lang = useLang();
  const info = useLink((s) => s.info);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (info.status !== "lost") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [info.status]);
  return { info, panel: linkPanel(info, t, lang, now) };
}

const COLOR: Record<string, string> = { go: "var(--go)", amber: "#ffb224", red: "#ff5f5f", blue: "#4fa8ff" };

/** Show, right side (200 px): the whole panel takes the colour of the link state. */
export function LinkPanel() {
  const t = useT();
  const { info, panel } = useLinkPanel();
  const active = info.role !== "none";
  const onButton = () => {
    const api = linkApi();
    if (panel.button?.action === "unavailable") void api.request({ kind: "unavailable" });
    else void api.takeCommands(panel.button?.action === "takeCommands");
  };
  return (
    <aside className="cue-panel cue-link" data-tone={panel.tone} data-filled={panel.filled ? "1" : undefined} data-ink={panel.ink} aria-label={t("Link")}>
      {panel.heading ? <div className="cue-link__who">{panel.heading}</div> : <div className="cue-link__who">{t("Second computer")}</div>}
      <div className="cue-link__state">
        <span className="cue-link__dot" />
        <span className="cue-link__title">{panel.title}</span>
      </div>
      <p className={panel.detailStrong ? "cue-link__detail cue-link__detail--strong" : "cue-link__detail"}>{panel.detail}</p>
      {panel.button ? (
        <button type="button" className="cue-link__btn" onMouseDown={(e) => e.preventDefault()} onClick={onButton}>
          {panel.button.label}
        </button>
      ) : null}
      {!active ? (
        <Button variant="sm" icon="link" onClick={() => useUi.getState().openSettings("link")}>
          {t("Set up the link…")}
        </Button>
      ) : null}
      {active ? <Chat /> : <div className="cue-link__fill" />}
    </aside>
  );
}

function Chat() {
  const t = useT();
  const lang = useLang();
  const chat = useLink((s) => s.chat);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length]);
  const send = (msg: string, quick: boolean) => {
    const m = msg.trim();
    if (m) void linkApi().chat(m, quick);
  };
  const time = (at: number) => new Date(at).toLocaleTimeString(lang === "it" ? "it-IT" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  const role = (m: ChatMessage) => (m.from === "primary" ? t("Primary") : t("Secondary"));
  return (
    <>
      <div className="cue-link__chathead">{t("Chat")}</div>
      <div className="cue-link__msgs" aria-live="polite">
        {chat.map((m) => (
          <div key={m.id} className={`cue-link__msg${m.mine ? " cue-link__msg--mine" : ""}`}>
            {m.quick && m.mine ? null : <span className="cue-link__meta">{`${m.name || role(m)} · ${time(m.at)}`}</span>}
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="cue-link__quick">
        {/* Quick messages (13_cue.md); the text sent is in the sender's language. */}
        {[t("Standby"), t("Actors ready"), t("Wait"), t("Ok"), t("Delay 5 min")].map((q) => (
          <button key={q} type="button" className="cue-link__chip" onMouseDown={(e) => e.preventDefault()} onClick={() => send(q, true)}>
            {q}
          </button>
        ))}
      </div>
      <input
        className="cue-link__input"
        value={text}
        placeholder={t("Write…")}
        aria-label={t("Write…")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            send(text, false);
            setText("");
          }
        }}
      />
    </>
  );
}

/** The 6 px border of the screen in the colour of the link, only when a secondary is involved. */
export function LinkBorder() {
  const { panel } = useLinkPanel();
  if (!panel.border) return null;
  const color = COLOR[panel.border.tone];
  return <div className="cue-linkborder" style={{ borderColor: `color-mix(in srgb, ${color} ${Math.round(panel.border.opacity * 100)}%, transparent)` }} aria-hidden="true" />;
}

/** Secondary "Non disponibile": a veil over the screen, a blue card, back with a long press. */
export function UnavailableVeil() {
  const t = useT();
  const { info, panel } = useLinkPanel();
  if (!panel.veil || info.role !== "secondary") return null;
  return (
    <div className="cue-unavail" role="dialog" aria-label={panel.veil.title}>
      <div className="cue-unavail__card">
        <Icon name="link" size={18} />
        <b>{panel.veil.title}</b>
        <span>{t("The primary knows you are not available: it carries on alone.")}</span>
        <HoldButton className="ts-btn cue-unavail__hold" onHold={() => void linkApi().request({ kind: "available" })} ariaLabel={panel.veil.hold}>
          {panel.veil.hold}
        </HoldButton>
      </div>
    </div>
  );
}

/** Blue band above the columns while this computer holds the reservation (key C held). */
export function ReservationBand() {
  const t = useT();
  const info = useLink((s) => s.info);
  const keymap = useSettings((s) => s.settings.keymap);
  const v = reservationView(info, t);
  if (!v.ribbon) return null;
  const key = actionKeyText(keymap, "reserve");
  return (
    <div className="cue-showband cue-showband--pre" role="status">
      <Icon name="lock" size={15} />
      <strong>{v.ribbon}</strong>
      {key ? <Kbd>{key}</Kbd> : null}
    </div>
  );
}
