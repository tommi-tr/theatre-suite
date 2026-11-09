import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { SHOW_COLORS, showColor } from "../lib/color";
import { pickImage } from "../lib/pick";
import { explain } from "../lib/text";
import { useStore } from "../state/store";
import { ShowCover } from "../components/ShowCover";

const W = 1600;
const H = 800;

/** Loads a picture and cuts it to the cover format (centred), as a small JPEG. */
async function toCoverJpeg(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The picture cannot be processed");
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.86).split(",")[1] ?? "";
}

/** Cover of a show: a picture, otherwise a colour. */
export function CoverDialog({ path }: { path: string }) {
  const t = useT();
  const view = useStore((s) => s.view);
  const project = view?.project;
  const [color, setColor] = useState<string | null>(project?.cover.color ?? null);
  const [hasImage, setHasImage] = useState(Boolean(project?.cover.image));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!project) return null;

  const done = async () => {
    useStore.getState().bumpCovers();
    await useStore.getState().reloadProject();
    await useStore.getState().refreshShows();
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await done();
    } catch (e) {
      setError(explain(t, e));
    } finally {
      setBusy(false);
    }
  };

  const choosePicture = () =>
    run(async () => {
      const file = await pickImage(t("Choose a picture for the cover"));
      if (!file) return;
      const url = await api.imagePreview(file);
      const jpeg = await toCoverJpeg(url);
      await api.coverSetImage(path, jpeg, color);
      setHasImage(true);
    });

  const pickColor = (c: string | null) =>
    run(async () => {
      setColor(c);
      await api.coverSetColor(path, c);
    });

  const removePicture = () =>
    run(async () => {
      await api.coverClearImage(path);
      setHasImage(false);
    });

  const preview = { ...project.cover, color, image: hasImage ? (project.cover.image ?? "copertina.jpg") : null };

  return (
    <Dialog
      title={t("Cover of the show")}
      icon="image"
      width={560}
      onClose={() => useStore.getState().setDialog(null)}
      description={t("The cover helps you see at once that you opened the right show. It appears here, in the list and, as a colour, in the apps. Without a picture, a colour is used.")}
      footer={<Button variant="primary" onClick={() => useStore.getState().setDialog(null)}>{t("Done")}</Button>}
    >
      <div className="ln-form">
        <ShowCover path={path} title={project.title} cover={preview} height={140} radius="10px" letter />
        <div className="ln-row">
          <Button icon="image" disabled={busy} onClick={() => void choosePicture()}>{hasImage ? t("Change picture…") : t("Choose a picture…")}</Button>
          {hasImage ? <Button disabled={busy} onClick={() => void removePicture()}>{t("Remove the picture")}</Button> : null}
        </div>
        <div className="ln-field">
          <span className="ln-field__label">{t("Colour")}</span>
          <div className="ln-swatches" role="group" aria-label={t("Colour")}>
            <button type="button" className={`ln-swatch ln-swatch--auto${color === null ? " is-on" : ""}`} aria-pressed={color === null} title={t("Automatic")} onClick={() => void pickColor(null)}>
              <span style={{ background: showColor(project.title, null) }} />
              <small>{t("Auto")}</small>
            </button>
            {SHOW_COLORS.map((c) => (
              <button key={c} type="button" className={`ln-swatch${color === c ? " is-on" : ""}`} aria-pressed={color === c} aria-label={c} onClick={() => void pickColor(c)}>
                <span style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>
        {error ? <div className="ln-error">{error}</div> : null}
      </div>
    </Dialog>
  );
}
