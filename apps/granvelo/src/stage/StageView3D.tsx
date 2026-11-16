import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useT } from "@theatre-suite/core";
import { fixtureType } from "../model/fixtureTypes";
import type { Vec3 } from "../model/types";
import { BAR_CELLS, LENS_DISC, SPOT_LENS, SYMBOL_PATHS } from "../common/symbolGlyph";
import { poolOutline, viewBounds } from "./geometry";
import { lightLabel, sceneryOnStage, stageLights, symbolOffset, type LightLook, type StageLight } from "./scene";
import type { DragAxes, PressInfo, StageCamera, StageDrag, StageHit, StageViewProps } from "./types";
import "./stage.css";

/**
 * The stage in 3D (three.js): the floor solid, the rest of the volume in thin lines, trusses as lines, lights as flat
 * symbols turned towards where they point, scenery solids, the light as pools on the floor (and in "Media" soft pools
 * and semi-transparent beams). Rotate / pan / zoom with the mouse; Prospettiva, Pianta, Frontale.
 *
 * It draws **only when something changes** (no animation loop) and frees everything when it goes away. Loaded on
 * demand (`React.lazy`) so that the start of the app stays light. If WebGL cannot start, `onFail` is called and the
 * screen shows the 2D views instead.
 */

export interface StageView3DProps extends StageViewProps {
  camera: StageCamera;
  /** WebGL could not start, or the context was lost. */
  onFail?: (reason: string) => void;
}

/** World (document) → three.js: X stays, Z (height) is three's up, Y (depth, upstage +) goes into the screen. */
const W = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);
const fromThree = (p: THREE.Vector3): Vec3 => ({ x: p.x, y: -p.z, z: p.y });

interface Palette {
  bg: string;
  floor: string;
  line: string;
  edge: string;
  accent: string;
  amber: string;
  stroke: string;
  lensOff: string;
  text: string;
  font: string;
}

function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, def: string) => cs.getPropertyValue(name).trim() || def;
  return {
    bg: v("--gv-stage-bg", "#0b0c0f"),
    floor: v("--gv-stage-floor", "#1b1d23"),
    line: v("--gv-stage-line", "#3a3e48"),
    edge: v("--gv-stage-edge", "#6b7180"),
    accent: v("--accent", "#f06fcf"),
    amber: v("--sb", "#ffb224"),
    stroke: v("--gv-symbol-stroke", "#a7aab3"),
    lensOff: v("--gv-lens-off", "#2a2d35"),
    text: v("--gv-stage-text", "#ecedf0"),
    font: v("--font-ui", "sans-serif"),
  };
}

/* ---------------- Textures drawn on a canvas (cached) ---------------- */

const TEX = 128;

function symbolCanvas(kind: StageLight["symbol"], look: LightLook, lens: string | null, pal: Palette): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = TEX;
  const g = c.getContext("2d")!;
  g.scale(TEX / 28, TEX / 28);
  g.translate(2, 2);
  g.lineWidth = 1.9;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = look === "conflict" ? pal.amber : pal.stroke;
  if (look === "unused") {
    g.globalAlpha = 0.45;
    g.setLineDash([2.2, 2]);
  }
  // A dark backing so the symbol reads over light pools.
  g.fillStyle = "rgba(11,12,15,0.55)";
  g.beginPath();
  g.arc(12, 12, 11, 0, Math.PI * 2);
  g.fill();
  const disc = LENS_DISC[kind];
  const lensFill = look !== "unused" && lens ? lens : pal.lensOff;
  if (disc) {
    g.fillStyle = lensFill;
    g.beginPath();
    g.arc(disc.cx, disc.cy, disc.r, 0, Math.PI * 2);
    g.fill();
  }
  g.stroke(new Path2D(SYMBOL_PATHS[kind]));
  if (kind === "spot") {
    g.fillStyle = lensFill;
    g.fill(new Path2D(SPOT_LENS));
  }
  if (kind === "bar") {
    g.save();
    g.setLineDash([]);
    g.lineWidth = 2.6;
    g.strokeStyle = look !== "unused" && lens ? lens : g.strokeStyle;
    g.stroke(new Path2D(BAR_CELLS));
    g.restore();
  }
  return c;
}

