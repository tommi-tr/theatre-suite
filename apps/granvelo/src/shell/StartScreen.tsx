import { useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { AppLogo, Button, Icon } from "@theatre-suite/ui";
import { StageSizeFields } from "../common/StageSizeFields";
import { api, isTauri } from "../lib/api";
import { createDoc, openDemo, openDocDialog, openDocPath } from "../lib/files";
import { LOGO } from "../lib/version";
import { DEFAULT_STAGE, type Stage } from "../model/types";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

/** No show open: start a new one (with the size of the stage), open one, or try the demo show. */
export function StartScreen() {
  const t = useT();
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<Stage>({ ...DEFAULT_STAGE });
  const recent = useSettings((s) => s.settings.recentFiles);
  return (
    <div className="gv-start">
      <div className="gv-start__inner">
        <header className="gv-start__head">
          <AppLogo accentPath={LOGO.accent} inkPath={LOGO.ink} label="Granvelo" size={48} strokeWidth={LOGO.stroke(48)} />
          <div>
            <h1>{t("The lights of your show")}</h1>
            <p>{t("Draw the stage with its lights, command them from a virtual desk and play the memories during the show.")}</p>
          </div>
        </header>
        <div className="gv-start__cards">
          <section className="gv-startcard gv-startcard--main">
            <span className="gv-startcard__icon">
              <Icon name="fileAdd" size={20} />
            </span>
            <h2 className="gv-startcard__title">{t("New show")}</h2>
            <label className="ts-field">
              <span className="ts-label">{t("Title of the show")}</span>
              <input className="ts-input" value={title} maxLength={200} placeholder={t("For example: La locandiera")} onChange={(e) => setTitle(e.currentTarget.value)} />
            </label>
            <div className="ts-field">
              <span className="ts-label">{t("Stage (metres)")}</span>
              <StageSizeFields stage={stage} onChange={setStage} />
              <span className="ts-field__hint">{t("You can change it later.")}</span>
            </div>
            <div className="gv-startcard__foot">
              <Button variant="primary" icon="check" onClick={() => createDoc(title, stage)}>
                {t("Create the show")}
              </Button>
            </div>
          </section>
          <div className="gv-start__col">
            <button type="button" className="gv-startcard gv-startcard--btn" onClick={() => void openDocDialog(t)}>
              <span className="gv-startcard__icon">
                <Icon name="folderOpen" size={20} />
              </span>
              <span className="gv-startcard__title">{t("Open a show…")}</span>
              <span className="gv-startcard__text">{t("A .granvelo file saved before, on this computer or on a USB stick.")}</span>
            </button>
            <button type="button" className="gv-startcard gv-startcard--btn" onClick={() => void openDemo(t)}>
              <span className="gv-startcard__icon">
                <Icon name="sparkle" size={20} />
              </span>
              <span className="gv-startcard__title">{t("Open the demo show")}</span>
              <span className="gv-startcard__text">{t("La locandiera: 15 lights, 9 memories, to look around without touching anything of yours.")}</span>
            </button>
          </div>
        </div>
        {recent.length ? (
          <div className="gv-start__recent">
            <div className="ts-label">{t("Recent")}</div>
            <ul>
              {recent.slice(0, 5).map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    className="gv-recent"
                    title={p}
                    onClick={async () => {
                      if (isTauri && !(await api.pathExists(p))) {
                        useSettings.getState().removeRecent(p);
                        useUi.getState().showToast(t("{name} is no longer there: removed from the list.", { name: basename(p) }), "error");
                        return;
                      }
                      await openDocPath(t, p);
                    }}
                  >
                    <Icon name="file" size={14} />
                    <span className="ts-ellipsis">{basename(p).replace(/\.granvelo$/i, "")}</span>
                    <span className="ts-muted ts-ellipsis gv-recent__path">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
