import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { ComingSoon, SoonPill } from "../common/ComingSoon";
import { useDoc } from "../store/doc";

/**
 * Prepara: libraries on the left, the script with its GOs in the centre, the selected GO on the right (0.3).
 * In 0.1: the first step, "Carica il copione" (disabled until 0.2), and what comes next.
 */
export function PrepareMode() {
  const t = useT();
  const script = useDoc((s) => s.show?.script ?? null);
  return (
    <div className="cue-mode">
      <div className="cue-mode__inner cue-mode__inner--two">
        <section className="cue-first">
          <div className="ts-soon__head">
            <span className="cue-first__icon">
              <Icon name="pages" size={22} />
            </span>
            {script ? null : <SoonPill version="0.2" />}
          </div>
          {script ? (
            <>
              <h2>{t("This show already has its script")}</h2>
              <p>
                {script.kind === "pdf"
                  ? t("{name} · {n} pages. Cue 0.2 shows it here, with zoom, peek and notes.", { name: script.name || "script.pdf", n: script.pages })
                  : t("A Bardo script. Cue shows it here in a later version.")}
              </p>
            </>
          ) : (
            <>
              <h2>{t("Load the script")}</h2>
              <p>{t("One PDF: the script or the score. It goes inside the show file and Cue never changes it; underlines and comments already in the PDF stay visible.")}</p>
              <div className="cue-first__actions">
                <Button variant="primary" icon="upload" disabled title={t("Coming with Cue {v}", { v: "0.2" })}>
                  {t("Load the script…")}
                </Button>
              </div>
            </>
          )}
        </section>
        <ComingSoon
          icon="pencil"
          version="0.3"
          title={t("Then: the GOs on the script")}
          about={[
            t("Libraries on the left: Granvelo memories, Diaframma tracks, images and videos."),
            t("Drag them onto the script to create a GO; things on the same point become one GO."),
            t("On the right the selected GO: its actions and times, who gives it, speed zone, notes."),
          ]}
        >
          {t("Meanwhile prepare lights and sound in Granvelo and Diaframma: Cue reads their files, it does not copy them.")}
        </ComingSoon>
      </div>
    </div>
  );
}
