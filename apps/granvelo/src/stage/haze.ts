import * as THREE from "three";

/**
 * Parts of the "Alta" preview shared by the stage view and the benchmark of "Automatica": beams that look like light in
 * haze, and a small fixed set of spotlights that make the scenery cast shadows.
 */

/**
 * A beam as seen in haze: faint, brighter near the light and fading along its length, soft at the edges (a hollow cone
 * seen sideways is brightest in its middle). The cone is the shared `ConeGeometry(1, 1, …, openEnded)`: its tip (+Y) is the light.
 */
export function hazeBeamMaterial(color: THREE.ColorRepresentation, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vAlong;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vAlong = 0.5 - position.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      varying float vAlong;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float edge = smoothstep(0.0, 0.85, f);
        float fall = 1.0 - 0.65 * vAlong;
        gl_FragColor = vec4(uColor, uStrength * edge * fall);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** How many lights at the same time make shadows (each one costs a picture of the stage from its point of view). */
export const MAX_SHADOW_LIGHTS = 6;
const SHADOW_MAP = 512;

/** What a spotlight of the pool is told. */
export interface SpotSpec {
  position: THREE.Vector3;
  target: THREE.Vector3;
  color: string;
  /** 0–1. */
  level: number;
  /** Full beam angle in degrees. */
  beam: number;
}

/**
 * A fixed set of spotlights, created once and kept in the scene while the "Alta" preview is shown (creating and freeing
 * shadow maps at every change would be slow); unused ones stay at zero intensity so that shaders are not rebuilt.
 */
export class SpotPool {
  readonly spots: THREE.SpotLight[] = [];
  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < MAX_SHADOW_LIGHTS; i++) {
      const s = new THREE.SpotLight(0xffffff, 0, 0, 0.4, 0.4, 0);
      s.castShadow = true;
      s.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
      s.shadow.bias = -0.0008;
      s.shadow.radius = 4;
      s.shadow.camera.near = 0.3;
      s.shadow.camera.far = 60;
      s.visible = false;
      scene.add(s, s.target);
      this.spots.push(s);
    }
  }

  /** Aims the spotlights at the given lights (the first `MAX_SHADOW_LIGHTS`); the rest go dark. `on` false hides them all. */
  apply(specs: readonly SpotSpec[], on: boolean) {
    this.spots.forEach((s, i) => {
      const spec = on ? specs[i] : undefined;
      s.visible = on;
      if (!spec) {
        s.intensity = 0;
        return;
      }
      s.position.copy(spec.position);
      s.target.position.copy(spec.target);
      s.target.updateMatrixWorld();
      s.color.set(spec.color);
      s.angle = Math.min(1.2, Math.max(0.05, (spec.beam / 2) * (Math.PI / 180)));
      s.intensity = 3.2 * spec.level;
    });
  }

  dispose() {
    for (const s of this.spots) {
      s.shadow.map?.dispose();
      this.scene.remove(s, s.target);
      s.dispose();
    }
    this.spots.length = 0;
  }
}

/** The plane that only shows the shadows (over the floor, which stays as dark and flat as in the other levels). */
export function shadowCatcher(width: number, depth: number, trash: { dispose: () => void }[]): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth);
  const mat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.55 });
  trash.push(geo, mat);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.006, -depth / 2);
  m.receiveShadow = true;
  m.renderOrder = 4;
  return m;
}
