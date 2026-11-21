import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { AlertBand, Button, Segmented, SettingsRow as Row, SettingsSection, Switch } from "@theatre-suite/ui";
import { linkApi } from "../lib/link";
import { splitCode, type LinkRole } from "../model/link";
import { useLink } from "../store/link";
import { useUi } from "../store/ui";
import "./settings.css";

/** Settings → Collegamento: role, firewall explanation (before the first listen), pairing, Wi-Fi backup. */
export function LinkPane() {
  const t = useT();
  const info = useLink((s) => s.info);
  const instance = useUi((s) => s.instance);
  // A role chosen but not confirmed yet: the firewall explanation comes first.
  const [asking, setAsking] = useState<LinkRole | null>(null);
  const api = linkApi();
  const choose = (role: LinkRole, confirmed = false) => {
    if (!confirmed && role !== "none" && !info.firewallNoticeSeen) return setAsking(role);
    setAsking(null);
    void api.configure({ role });
  };
  const shown = asking ?? info.role;
  return (
    <>
      <SettingsSection title={t("Primary and secondary")} description={t("A second computer can lead the same show as an equal: every request goes through the primary.")}>
        <Row label={t("This computer is")} hint={t("Primary: the control computer, it runs everything. Secondary: the second screen and keyboard, it asks the primary.")}>
          <Segmented<LinkRole>
            small
            ariaLabel={t("This computer is")}
            value={shown}
            onChange={(r) => choose(r)}
            options={[
              { value: "none", label: t("None") },
              { value: "primary", label: t("Primary") },
              { value: "secondary", label: t("Secondary") },
            ]}
          />
        </Row>
        {asking ? (
          <div className="cue-firewall" role="group" aria-label={t("Windows will ask for permission")}>
            <b>{t("Windows will ask for permission")}</b>
            <p>{t("The first time, Windows will ask whether Cue may use the network. Choose Private networks and press Allow. Cue does not change the firewall by itself, and talks only to the paired computer.")}</p>
            <div className="cue-firewall__actions">
              <Button variant="primary" onClick={() => choose(asking, true)}>
                {t("Got it, turn it on")}
              </Button>
              <Button onClick={() => setAsking(null)}>{t("Cancel")}</Button>
            </div>
          </div>
        ) : null}
        {info.error ? (
          <AlertBand tone="stop" title={info.error === "portBusy" ? t("The network port is in use.") : t("The link could not start.")}>
            {info.error === "portBusy" ? t("Another program (or another copy of Cue) is using it.") : info.error}
          </AlertBand>
        ) : null}
      </SettingsSection>
      {info.role === "primary" ? <PrimarySection /> : info.role === "secondary" ? <SecondarySection /> : null}
      {info.role !== "none" ? (
        <SettingsSection title={t("Backup")}>
          <Row label={t("Backup Wi-Fi")} hint={t("Messages also travel over Wi-Fi if the cable fails; duplicates are discarded. Off by default.")}>
            <Switch checked={info.wifiBackup} label={t("Backup Wi-Fi")} onChange={(wifiBackup) => void api.configure({ wifiBackup })} />
          </Row>
        </SettingsSection>
      ) : null}
      {instance > 1 ? (
        <SettingsSection title={t("Two copies on this computer")}>
          <p className="ts-muted cue-link-hint">{t("Try two copies on this computer: this one is instance {n}. Open the other one without --instance (or with another number), make one Primary and the other Secondary.", { n: instance })}</p>
        </SettingsSection>
      ) : null}
    </>
  );
}

function PrimarySection() {
  const t = useT();
  const info = useLink((s) => s.info);
  const api = linkApi();
  const paired = info.pairedWith;
  return (
    <SettingsSection title={t("Pairing")}>
      {paired ? (
        <Row label={t("Paired with {name}", { name: paired })} hint={info.status === "none" ? t("Looking for the secondary…") : undefined}>
          <Button onClick={() => void api.forget()}>{t("Forget")}</Button>
        </Row>
      ) : (
        <div className="cue-pair">
          <span className="ts-muted">{t("Type this code on the secondary")}</span>
          <span className="cue-pair__code mono" aria-label={t("Pairing code")}>
            {info.pairingCode ? splitCode(info.pairingCode) : "······"}
          </span>
          <Button icon="reset" onClick={() => void api.newCode()}>
            {t("New code")}
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function SecondarySection() {
  const t = useT();
  const info = useLink((s) => s.info);
  const api = linkApi();
  const [code, setCode] = useState("");
  const [ip, setIp] = useState(info.manualPeer ?? "");
  const paired = info.pairedWith;
  const err =
    info.pairingError === "code" ? t("Wrong code. Check the numbers on the primary.") : info.pairingError === "attempts" ? t("Too many wrong codes: the primary shows a new one.") : info.pairingError === "busy" ? t("The primary is already paired with another computer.") : info.pairingError === "noAnswer" ? t("The primary did not answer.") : null;
  if (paired)
    return (
      <SettingsSection title={t("Pairing")}>
        <Row label={t("Paired with {name}", { name: paired })} hint={info.status === "none" ? t("Looking for the primary…") : undefined}>
          <Button onClick={() => void api.forget()}>{t("Forget")}</Button>
        </Row>
      </SettingsSection>
    );
  return (
    <SettingsSection title={t("Pairing")}>
      <Row label={t("Primary found")} hint={info.found ? undefined : t("Choose Primary on the other computer")}>
        {info.found ? (
          <span>
            <b>{info.found.name}</b> <span className="ts-muted mono">{info.found.address}</span>
          </span>
        ) : (
          <span className="ts-muted">{t("Looking for the primary…")}</span>
        )}
      </Row>
      <Row label={t("Code of the primary")} hint={info.found && !info.found.pairing ? t("The primary is not showing a code: press “New code” there.") : t("6 digits, shown on the primary.")}>
        <span className="cue-pair__entry">
          <input
            className="ts-input mono cue-pair__input"
            inputMode="numeric"
            maxLength={7}
            placeholder="000 000"
            value={code}
            aria-label={t("Code of the primary")}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.replace(/\D/g, "").length === 6) void api.enterCode(code.replace(/\D/g, ""));
            }}
          />
          <Button variant="primary" disabled={code.replace(/\D/g, "").length !== 6} onClick={() => void api.enterCode(code.replace(/\D/g, ""))}>
            {t("Pair")}
          </Button>
        </span>
      </Row>
      {err ? <AlertBand tone="warn">{err}</AlertBand> : null}
      <Row label={t("Primary not found?")} hint={t("Type its address (shown in its network settings, like 169.254.20.7).")}>
        <span className="cue-pair__entry">
          <input className="ts-input mono cue-pair__input" placeholder="169.254.20.7" value={ip} aria-label={t("Address of the primary")} onChange={(e) => setIp(e.target.value)} />
          <Button onClick={() => void api.configure({ manualPeer: ip.trim() })}>{ip.trim() ? t("Use this address") : t("Search by itself")}</Button>
        </span>
      </Row>
    </SettingsSection>
  );
}
