import { useState } from "react";
import { basename, useT } from "@theatre-suite/core";
import { AppLogo, Button, Icon } from "@theatre-suite/ui";
import { isDemo } from "../lib/api";
import { createDoc, openDemo, openDocDialog, openRecent } from "../lib/files";
import { LOGO } from "../lib/version";
import { useSettings } from "../store/settings";

/** No show open: "Da dove vuoi iniziare?" — a new show, a .tcue file, or one of the recent ones. */
export function StartScreen() {
  const t = useT();
  const [title, setTitle] = useState("");
  const recent = useSettings((s) => s.settings.recentFiles);
  return (
    <div className="cue-start">
      <div className="cue-start__inner">
        <header className="cue-start__head">
          <AppLogo accentPath="" accentDots={LOGO.dots} inkPath={LOGO.ink} label="Cue" size={48} strokeWidth={LOGO.stroke(48)} />
          <div>
            <h1>{t("Where do you want to start?")}</h1>
            <p>{t("Cue is the digital prompt book of the show: the script with its GOs, and the command of lights, sound and images during the performance.")}</p>
          </div>
        </header>
        <div className="cue-start__cards">
          <section className="cue-startcard cue-startcard--main">
            <span className="cue-startcard__icon">
              <Icon name="fileAdd" size={20} />
            </span>
            <h2 className="cue-startcard__title">{t("New show")}</h2>
            <label className="ts-field">
              <span className="ts-label">{t("Title of the show")}</span>
              <input
                className="ts-input"
                value={title}
                maxLength={200}
                placeholder={t("For example: La locandiera")}
                onChange={(e) => setTitle(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && createDoc(title)}
              />
              <span className="ts-field__hint">{t("The script, the GOs and the rest come after, in Prepare.")}</span>
            </label>
            <div className="cue-startcard__foot">
              <Button variant="primary" icon="check" onClick={() => createDoc(title)}>
                {t("Create the show")}
              </Button>
            </div>
          </section>
          <div className="cue-start__col">
            <button type="button" className="cue-startcard cue-startcard--btn" onClick={() => void openDocDialog(t)}>
              <span className="cue-startcard__icon">
                <Icon name="folderOpen" size={20} />
              </span>
              <span className="cue-startcard__title">{t("Open a .tcue file")}</span>
              <span className="cue-startcard__text">{t("A show saved before, on this computer or on a USB stick, or created by the Theatre Suite launcher.")}</span>
            </button>
            {isDemo ? (
              <button type="button" className="cue-startcard cue-startcard--btn" onClick={() => void openDemo()}>
                <span className="cue-startcard__icon">
                  <Icon name="sparkle" size={20} />
                </span>
                <span className="cue-startcard__title">{t("Open the demo show")}</span>
                <span className="cue-startcard__text">{t("La locandiera / Serata: to look around without touching anything of yours.")}</span>
              </button>
            ) : null}
          </div>
        </div>
        <div className="cue-start__recent">
          <div className="ts-label">{t("Recent")}</div>
          {recent.length ? (
            <ul>
              {recent.slice(0, 5).map((p) => (
                <li key={p}>
                  <button type="button" className="cue-recent" title={p} onClick={() => void openRecent(t, p)}>
                    <Icon name="file" size={14} />
                    <span className="ts-ellipsis">{basename(p).replace(/\.tcue$/i, "")}</span>
                    <span className="ts-muted ts-ellipsis cue-recent__path">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ts-muted cue-start__none">{t("The shows you open appear here.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
