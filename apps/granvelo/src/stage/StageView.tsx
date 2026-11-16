import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { StageView2D } from "./StageView2D";
import type { StageCamera, StageViewProps } from "./types";
import "./stage.css";

/** three.js arrives only when a 3D stage is shown (its own chunk): the start of the app stays light. */
const StageView3D = lazy(() => import("./StageView3D"));

let webgl: boolean | null = null;

/** Can this computer draw in 3D? Asked once (a throw-away canvas), then remembered. */
export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("no3d")) return (webgl = false);
    const c = document.createElement("canvas");
    const g = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    webgl = !!g;
    g?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

/** If the 3D view breaks while drawing, the 2D views take over (never a blank stage). */
class Guard extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error("3D stage failed", e);
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface StageViewHostProps extends StageViewProps {
  camera: StageCamera;
  /** Force the 2D views (no WebGL is tried). */
  force2D?: boolean;
  /** Told when the 3D view is not available (to say so discreetly). */
  onNo3D?: () => void;
}

/**
 * The stage, in 3D when the computer can, otherwise in 2D (the perspective becomes the plan) with a discreet note.
 * The props are those of the views (see types.ts), plus the camera.
 */
export function StageView({ camera, force2D, onNo3D, ...props }: StageViewHostProps) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const use3D = !force2D && !failed && webglAvailable();
  const view2D = camera === "front" ? "front" : "plan";
  const flat = <StageView2D {...props} view={view2D} />;
  const fail = () => {
    setFailed(true);
    onNo3D?.();
  };
  return (
    <div className={`gv-stagebox${props.className ? ` ${props.className}` : ""}`} data-stage={use3D ? "3d" : "2d"}>
      {use3D ? (
        <Guard fallback={flat} onError={fail}>
          <Suspense fallback={null}>
            <StageView3D {...props} camera={camera} onFail={fail} />
          </Suspense>
        </Guard>
      ) : (
        <>
          {flat}
          {!force2D && !props.compact ? <p className="gv-stagebox__note">{t("This computer cannot show the stage in 3D: here are the views from above and from the front.")}</p> : null}
        </>
      )}
    </div>
  );
}
