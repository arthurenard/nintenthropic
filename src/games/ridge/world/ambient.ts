/**
 * The valley's morning, besides its people: mist lying on the river in soft
 * banks that drift with the wind and thin as the sun climbs; the checkpoint's
 * flag, which shows the wind as honestly as the readout does; and the sound
 * of the place - wind in the grass on the ridge, the river far below,
 * birdsong, cowbells as the cows shift, a dog at the farm, the chapel's bell
 * on the hour.
 */
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type BufferAttribute,
  type Group,
} from "three";
import type { Sound } from "../../../engine/world/sound";
import type { Actor } from "../rules/actors";
import type { V3 } from "../rules/types";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "./atmosphere";

/** A soft round bank of mist, painted once. */
function mistTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 36, 4, 64, 36, 60);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const MIST_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vAtmoWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vAtmoWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const MIST_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vAtmoWorld;
${ATMOSPHERE_GLSL}
void main() {
  float a = texture2D(uMap, vUv).a * uOpacity;
  // Lit by the sky; where the sun reaches it, warm.
  vec2 light = atmoLight(vAtmoWorld);
  float sun = smoothstep(light.r - 0.012, light.r + 0.012, uSunElev);
  vec3 c = uMistColor * 1.05 + uSunColor * sun * 0.25;
  // Softly broken up, and moving.
  a *= 0.6 + 0.6 * atmoNoise(vAtmoWorld.xz * 0.05 + uWindDrift * 8.0 + uTime * 0.02);
  gl_FragColor = vec4(atmoAir(c, vAtmoWorld), a);
}
`;

interface Bank {
  mesh: Mesh;
  base: Vector3;
  drift: number;
  opacity: number;
}

export class Ambient {
  private readonly banks: Bank[] = [];
  private t = 0;
  private cowbell = 2;
  private dog = 14;
  private readonly flagBase: Float32Array | null;
  /** The run's own clock, for the chapel's bell on the hour. */
  private hourAt = 150;

  constructor(
    parent: Group,
    atmosphere: AtmosphereUniforms,
    river: V3[],
    private readonly sound: Sound,
    private readonly flag: Mesh | null,
    private readonly bell: V3 | null,
  ) {
    const map = mistTexture();
    // Each bank its own opacity; the valley's air and the texture shared.
    const material = () =>
      new ShaderMaterial({
        uniforms: { ...atmosphere, uMap: { value: map }, uOpacity: { value: 0.5 } },
        vertexShader: MIST_VERT,
        fragmentShader: MIST_FRAG,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
    // Banks of mist along the river, lying on the water, each its own opacity (they share the rest).
    for (let i = 0; i < river.length - 1; i++) {
      const a = river[i]!;
      const b = river[i + 1]!;
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 55));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const w = 70 + ((i * 37 + k * 11) % 50);
        const geo = new PlaneGeometry(w, w * 0.18);
        const mesh = new Mesh(geo, material());
        const base = new Vector3(a.x + (b.x - a.x) * u, a.y + 2.5 + ((i + k) % 3) * 1.2, a.z + (b.z - a.z) * u);
        mesh.position.copy(base);
        mesh.renderOrder = 3;
        parent.add(mesh);
        this.banks.push({ mesh, base, drift: ((i * 13 + k * 7) % 10) / 10, opacity: 0.35 + ((i * 7 + k * 3) % 5) * 0.06 });
      }
    }
    this.flagBase = flag ? Float32Array.from((flag.geometry.getAttribute("position") as BufferAttribute).array) : null;
  }

  /** The morning's loops start (and survive pauses: Sound restarts them). */
  start(riverNear: V3 | null): void {
    this.sound.loop("wind", "ridge_wind_grass", { volume: 0.55 });
    this.sound.loop("birds", "ridge_birds", { volume: 0.5 });
    if (riverNear) this.sound.loop("river", "ridge_river", this.sound.place(riverNear, { volume: 0.9 }));
    if (this.bell) this.sound.at("ridge_church_bell", this.bell, 0.8, 1, 1.2);
  }

  /**
   * Once a frame: the mist drifts with the wind and thins with `mist`
   * (0..1), faces the eye as a low bank does; the flag flies; now and then
   * a cowbell, a dog, the bell on the hour.
   */
  update(dt: number, windX: number, mist: number, eye: Vector3, cows: Actor[], dogAt: V3 | null): void {
    this.t += dt;
    for (const b of this.banks) {
      b.drift += (windX * dt) / 400;
      const swing = Math.sin(this.t * 0.03 + b.base.x * 0.01) * 20;
      b.mesh.position.set(b.base.x + b.drift * 60 + swing, b.base.y, b.base.z);
      b.mesh.lookAt(eye.x, b.base.y + (eye.y - b.base.y) * 0.15, eye.z);
      (b.mesh.material as ShaderMaterial).uniforms["uOpacity"]!.value = b.opacity * Math.max(0, mist) * 1.1;
      b.mesh.visible = mist > 0.03;
    }
    this.flyFlag(windX);
    this.cowbell -= dt;
    if (this.cowbell <= 0 && cows.length) {
      const cow = cows[Math.floor((this.t * 7.13) % cows.length)]!;
      this.sound.at("ridge_cowbell", cow.pos, 0.9, 1, 0);
      this.cowbell = 2.5 + ((this.t * 3.7) % 5);
      if (((this.t * 1.3) % 1) < 0.12) this.sound.at("ridge_cow_moo", cow.pos, 0.7);
    }
    this.dog -= dt;
    if (this.dog <= 0 && dogAt) {
      this.sound.at("ridge_dog", dogAt, 0.8);
      this.dog = 25 + ((this.t * 5.3) % 30);
    }
    this.hourAt -= dt;
    if (this.hourAt <= 0 && this.bell) {
      // The chapel keeps the hours: on this ridge an hour passes in a few minutes.
      this.hourAt = 180;
      for (let k = 0; k < 3; k++) this.sound.at("ridge_church_bell", this.bell, 0.75, 1, k * 2.2);
    }
  }

  /** The flag: its cloth rippling along its length, streaming the way the wind blows, harder the stronger. */
  private flyFlag(windX: number): void {
    const flag = this.flag;
    const base = this.flagBase;
    if (!flag || !base) return;
    const pos = flag.geometry.getAttribute("position") as BufferAttribute;
    const strength = Math.min(1, Math.abs(windX) / 7);
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!;
      const y = base[i * 3 + 1]!;
      const u = x / 1.8;
      const wave = Math.sin(this.t * (5 + strength * 5) - u * 7) * u * (0.12 + 0.18 * strength);
      // Limp in a light breeze, streaming in a strong one.
      const droop = (1 - strength) * u * u * 0.9;
      pos.setXYZ(i, x * (0.55 + 0.45 * strength), y - droop, wave);
    }
    pos.needsUpdate = true;
    flag.geometry.computeVertexNormals();
    flag.rotation.y = windX >= 0 ? 0 : Math.PI;
  }

  reset(): void {
    this.hourAt = 150;
  }

  dispose(): void {
    for (const b of this.banks) {
      b.mesh.geometry.dispose();
      (b.mesh.material as ShaderMaterial).dispose();
    }
  }
}
