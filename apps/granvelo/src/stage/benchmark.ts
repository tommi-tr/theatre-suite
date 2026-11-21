import * as THREE from "three";
import { MAX_SHADOW_LIGHTS, SpotPool, hazeBeamMaterial, shadowCatcher } from "./haze";
import { levelForMs, typicalMs } from "./detail";
import type { StageDetail } from "./types";

/**
 * "Automatica": draws, off screen, a test stage as rich as the "Alta" preview (shadows, beams in haze, a crowd of lights)
 * for a short while and measures the time of each picture. It never runs by itself in a loop: it stops after `MAX_FRAMES`
 * pictures or `MAX_MS` milliseconds, whichever comes first, and frees everything.
 */

export const MAX_FRAMES = 30;
export const MAX_MS = 2500;
const WARMUP = 3;
const MIN_FRAMES = 4;

export interface Measure {
  level: StageDetail;
  /** Typical time of one picture, ms. */
  ms: number;
  frames: number;
}

/** Measures this computer; null when 3D cannot start (the 2D views are used then). */
export async function measurePreview(): Promise<Measure | null> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "default" });
  } catch {
    return null;
  }
  const trash: { dispose: () => void }[] = [];
  const scene = new THREE.Scene();
  let spots: SpotPool | null = null;
  try {
    const W = 1000;
    const H = 560;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.background = new THREE.Color("#0b0c0f");
    scene.add(new THREE.HemisphereLight(0xdfe3ec, 0x202228, 1.6));
    const cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 400);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), new THREE.MeshBasicMaterial({ color: "#1b1d23" }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -3);
    trash.push(floor.geometry, floor.material as THREE.Material);
    scene.add(floor, shadowCatcher(8, 6, trash));

    const box = new THREE.BoxGeometry(1, 1, 1);
    const lambert = new THREE.MeshLambertMaterial({ color: "#8a5a34" });
    trash.push(box, lambert);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(box, lambert);
      m.position.set(-2.5 + i, 0.5, -1.5 - (i % 3));
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }

    spots = new SpotPool(scene);
    const specs = Array.from({ length: MAX_SHADOW_LIGHTS }, (_, i) => ({
      position: new THREE.Vector3(-3 + i * 1.2, 4.2, -1.2),
      target: new THREE.Vector3(-2.5 + i, 0, -2),
      color: "#ffd9a0",
      level: 0.9,
      beam: 28,
    }));
    spots.apply(specs, true);

    const cone = new THREE.ConeGeometry(1, 1, 32, 1, true);
    trash.push(cone);
    for (const s of specs.concat(specs)) {
      const mat = hazeBeamMaterial(s.color, 0.2);
      trash.push(mat);
      const len = s.position.distanceTo(s.target);
      const c = new THREE.Mesh(cone, mat);
      c.scale.set(0.9, len, 0.9);
      c.position.copy(s.position).add(s.target).multiplyScalar(0.5);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), s.target.clone().sub(s.position).normalize());
      scene.add(c);
    }

    const times: number[] = [];
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    const started = performance.now();
    for (let i = 0; i < WARMUP + MAX_FRAMES; i++) {
      // The view turns a little at each picture so that nothing can be reused.
      const a = i * 0.07;
      cam.position.set(Math.sin(a) * 2, 3.2, 8);
      cam.lookAt(0, 1, -3);
      const t0 = performance.now();
      renderer.render(scene, cam);
      // Reading one pixel makes the browser wait until the picture is really drawn (finish() alone may return at once).
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const dt = performance.now() - t0;
      if (i >= WARMUP) times.push(dt);
      if (performance.now() - started > MAX_MS && times.length >= MIN_FRAMES) break;
      // Let the window breathe between pictures (and stop at once if the page goes away).
      await new Promise((r) => setTimeout(r, 0));
    }
    const ms = typicalMs(times);
    return { level: levelForMs(ms), ms, frames: times.length };
  } catch {
    return null;
  } finally {
    spots?.dispose();
    for (const d of trash) d.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
