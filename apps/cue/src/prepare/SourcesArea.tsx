import { useState } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, StatusLight, type LightState } from "@theatre-suite/ui";
import { sourceStatusText } from "../lib/sources";
import { baseName, type LoadedSource, type SourceLink } from "../model/sources";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { acknowledgeSource } from "./actions";
import { SourceLogo } from "./SourceLogo";
import { confirmRemoveSource, findSourceFile, pickAndLinkSources } from "./sourcesFlow";

/** How a linked file is doing: the light, a short word, and whether it needs the user. */
export function sourceLight(t: TFunc, s: LoadedSource | undefined): { state: LightState; label: string; problem: boolean } {
  if (!s) return { state: "info", label: t("Reading the file…"), problem: false };
  switch (s.status.state) {
    case "ok":
      return s.status.changed ? { state: "warn", label: t("Changed"), problem: true } : { state: "ok", label: t("OK"), problem: false };
    case "missing":
      return { state: "warn", label: t("Not found"), problem: true };
    case "unreadable":
      return { state: "stop", label: t("Cannot be read"), problem: true };
    case "wrongFormat":
      return { state: "stop", label: t("Wrong format"), problem: true };
    case "newer":
      return { state: "warn", label: t("Too new"), problem: true };
    case "otherDocument":
      return { state: "warn", label: t("Other show"), problem: true };
    case "unsupported":
      return { state: "info", label: t("Later"), problem: false };
  }
}

/**
 * "File collegati": the Diaframma and Granvelo files the show takes its memories and tracks from, at the top of
 * the library. Folded when all is well, open when something needs the user (a missing file, a changed one).
 */
export function SourcesArea() {
  const t = useT();
  const links = useDoc((s) => (s.show?.sources ?? []) as SourceLink[]);
  const library = useLibrary((s) => s.library);
  const lights = links.map((l) => sourceLight(t, library.source(l.id)));
  const problems = lights.filter((l) => l.problem).length;
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? (links.length === 0 || problems > 0);
  const worst: LightState = lights.some((l) => l.state === "stop") ? "stop" : problems ? "warn" : "ok";
  return (
    <section className="cue-src" aria-label={t("Linked files")}>
      <div className="cue-src__head">
        <button type="button" className="cue-src__toggle" aria-expanded={open} onClick={() => setManual(!open)}>
          <Icon name={open ? "chevDown" : "chevRight"} size={12} />
          <span className="ts-label">{t("Linked files")}</span>
          {links.length ? <span className="cue-src__count">{links.length}</span> : null}
          {!open && links.length ? <span className={`ts-dot ts-dot--${worst === "ok" ? "go" : worst === "warn" ? "sb" : "stop"}`} aria-hidden="true" /> : null}
        </button>
        <Button variant="ghost" iconOnly icon="plus" title={t("Link Diaframma or Granvelo files")} aria-label={t("Link Diaframma or Granvelo files")} onClick={() => void pickAndLinkSources(t)} />
      </div>
      {open ? (
        links.length === 0 ? (
          <p className="cue-src__empty">{t("No file linked yet. Link a Granvelo file for the light memories and a Diaframma file for the sound tracks.")}</p>
        ) : (
          <ul className="cue-src__list">
            {links.map((l, i) => (
              <SourceRow key={l.id} link={l} loaded={library.source(l.id)} light={lights[i]} />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

function SourceRow({ link, loaded, light }: { link: SourceLink; loaded: LoadedSource | undefined; light: ReturnType<typeof sourceLight> }) {
  const t = useT();
  const name = loaded?.title || link.name || baseName(link.path);
  const text = loaded ? sourceStatusText(t, loaded) : "";
  const missing = loaded?.status.state === "missing";
  return (
    <li className="cue-src__row">
      <div className="cue-src__line">
        <SourceLogo app={link.app} />
        <span className="cue-src__name ts-ellipsis" title={link.path}>
          {name}
        </span>
        <StatusLight state={light.state} label={light.label} />
        <Button
          variant="ghost"
          iconOnly
          icon="x"
          title={t("Remove the link")}
          aria-label={`${t("Remove the link")}: ${name}`}
          onClick={() => void confirmRemoveSource(t, link.id, name)}
        />
      </div>
      {light.problem && text ? <p className={`cue-src__msg cue-src__msg--${light.state}`}>{text}</p> : null}
      {light.problem ? (
        <div className="cue-src__actions">
          {missing || loaded?.status.state === "otherDocument" || loaded?.status.state === "wrongFormat" || loaded?.status.state === "unreadable" ? (
            <Button variant="sm" icon="folderOpen" onClick={() => void findSourceFile(t, link.id, link.app)}>
              {t("Find…")}
            </Button>
          ) : null}
          {loaded?.status.changed || loaded?.status.state === "otherDocument" ? (
            <Button variant="sm" icon="check" onClick={() => acknowledgeSource(link.id)}>
              {t("I checked it")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