function frameCanvas(pal: Palette): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = TEX;
  const g = c.getContext("2d")!;
  g.scale(TEX / 28, TEX / 28);
  g.translate(2, 2);
  g.fillStyle = pal.accent + "3d";
  g.strokeStyle = pal.accent;
  g.lineWidth = 1.4;
  g.beginPath();
  g.roundRect(-1.4, -1.4, 26.8, 26.8, 5);
  g.fill();
  g.stroke();
  return c;
}

function handleCanvas(pal: Palette): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = pal.accent;
  g.lineWidth = 4;
  g.beginPath();
  g.arc(32, 32, 14, 0, Math.PI * 2);
  g.moveTo(4, 32);
  g.lineTo(60, 32);
  g.moveTo(32, 4);
  g.lineTo(32, 60);
  g.stroke();
  return c;
}

function softCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function labelCanvas(text: string, pal: Palette): { canvas: HTMLCanvasElement; aspect: number } {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = `600 26px ${pal.font}`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 20;
  c.width = w;
  c.height = 40;
  g.font = font;
  g.fillStyle = "rgba(11,12,15,0.82)";
  g.beginPath();
  g.roundRect(0, 0, w, 40, 8);
  g.fill();
  g.fillStyle = pal.text;
  g.textBaseline = "middle";
  g.fillText(text, 10, 21);
  return { canvas: c, aspect: w / 40 };
}

/* ---------------- The view ---------------- */

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  camera: THREE.Camera;
  controls: OrbitControls;
  content: THREE.Group;
  /** Disposables of the current content. */
  trash: { dispose: () => void }[];
  /** Textures kept between rebuilds (symbols, soft pool, handle), by key. */
  cache: Map<string, THREE.Texture>;
  shared: { circle: THREE.CircleGeometry; cone: THREE.ConeGeometry };
  /** Symbols to turn towards their aim at every render. */
  facing: { sprite: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3; offset: number }[];
  pickables: THREE.Object3D[];
  pending: number;
  pal: Palette;
  size: { w: number; h: number };
  mode: StageCamera;
}

