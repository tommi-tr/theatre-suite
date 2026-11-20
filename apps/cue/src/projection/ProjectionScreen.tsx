import { useEffect, useId, useRef, useState } from "react";
import { colorFilter, temperatureGains, transitionTimeline, type OutMedia, type OutState } from "../model/projection";
import type { Color } from "../model/show";
import { imageUrl } from "../lib/projMedia";
import "./projection.css";

interface Layer {
  id: number;
  media: OutMedia;
  /** Address of the picture (an image, or a video's poster in the preview); null for black. */
  url: string | null;
  color: Color;
  opacity: number;
  /** CSS `transition` of the opacity. */
  fade: string;
  /** A video that ended with "a fine video: nero". */
  ended: boolean;
}

/**
 * What the output screen shows: the layers of the current item and the one before it during a transition (cut,
 * dissolve, through black), with the colour adjustments as CSS filters. `preview` draws a video as its poster (the
 * output window is the only one that plays it, so the sound and the decoding are not doubled).
 */
export function ProjectionScreen({ state, preview = false }: { state: OutState; preview?: boolean }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const lastKey = useRef<string | null>(null);
  const counter = useRef(0);
  const token = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    if (state.key === lastKey.current) {
      // Same item: only the colour (or the test pattern) changed.
      setLayers((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, color: state.color } : l)));
      return;
    }
    lastKey.current = state.key;
    const mineToken = ++token.current;
    void (async () => {
      const m = state.media;
      const ref = m.type === "image" ? m.image : m.type === "video" && preview ? m.poster : undefined;
      const url = ref ? await imageUrl(ref).catch(() => null) : null;
      // A newer item came while the picture was loading: that one wins.
      if (mineToken !== token.current) return;
      const tl = transitionTimeline(state.transition);
      const id = ++counter.current;
      window.clearTimeout(timer.current);
      const mine: Layer = { id, media: m, url, color: state.color, opacity: tl.totalMs === 0 ? 1 : 0, fade: "none", ended: false };
      setLayers((old) => (tl.totalMs === 0 ? [mine] : [...old.slice(-1), mine]));
      if (tl.totalMs === 0) return;
      // Next frame: start the fades (the new layer is in the page at opacity 0 first, so it can animate).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setLayers((ls) =>
            ls.map((l) =>
              l.id === id
                ? { ...l, opacity: 1, fade: `opacity ${tl.inMs}ms linear ${tl.inDelayMs}ms` }
                : { ...l, opacity: tl.outMs > 0 ? 0 : 1, fade: tl.outMs > 0 ? `opacity ${tl.outMs}ms linear` : "none" },
            ),
          );
          timer.current = window.setTimeout(() => setLayers((ls) => ls.filter((l) => l.id === id)), tl.totalMs + 80);
        }),
      );
    })();
  }, [state.key, state.media, state.color, state.transition, preview]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="proj-screen">
      {layers.map((l) => {
        const fid = `t${uid}${l.id}`;
        const g = temperatureGains(l.color.temperature);
        const filter = colorFilter(l.color, fid);
        const style = { opacity: l.ended ? 0 : l.opacity, transition: l.ended ? "opacity 400ms linear" : l.fade, filter };
        return (
          <div key={l.id} className="proj-layer" style={{ opacity: style.opacity, transition: style.transition }}>
            {l.color.temperature !== 0 ? (
              <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
                <filter id={fid} colorInterpolationFilters="sRGB">
                  <feComponentTransfer>
                    <feFuncR type="linear" slope={g.r} />
                    <feFuncB type="linear" slope={g.b} />
                  </feComponentTransfer>
                </filter>
              </svg>
            ) : null}
            {l.media.type === "video" && !preview && !l.media.src.startsWith("demo:") ? (
              <video
                className="proj-media"
                style={{ filter }}
                src={l.media.src}
                autoPlay
                playsInline
                loop={l.media.atEnd === "loop"}
                onEnded={() => l.media.type === "video" && l.media.atEnd === "black" && setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, ended: true } : x)))}
              />
            ) : l.url ? (
              <img className="proj-media" style={{ filter }} src={l.url} alt="" draggable={false} />
            ) : null}
          </div>
        );
      })}
      {state.test ? <TestPattern preview={preview} /> : null}
    </div>
  );
}

/** Colour bars, grid, circle and the size of the screen: to line up the projector. */
function TestPattern({ preview }: { preview: boolean }) {
  const bars = ["#fff", "#f2e600", "#00e5e5", "#00d400", "#e600e6", "#ee0000", "#0000ee"];
  const size = preview ? "" : `${window.innerWidth} × ${window.innerHeight}`;
  return (
    <svg className="proj-test" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect width="1920" height="1080" fill="#101114" />
      {bars.map((c, i) => (
        <rect key={c} x={i * (1920 / 7)} y="0" width={1920 / 7 + 1} height="620" fill={c} />
      ))}
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={i * 120} y="620" width="121" height="120" fill={`hsl(0 0% ${(i / 15) * 100}%)`} />
      ))}
      {Array.from({ length: 17 }, (_, i) => (
        <line key={`v${i}`} x1={i * 120} y1="0" x2={i * 120} y2="1080" stroke="#000" strokeOpacity=".35" strokeWidth="2" />
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 120} x2="1920" y2={i * 120} stroke="#000" strokeOpacity=".35" strokeWidth="2" />
      ))}
      <rect x="6" y="6" width="1908" height="1068" fill="none" stroke="#fff" strokeWidth="12" />
      <circle cx="960" cy="540" r="330" fill="none" stroke="#fff" strokeWidth="6" />
      <path d="M0 0 L120 0 L0 120 Z M1920 0 L1800 0 L1920 120 Z M0 1080 L120 1080 L0 960 Z M1920 1080 L1800 1080 L1920 960 Z" fill="#fff" />
      <rect x="700" y="760" width="520" height="250" rx="18" fill="#000" fillOpacity=".8" />
      <text x="960" y="840" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="44" fontWeight="700" fill="#fff">
        Cue · Prova schema
      </text>
      <text x="960" y="900" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="40" fill="#4cd6e6">
        {size || "1920 × 1080"}
      </text>
      <text x="960" y="965" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="30" fill="#c9ccd3">
        I bordi bianchi devono vedersi tutti
      </text>
    </svg>
  );
}
