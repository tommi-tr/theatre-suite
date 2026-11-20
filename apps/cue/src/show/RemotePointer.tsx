import { useEffect, useRef } from "react";
import { useT } from "@theatre-suite/core";
import { anchorTop, scriptLive, useScriptView } from "../script/view";
import { useLink } from "../store/link";

/** The other computer's pointer on the script: a small dot with the name of its role (low priority, never in the way). */
export function RemotePointer() {
  const t = useT();
  const pointer = useLink((s) => s.pointer);
  const role = useLink((s) => s.info.role);
  const geometry = useScriptView((s) => s.geometry);
  const ref = useRef<HTMLDivElement>(null);
  const y = pointer && geometry ? anchorTop(geometry, { page: pointer.page, y: pointer.y }) : null;
  useEffect(
    () =>
      scriptLive.onScroll((top) => {
        if (ref.current && y !== null) ref.current.style.transform = `translate3d(0, ${y - top}px, 0)`;
      }),
    [y],
  );
  if (!pointer || !geometry || y === null) return null;
  const i = pointer.page - 1;
  const x = geometry.lefts[i] + pointer.x * geometry.widths[i];
  return (
    <div ref={ref} className="cue-rptr" style={{ left: x }} aria-hidden="true">
      <span className="cue-rptr__dot" />
      <span className="cue-rptr__name">{role === "primary" ? t("Secondary") : t("Primary")}</span>
    </div>
  );
}