export default function StageView3D(props: StageView3DProps) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const dragRef = useRef<{ drag: StageDrag | null; hit: StageHit; info: PressInfo; start: { x: number; y: number }; startWorld: Vec3 | null; moved: boolean; axes: DragAxes; pointer: number } | null>(null);

  // Start three.js once.
  useEffect(() => {
    const box = boxRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "default", preserveDrawingBuffer: false });
    } catch (e) {
      propsRef.current.onFail?.(String(e));
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    box.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = -1;
    const pal = readPalette(box);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(pal.bg);
    scene.add(new THREE.HemisphereLight(0xdfe3ec, 0x202228, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(3, 8, 6);
    scene.add(sun);
    const persp = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
    const ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, -200, 400);
    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    const content = new THREE.Group();
    scene.add(content);
    const ctx: Ctx = {
      renderer,
      scene,
      persp,
      ortho,
      camera: persp,
      controls,
      content,
      trash: [],
      cache: new Map(),
      shared: { circle: new THREE.CircleGeometry(1, 48), cone: new THREE.ConeGeometry(1, 1, 32, 1, true) },
      facing: [],
      pickables: [],
      pending: 0,
      pal,
      size: { w: 1, h: 1 },
      mode: "perspective",
    };
    ctxRef.current = ctx;
    controls.addEventListener("change", () => invalidate());
    const onLost = (e: Event) => {
      e.preventDefault();
      propsRef.current.onFail?.("context lost");
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    const ro = new ResizeObserver(() => {
      const w = Math.max(1, box.clientWidth);
      const h = Math.max(1, box.clientHeight);
      if (w === ctx.size.w && h === ctx.size.h) return;
      ctx.size = { w, h };
      renderer.setSize(w, h, false);
      fit(ctx, false);
      invalidate();
    });
    ro.observe(box);
    setCamera(ctx, propsRef.current.camera);
    rebuild(ctx);
    return () => {
      ro.disconnect();
      if (ctx.pending) cancelAnimationFrame(ctx.pending);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      controls.dispose();
      for (const d of ctx.trash) d.dispose();
      for (const tex of ctx.cache.values()) tex.dispose();
      ctx.shared.circle.dispose();
      ctx.shared.cone.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    setCamera(ctx, props.camera);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.camera]);

  // Content: rebuilt when what is drawn changes.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    rebuild(ctx);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.doc, props.values, props.selected, props.scenery, props.selectedScenery, props.detail, props.showAims, props.compact, t]);

  function invalidate() {
    const ctx = ctxRef.current;
    if (!ctx || ctx.pending) return;
    ctx.pending = requestAnimationFrame(() => {
      ctx.pending = 0;
      render(ctx);
    });
  }

  function setCamera(ctx: Ctx, mode: StageCamera) {
    ctx.mode = mode;
    ctx.camera = mode === "perspective" ? ctx.persp : ctx.ortho;
    ctx.controls.object = ctx.camera;
    ctx.controls.enableRotate = mode === "perspective";
    ctx.controls.mouseButtons = { LEFT: mode === "perspective" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    fit(ctx, true);
  }

  /** Frames the stage (and every light) in the current camera. `reset` = also put the camera back in its place. */
  function fit(ctx: Ctx, reset: boolean) {
    const { doc } = propsRef.current;
    const { width, depth, height } = doc.stage;
    const aspect = ctx.size.w / ctx.size.h;
    if (ctx.mode === "perspective") {
      ctx.persp.aspect = aspect;
      ctx.persp.updateProjectionMatrix();
      if (reset) {
        const span = Math.max(width, depth, height * 1.4);
        ctx.persp.position.set(width * 0.18, height * 0.75 + span * 0.55, span * 1.25);
        ctx.controls.target.set(0, height * 0.22, -depth * 0.45);
        ctx.persp.up.set(0, 1, 0);
      }
    } else {
      const view = ctx.mode === "plan" ? "plan" : "front";
      const b = viewBounds({ ...doc, scenery: [] }, view, 0.6);
      const bw = b.maxX - b.minX;
      const bh = b.maxY - b.minY;
      const scale = Math.max(bw / aspect, bh) / 2;
      ctx.ortho.left = -scale * aspect;
      ctx.ortho.right = scale * aspect;
      ctx.ortho.top = scale;
      ctx.ortho.bottom = -scale;
      if (reset) {
        const cx = (b.minX + b.maxX) / 2;
        const cy = -(b.minY + b.maxY) / 2; // world Y (plan) or Z (front)
        ctx.ortho.zoom = 1;
        if (view === "plan") {
          ctx.ortho.up.set(0, 0, -1);
          ctx.ortho.position.set(cx, 100, -cy);
          ctx.controls.target.set(cx, 0, -cy);
        } else {
          ctx.ortho.up.set(0, 1, 0);
          ctx.ortho.position.set(cx, cy, 100);
          ctx.controls.target.set(cx, cy, 0);
        }
      }
      ctx.ortho.updateProjectionMatrix();
    }
    ctx.controls.update();
  }

  function track<T extends { dispose: () => void }>(ctx: Ctx, x: T): T {
    ctx.trash.push(x);
    return x;
  }

  function texture(ctx: Ctx, key: string, make: () => HTMLCanvasElement): THREE.Texture {
    let tex = ctx.cache.get(key);
    if (!tex) {
      tex = new THREE.CanvasTexture(make());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      ctx.cache.set(key, tex);
      // Lens colours change during fades: keep the cache from growing for ever.
      if (ctx.cache.size > 400) {
        const first = ctx.cache.keys().next().value!;
        ctx.cache.get(first)!.dispose();
        ctx.cache.delete(first);
      }
    }
    return tex;
  }

  function rebuild(ctx: Ctx) {
    const p = propsRef.current;
    const { doc } = p;
    const pal = (ctx.pal = readPalette(boxRef.current!));
    ctx.scene.background = new THREE.Color(pal.bg);
    for (const d of ctx.trash) d.dispose();
    ctx.trash = [];
    ctx.content.clear();
    ctx.facing = [];
    ctx.pickables = [];
    const G = ctx.content;
    const { width, depth, height } = doc.stage;
    const medium = (p.detail ?? "medium") === "medium";
    const pick = p.onPress ? (p.pick ?? {}) : {};

    // Floor (solid) and volume (thin lines).
    const floor = new THREE.Mesh(track(ctx, new THREE.PlaneGeometry(width, depth)), track(ctx, new THREE.MeshBasicMaterial({ color: pal.floor })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -depth / 2);
    G.add(floor);
    const edges = new THREE.LineSegments(track(ctx, new THREE.EdgesGeometry(track(ctx, new THREE.BoxGeometry(width, height, depth)))), track(ctx, new THREE.LineBasicMaterial({ color: pal.line })));
    edges.position.set(0, height / 2, -depth / 2);
    G.add(edges);
    const front = new THREE.Line(track(ctx, new THREE.BufferGeometry().setFromPoints([W({ x: -width / 2, y: 0, z: 0.002 }), W({ x: width / 2, y: 0, z: 0.002 })])), track(ctx, new THREE.LineBasicMaterial({ color: pal.edge })));
    G.add(front);

    // Trusses: two parallel lines across the width (+ an invisible bar to click).
    const trussMat = track(ctx, new THREE.LineBasicMaterial({ color: pal.edge }));
    const hidden = track(ctx, new THREE.MeshBasicMaterial({ visible: false }));
    for (const tr of doc.trusses) {
      const pts: THREE.Vector3[] = [];
      for (const dy of [-0.05, 0.05]) pts.push(W({ x: -width / 2 - 0.3, y: tr.y + dy, z: tr.z }), W({ x: width / 2 + 0.3, y: tr.y + dy, z: tr.z }));
      G.add(new THREE.LineSegments(track(ctx, new THREE.BufferGeometry().setFromPoints(pts)), trussMat));
      if (pick.trusses) {
        const bar = new THREE.Mesh(track(ctx, new THREE.BoxGeometry(width + 0.6, 0.25, 0.3)), hidden);
        bar.position.copy(W({ x: 0, y: tr.y, z: tr.z }));
        bar.userData.hit = { kind: "truss", id: tr.id } satisfies StageHit;
        G.add(bar);
        ctx.pickables.push(bar);
      }
    }

    // Scenery.
    for (const s of sceneryOnStage(doc, p.scenery ?? "all")) {
      const on = s.id === p.selectedScenery;
      let geo: THREE.BufferGeometry;
      let lift = s.size.z / 2;
      const r = Math.max(0.01, s.size.x / 2);
      switch (s.shape) {
        case "box":
          geo = new THREE.BoxGeometry(Math.max(0.01, s.size.x), Math.max(0.01, s.size.z), Math.max(0.01, s.size.y));
          break;
        case "cone":
          geo = new THREE.ConeGeometry(r, Math.max(0.01, s.size.z), 32);
          break;
        case "sphere":
          geo = new THREE.SphereGeometry(r, 32, 16);
          lift = r;
          break;
        case "plane":
          geo = new THREE.PlaneGeometry(Math.max(0.01, s.size.x), Math.max(0.01, s.size.z));
          break;
        default:
          geo = new THREE.CylinderGeometry(r, r, Math.max(0.01, s.size.z), 32);
      }
      track(ctx, geo);
      // Rotations: degrees around the world X, then Y, then Z (types.ts), turned into three's axes.
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), (s.rotation.z * Math.PI) / 180)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), (s.rotation.y * Math.PI) / 180))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (s.rotation.x * Math.PI) / 180));
      const holder = new THREE.Group();
      holder.position.copy(W(s.position));
      holder.quaternion.copy(q);
      const mesh = new THREE.Mesh(geo, track(ctx, new THREE.MeshLambertMaterial({ color: s.color, side: s.shape === "plane" ? THREE.DoubleSide : THREE.FrontSide })));
      mesh.position.y = lift;
      holder.add(mesh);
      const outline = new THREE.LineSegments(track(ctx, new THREE.EdgesGeometry(geo, 30)), track(ctx, new THREE.LineBasicMaterial({ color: on ? pal.accent : "#000000", transparent: !on, opacity: on ? 1 : 0.35 })));
      outline.position.y = lift;
      holder.add(outline);
      if (pick.scenery) {
        mesh.userData.hit = { kind: "scenery", id: s.id } satisfies StageHit;
        ctx.pickables.push(mesh);
      }
      G.add(holder);
    }

    // Lights, their light, their labels.
    const lights = stageLights(doc, p.values, p.selected ?? [], !p.compact);
    const soft = medium ? texture(ctx, "soft", softCanvas) : null;
    let order = 0;
    for (const l of lights) {
      const pos = W(l.pos);
      if (l.light) {
        const { hue, level } = l.light;
        const pool = l.pool;
        const mat = track(ctx, new THREE.MeshBasicMaterial({ color: hue, map: soft, transparent: true, opacity: medium ? Math.min(1, 0.25 + 0.75 * level) : 0.2 + 0.5 * level, depthWrite: false, blending: THREE.AdditiveBlending }));
        const disc = new THREE.Mesh(ctx.shared.circle, mat);
        disc.rotation.x = -Math.PI / 2;
        disc.rotation.z = pool.angle;
        disc.scale.set(pool.rx, pool.ry, 1);
        disc.position.copy(W({ x: pool.cx, y: pool.cy, z: 0.004 + (order++ % 20) * 0.0005 }));
        disc.renderOrder = 2;
        G.add(disc);
        if (medium) {
          const end = W(pool.end);
          const len = pos.distanceTo(end);
          if (len > 0.05) {
            const cone = new THREE.Mesh(ctx.shared.cone, track(ctx, new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.04 + 0.1 * level, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
            cone.scale.set(Math.max(0.02, pool.endRadius), len, Math.max(0.02, pool.endRadius));
            cone.position.copy(pos).add(end).multiplyScalar(0.5);
            cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), end.clone().sub(pos).normalize());
            cone.renderOrder = 3;
            G.add(cone);
          }
        }
      }
      // The symbol (and the selection frame, not turned).
      const lens = l.light ? l.light.hue : null;
      const key = `sym|${l.symbol}|${l.look === "selected" ? "normal" : l.look}|${lens ?? ""}|${pal.stroke}|${pal.amber}`;
      const tex = texture(ctx, key, () => symbolCanvas(l.symbol, l.look === "selected" ? "normal" : l.look, lens, pal));
      const size = p.compact ? 0.32 : 0.42;
      if (l.selected) {
        const frame = new THREE.Sprite(track(ctx, new THREE.SpriteMaterial({ map: texture(ctx, `frame|${pal.accent}`, () => frameCanvas(pal)), depthTest: false, transparent: true })));
        frame.scale.set(size, size, 1);
        frame.position.copy(pos);
        frame.renderOrder = 9;
        G.add(frame);
      }
      const sprite = new THREE.Sprite(track(ctx, new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })));
      sprite.scale.set(size, size, 1);
      sprite.position.copy(pos);
      sprite.renderOrder = 10;
      if (pick.lights) {
        sprite.userData.hit = { kind: "light", id: l.f.id } satisfies StageHit;
        ctx.pickables.push(sprite);
      }
      G.add(sprite);
      ctx.facing.push({ sprite, from: pos, to: W(l.f.aim), offset: symbolOffset(l.symbol) });

      if (l.selected && !p.compact) {
        // Where it points: a dashed line to the aim and the outline of its pool.
        const accentLine = track(ctx, new THREE.LineDashedMaterial({ color: pal.accent, dashSize: 0.12, gapSize: 0.09, depthTest: false, transparent: true }));
        const aimLine = new THREE.Line(track(ctx, new THREE.BufferGeometry().setFromPoints([pos, W(l.f.aim)])), accentLine);
        aimLine.computeLineDistances();
        aimLine.renderOrder = 8;
        G.add(aimLine);
        const ring = poolOutline(l.pool, 48).map((q) => W({ x: q.x, y: q.y, z: 0.01 }));
        const loop = new THREE.LineLoop(track(ctx, new THREE.BufferGeometry().setFromPoints(ring)), accentLine);
        loop.computeLineDistances();
        loop.renderOrder = 8;
        G.add(loop);
        const text = lightLabel(l.f, t(fixtureType(l.f.typeId).name));
        const lab = labelCanvas(text, pal);
        const labTex = track(ctx, new THREE.CanvasTexture(lab.canvas));
        labTex.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Sprite(track(ctx, new THREE.SpriteMaterial({ map: labTex, depthTest: false, transparent: true })));
        const lh = 0.22;
        label.scale.set(lh * lab.aspect, lh, 1);
        label.center.set(0, 0);
        label.position.copy(pos).add(new THREE.Vector3(0, size * 0.55, 0));
        label.renderOrder = 11;
        G.add(label);
      }
      if (l.selected && p.showAims) {
        const handle = new THREE.Sprite(track(ctx, new THREE.SpriteMaterial({ map: texture(ctx, `handle|${pal.accent}`, () => handleCanvas(pal)), depthTest: false, transparent: true })));
        handle.scale.set(0.38, 0.38, 1);
        handle.position.copy(W(l.f.aim));
        handle.renderOrder = 12;
        if (pick.aims) {
          handle.userData.hit = { kind: "aim", id: l.f.id } satisfies StageHit;
          ctx.pickables.push(handle);
        }
        G.add(handle);
      }
    }
  }

  function render(ctx: Ctx) {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    // Turn every symbol towards where its light points, as seen on the screen now.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const fallback = ctx.mode === "plan" ? 0 : 180;
    for (const f of ctx.facing) {
      a.copy(f.from).project(cam);
      b.copy(f.to).project(cam);
      const dx = ((b.x - a.x) * ctx.size.w) / 2;
      const dy = (-(b.y - a.y) * ctx.size.h) / 2;
      const deg = Math.hypot(dx, dy) < 2 ? fallback : (Math.atan2(dx, -dy) * 180) / Math.PI;
      f.sprite.material.rotation = (-(deg + f.offset) * Math.PI) / 180;
    }
    ctx.renderer.render(ctx.scene, cam);
  }

  /* ---------------- Mouse ---------------- */

  const raycaster = useRef(new THREE.Raycaster());

  function ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = boxRef.current!.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  function hitAt(e: { clientX: number; clientY: number }): StageHit {
    const ctx = ctxRef.current;
    if (!ctx || ctx.pickables.length === 0) return { kind: "empty" };
    const rc = raycaster.current;
    rc.setFromCamera(ndc(e), ctx.camera);
    const hits = rc.intersectObjects(ctx.pickables, false);
    const rank = { aim: 0, light: 1, scenery: 2, truss: 3, empty: 4 } as const;
    let best: StageHit = { kind: "empty" };
    for (const h of hits) {
      const hit = h.object.userData.hit as StageHit;
      if (rank[hit.kind] < rank[best.kind]) best = hit;
    }
    return best;
  }

  /** The world point under the mouse on the plane of the drag. */
  function planePoint(e: { clientX: number; clientY: number }, from: Vec3, axes: DragAxes): Vec3 | null {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const rc = raycaster.current;
    rc.setFromCamera(ndc(e), ctx.camera);
    let plane: THREE.Plane;
    if (axes === "xz") plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), from.y);
    else if (axes === "z") {
      const dir = new THREE.Vector3();
      ctx.camera.getWorldDirection(dir);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir.normalize(), W(from));
    } else {
      // A horizontal plane at the height of the point; seen almost edge-on, the floor instead (steadier).
      const camY = ctx.camera.position.y;
      const z = ctx.mode === "perspective" && Math.abs(camY - from.z) < 1.5 ? 0 : from.z;
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -z);
    }
    const out = new THREE.Vector3();
    return rc.ray.intersectPlane(plane, out) ? fromThree(out) : null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = propsRef.current;
    if (!p.onPress || e.button !== 0) return;
    const hit = hitAt(e);
    const info = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
    if (hit.kind === "empty") {
      // The click on empty space is decided on release: a drag there turns or moves the view.
      dragRef.current = { drag: null, hit, info, start: { x: e.clientX, y: e.clientY }, startWorld: null, moved: false, axes: "xy", pointer: e.pointerId };
      return;
    }
    const drag = p.onPress(hit, info);
    if (!drag) {
      e.stopPropagation();
      return;
    }
    const mode = ctxRef.current?.mode ?? "perspective";
    const axes: DragAxes = mode === "front" ? "xz" : mode === "plan" ? "xy" : e.shiftKey && hit.kind === "light" ? "z" : "xy";
    const startWorld = planePoint(e, drag.from, axes);
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { drag, hit, info, start: { x: e.clientX, y: e.clientY }, startWorld, moved: false, axes, pointer: e.pointerId };
    boxRef.current?.setPointerCapture(e.pointerId);
  }

  function dragPoint(e: { clientX: number; clientY: number }): Vec3 | null {
    const d = dragRef.current!;
    if (!d.drag || !d.startWorld) return null;
    const q = planePoint(e, d.drag.from, d.axes);
    if (!q) return null;
    const f = d.drag.from;
    const to = { x: f.x + q.x - d.startWorld.x, y: f.y + q.y - d.startWorld.y, z: f.z + q.z - d.startWorld.z };
    if (d.axes === "xy") return { ...to, z: f.z };
    if (d.axes === "xz") return { ...to, y: f.y };
    return { x: f.x, y: f.y, z: Math.max(0, to.z) };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) {
      // Hover: say what can be grabbed.
      const hit = hitAt(e);
      const cur = hit.kind === "light" || hit.kind === "scenery" ? "grab" : hit.kind === "aim" ? "aim" : hit.kind === "truss" ? "pointer" : "";
      if (boxRef.current && boxRef.current.dataset.cursor !== cur) boxRef.current.dataset.cursor = cur;
      return;
    }
    if (e.pointerId !== d.pointer) return;
    if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
    d.moved = true;
    if (!d.drag) return;
    const to = dragPoint(e);
    if (to) d.drag.move(to, d.axes);
  }

  function finish(e: { clientX: number; clientY: number } | null) {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (!d.drag) {
      if (e && !d.moved) propsRef.current.onPress?.({ kind: "empty" }, d.info)?.end(null, "xy");
      return;
    }
    d.drag.end(e && d.moved ? dragPoint(e) : null, d.axes);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current?.drag) {
        e.stopPropagation();
        finish(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div
      ref={boxRef}
      className="gv-stage3d"
      role="img"
      aria-label={props.label ?? t("Stage in 3D")}
      onPointerDownCapture={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={() => finish(null)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
