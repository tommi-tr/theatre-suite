import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Icon } from "@theatre-suite/ui";
import { newId } from "../model/defaults";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { useScript } from "../compose/dialogs/common";
import { styleDecl } from "./css";
import { PRESETS, type FormatModel } from "./model";
import { applyModel } from "./formatActions";

function cssObject(decl: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of decl.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** Small page showing how a model writes a speech. */
function ModelSample({ m, lang }: { m: FormatModel; lang: "it" | "en" }) {
  const scale = 0.72;
  const sp = cssObject(styleDecl(m.styles.speaker, { margins: false }));
  const tx = cssObject(styleDecl(m.styles.speech, { margins: false }));
  const ac = cssObject(styleDecl(m.styles.scene, { margins: false }));
  const left = m.speech.namePos === "left";
  const line = lang === "it" ? ["Amleto", "Essere, o non essere: questo è il dilemma."] : ["Hamlet", "To be, or not to be: that is the question."];
  return (
    <div className="bd-model__sample" aria-hidden="true">
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: `${100 / scale}%` }}>
        <div style={{ ...ac, marginBottom: 6 }}>{lang === "it" ? "Scena prima" : "Scene One"}</div>
        <div style={left ? { display: "grid", gridTemplateColumns: "26mm 1fr", columnGap: "3mm" } : {}}>
          <span style={{ ...sp, display: left ? "inline" : "block" }}>{line[0]}</span>
          <span style={tx}>{line[1]}</span>
        </div>
      </div>
    </div>
  );
}

/** Models: the four ready-made ones, the ones you saved, and the current customised format. */
export function ModelsDialog() {
  const t = useT();
  const { view, data } = useScript();
  const userModels = useSettings((s) => s.settings.userModels);
  const [name, setName] = useState("");
  if (!view || !data) return null;
  const current = data.format;
  const close = () => {
    useUi.getState().closeDialog();
    useDoc.getState().view?.focus();
  };
  const choose = (m: FormatModel) => {
    applyModel(view, m);
  };
  const saveCurrent = () => {
    const n = name.trim();
    if (!n) return;
    const model: FormatModel = { ...structuredClone(current), name: n, base: newId("model"), custom: false, watermark: "" };
    useSettings.getState().update({ userModels: [...userModels.filter((x) => x.name !== n), model] });
    applyModel(view, model);
    setName("");
    useUi.getState().showToast(t("Model “{name}” saved: you find it in this window for every script.", { name: n }));
  };
  const presetDesc = (id: string) => t(PRESETS.find((p) => p.id === id)?.descKey ?? "");
  return (
    <Dialog
      title={t("Models")}
      icon="layers"
      description={t("A model sets the style of every element at once. After the first change it becomes “Customised”.")}
      onClose={close}
      width={760}
      footer={
        <>
          <input className="ts-input" style={{ width: 240 }} placeholder={t("Name of the new model")} value={name} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && saveCurrent()} />
          <Button icon="save" onClick={saveCurrent} disabled={!name.trim()}>
            {t("Save as model")}
          </Button>
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={close}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="bd-section-title">{t("Ready-made")}</div>
      <div className="bd-models">
        {PRESETS.map((p) => {
          const m = p.make();
          const on = !current.custom && current.base === p.id;
          return (
            <button key={p.id} type="button" className="bd-model" aria-pressed={on} onClick={() => choose(m)}>
              <ModelSample m={m} lang={data.lang} />
              <span className="bd-model__name">
                {on ? <Icon name="check" size={13} /> : null}
                {m.name}
              </span>
              <span className="bd-model__desc">{presetDesc(p.id)}</span>
            </button>
          );
        })}
        {current.custom ? (
          <button type="button" className="bd-model" aria-pressed>
            <ModelSample m={current} lang={data.lang} />
            <span className="bd-model__name">
              <Icon name="check" size={13} />
              {t("Customised")}
            </span>
            <span className="bd-model__desc">{t("Started from {name}. Save it as a model to use it again.", { name: PRESETS.find((p) => p.id === current.base)?.make().name ?? userModels.find((u) => u.base === current.base)?.name ?? "—" })}</span>
          </button>
        ) : null}
      </div>
      <div className="bd-section-title" style={{ marginTop: 16 }}>
        {t("Saved by you")}
      </div>
      {userModels.length ? (
        <div className="bd-models">
          {userModels.map((m) => {
            const on = !current.custom && current.base === m.base;
            return (
              <div key={m.base} style={{ position: "relative" }}>
                <button type="button" className="bd-model" aria-pressed={on} onClick={() => choose(m)} style={{ width: "100%" }}>
                  <ModelSample m={m} lang={data.lang} />
                  <span className="bd-model__name">
                    {on ? <Icon name="check" size={13} /> : null}
                    {m.name}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  iconOnly
                  icon="trash"
                  aria-label={t("Delete model")}
                  style={{ position: "absolute", right: 6, bottom: 6, width: 26, height: 26 }}
                  onClick={() => useSettings.getState().update({ userModels: userModels.filter((x) => x.base !== m.base) })}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ts-muted">{t("Change the format, then save it here with a name: it will be available for all your scripts.")}</div>
      )}
    </Dialog>
  );
}
