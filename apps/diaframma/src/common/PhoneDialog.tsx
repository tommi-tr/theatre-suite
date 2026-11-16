import { useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, Switch } from "@theatre-suite/ui";
import { api, isTauri, type PhoneInfo } from "../lib/api";
import { useSettings } from "../state/settings";

export function PhoneDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const enabled = useSettings((s) => s.settings.phoneEnabled);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    const load = () => api.phoneInfo().then(setInfo).catch(() => {});
    load();
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, [enabled]);
  const toggle = async (on: boolean) => {
    useSettings.getState().update({ phoneEnabled: on });
    if (isTauri) setInfo(await api.phoneEnable(on).catch(() => null));
  };
  return (
    <Dialog
      title={t("Phone remote")}
      icon="phone"
      onClose={onClose}
      width={600}
      description={t("Press GO, move standby, pause and stop from your phone. The phone must be on the same Wi-Fi as this computer.")}
      footer={
        <>
          <span className="ts-muted" style={{ fontSize: 11.5 }}>
            {t("Nothing leaves your local network.")}
          </span>
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={onClose}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="df-set-row" style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("Phone remote")}</div>
          <div className="ts-field__hint">{t("The first time, Windows asks to allow Diaframma on private networks: answer Allow.")}</div>
        </div>
        <Switch checked={enabled} onChange={toggle} label={t("Phone remote")} />
      </div>
      {enabled && info ? (
        <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 14 }}>
          <div
            style={{ flex: "none", width: 200, height: 200, borderRadius: 12, overflow: "hidden", background: "#fff", padding: 6 }}
            aria-label={t("QR code")}
            dangerouslySetInnerHTML={{ __html: info.qrSvg.replace(/<svg /, '<svg width="100%" height="100%" ') }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div>
              <div className="ts-label">{t("1 · Scan with the phone camera")}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4 }}>{t("Or type this address in the phone's browser:")}</div>
              <div className="mono" style={{ fontSize: 12.5, marginTop: 4, userSelect: "text", wordBreak: "break-all" }}>
                {info.url}
              </div>
            </div>
            <div>
              <div className="ts-label">{t("Access code")}</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "0.12em", marginTop: 2 }}>
                {info.code}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Button variant="sm" icon="reset" onClick={async () => setInfo(await api.phoneNewCode())} title={t("Phones that used the old code are disconnected")}>
                {t("New code")}
              </Button>
              <Button variant="sm" icon="copy" onClick={() => navigator.clipboard.writeText(info.url).catch(() => {})}>
                {t("Copy address")}
              </Button>
            </div>
            {info.error ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--stop)", fontSize: 12 }}>
                <Icon name="alert" size={13} />
                {info.error}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="ts-muted" style={{ marginTop: 14 }}>
          {t("The phone remote is off. Turn it on to show the QR code.")}
        </p>
      )}
    </Dialog>
  );
}
