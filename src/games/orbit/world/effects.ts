/**
 * Orbital Decay's effects, over the engine's shared pools: the silent flash
 * of vaporised metal and its glittering sparks, a split's burst, the gold
 * flakes of a stripped wrap, the Derelict's venting tank, the drone's
 * thruster puffs and blue weld, a strike's grit off the glass, the pane's
 * failure (a glitter of shards, the air going out as a white gush), and
 * the glint of a facet catching the sun, drawn in the lens so a fragment
 * far out still flashes. Nothing here allocates per shot or per frame.
 *
 * Out here nothing falls: no gravity, no floor, only drag-free drift.
 */
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial, Vector3, type Group } from "three";
import { DebrisPool, type DebrisStyle } from "../../../engine/fx/debris";
import { LightPool } from "../../../engine/fx/lights";
import { ParticleSystem, type ParticleStyle } from "../../../engine/fx/particles";
import { particleAtlas } from "../../../engine/fx/textures";
import type { Quality } from "../../../engine/types";

const col = (hex: string) => new Color(hex);
const hdr = (r: number, g: number, b: number) => new Color(r, g, b);

// Colours are linear; above 1 they bloom.
const FLASH: ParticleStyle = { life: [0.1, 0.16], size: [0.9, 2.2], color: hdr(9, 8.5, 7.5), color2: hdr(2.2, 1.6, 1.1), alpha: [1, 0], gravity: 0, drag: 0, frame: 0, spin: 0 };
const VAPOUR: ParticleStyle = { life: [0.5, 0.9], size: [0.5, 2.6], color: hdr(1.4, 1.35, 1.3), color2: hdr(0.3, 0.32, 0.36), alpha: [0.5, 0], fadeIn: 0.05, gravity: 0, drag: 1.4, frame: 1, spin: 0.8 };
const SPARK: ParticleStyle = { life: [0.35, 0.9], size: [0.08, 0.03], color: hdr(7, 5.2, 2.6), color2: hdr(1.6, 0.5, 0.12), alpha: [1, 0.2], gravity: 0, drag: 0.35, frame: 0, spin: 0 };
const GLITTER: ParticleStyle = { life: [0.8, 1.8], size: [0.06, 0.04], color: hdr(4.5, 4.4, 4.2), color2: hdr(0.8, 0.8, 0.85), alpha: [1, 0], gravity: 0, drag: 0.15, frame: 2, spin: 6 };
const FLAKE: ParticleStyle = { life: [1.2, 2.4], size: [0.1, 0.07], color: hdr(2.2, 1.5, 0.45), color2: hdr(0.9, 0.55, 0.15), alpha: [1, 0], gravity: 0, drag: 0.4, frame: 3, spin: 5 };
const PLUME: ParticleStyle = { life: [0.5, 1.1], size: [0.15, 1.2], color: hdr(1.3, 1.3, 1.32), color2: hdr(0.5, 0.52, 0.55), alpha: [0.55, 0], fadeIn: 0.05, gravity: 0, drag: 0.6, frame: 1, spin: 1 };
const PUFF: ParticleStyle = { life: [0.25, 0.5], size: [0.04, 0.35], color: hdr(1.2, 1.25, 1.3), alpha: [0.5, 0], gravity: 0, drag: 2.5, frame: 1, spin: 1 };
const WELD: ParticleStyle = { life: [0.05, 0.09], size: [0.16, 0.1], color: hdr(2.5, 4.5, 9), alpha: [1, 0.3], gravity: 0, drag: 0, frame: 2, spin: 4 };
const WELD_SPARK: ParticleStyle = { life: [0.2, 0.5], size: [0.02, 0.01], color: hdr(4, 6, 9), color2: hdr(1, 1.5, 3), alpha: [1, 0], gravity: 0, drag: 0.8, frame: 0, spin: 0 };
const GRIT: ParticleStyle = { life: [0.4, 0.9], size: [0.03, 0.02], color: hdr(1.6, 1.5, 1.4), alpha: [1, 0], gravity: 0, drag: 0.2, frame: 0, spin: 0 };
const GUST: ParticleStyle = { life: [1.2, 2.4], size: [0.3, 3.2], color: hdr(1.25, 1.28, 1.32), color2: hdr(0.6, 0.62, 0.66), alpha: [0.7, 0], fadeIn: 0.04, gravity: 0, drag: 0.5, frame: 1, spin: 0.6 };
const RING_PULSE: ParticleStyle = { life: [0.5, 0.6], size: [0.4, 2.6], color: hdr(0.9, 3.2, 1.2), alpha: [0.8, 0], gravity: 0, drag: 0, frame: 0, spin: 0 };
/** A facet catching the sun: a four-point star and a thin streak, in the lens. */
const GLINT: ParticleStyle = { life: [0.05, 0.07], size: [1, 1], color: hdr(6, 5.8, 5.2), alpha: [1, 0.6], gravity: 0, drag: 0, frame: 2, spin: 0, angle: 0.4 };
const GLINT_STREAK: ParticleStyle = { life: [0.05, 0.07], size: [2.6, 2.6], color: hdr(3.6, 3.4, 3.0), alpha: [0.8, 0.4], gravity: 0, drag: 0, frame: 4, spin: 0, angle: 0 };
/** The steady point of light a fragment in the sun is, far out: redrawn every frame. */
const SPARKLE: ParticleStyle = { life: [0.018, 0.018], size: [1, 1], color: hdr(1.6, 1.55, 1.45), alpha: [0.9, 0.9], gravity: 0, drag: 0, frame: 0, spin: 0 };
const SHARDS: DebrisStyle = { life: [3, 5], scale: [0.6, 1.8], gravity: 0, bounce: 0, spin: 14, drag: 0.02 };

// Reduced flashing: the flashes at a fifth of their brightness, fading in,
// held a little longer, so they glow rather than strobe.
const SOFT = 0.2;
const soft = (s: ParticleStyle): ParticleStyle => ({
  ...s,
  life: [s.life[0] * 2, s.life[1] * 2],
  color: s.color.clone().multiplyScalar(SOFT),
  ...(s.color2 ? { color2: s.color2.clone().multiplyScalar(SOFT) } : {}),
  fadeIn: 0.4,
});
const FLASH_SOFT = soft(FLASH);
const SPARK_SOFT: ParticleStyle = { ...SPARK, color: SPARK.color.clone().multiplyScalar(0.4), color2: (SPARK.color2 as Color).clone().multiplyScalar(0.4) };
const GLITTER_SOFT: ParticleStyle = { ...GLITTER, color: GLITTER.color.clone().multiplyScalar(0.35) };
const WELD_SOFT = soft(WELD);
const GLINT_SOFT: ParticleStyle = { ...GLINT, color: GLINT.color.clone().multiplyScalar(0.35), fadeIn: 0.3 };
const GLINT_STREAK_SOFT: ParticleStyle = { ...GLINT_STREAK, color: GLINT_STREAK.color.clone().multiplyScalar(0.35), fadeIn: 0.3 };

const v = new Vector3();
const tint = new Color();

function shardGeometry(): BufferGeometry {
  // A thin irregular triangle of glass.
  const g = new BufferGeometry();
  const p = [0, 0.05, 0, -0.035, -0.03, 0.002, 0.04, -0.02, -0.002, 0, 0.05, 0, 0.04, -0.02, -0.002, -0.035, -0.03, 0.002];
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

export class Effects {
  readonly additive: ParticleSystem;
  /** Flares in the lens: drawn over everything. */
  readonly lens: ParticleSystem;
  readonly alpha: ParticleSystem;
  readonly shards: DebrisPool;
  readonly lights: LightPool;
  private random: () => number = Math.random;
  /** Settings.reducedFlashing, set by the game every frame: flashes glow instead. */
  reducedFlashing = false;
  /** The view's height at one metre, for effects sized on screen rather than in the world. */
  private viewSpan = 2 * Math.tan((62 * Math.PI) / 360);

  constructor(root: Group, quality: Quality) {
    const atlas = particleAtlas();
    const n = quality.tier === "low" ? 700 : quality.tier === "medium" ? 1400 : 2400;
    this.additive = new ParticleSystem(Math.round(n * 0.7), atlas, true);
    this.lens = new ParticleSystem(320, atlas, true, true);
    this.alpha = new ParticleSystem(Math.round(n * 0.5), atlas, false);
    const glass = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.5, transparent: true, opacity: 0.8, name: "pane-shard" });
    this.shards = new DebrisPool(shardGeometry(), glass, quality.tier === "low" ? 90 : 220);
    this.shards.mesh.castShadow = false;
    this.lights = new LightPool(root, 3);
    root.add(this.alpha.points, this.additive.points, this.lens.points, this.shards.mesh);
  }

  setRandom(random: () => number): void {
    this.random = random;
    this.additive.setRandom(random);
    this.lens.setRandom(random);
    this.alpha.setRandom(random);
    this.shards.setRandom(random);
  }

  setScale(bufferHeight: number, fov: number): void {
    this.additive.setScale(bufferHeight, fov);
    this.lens.setScale(bufferHeight, fov);
    this.alpha.setScale(bufferHeight, fov);
    this.viewSpan = 2 * Math.tan((fov * Math.PI) / 360);
  }

  update(dt: number): void {
    this.additive.update(dt);
    this.lens.update(dt);
    this.alpha.update(dt);
    this.shards.update(dt);
    this.lights.update(dt);
  }

  /** A random direction round `n` (spread 0 straight along it, 1 anywhere in front). */
  private around(n: Vector3, spread: number, out: Vector3): Vector3 {
    const r = this.random;
    out.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).multiplyScalar(spread).add(n);
    return out.normalize();
  }

  private randomDir(out: Vector3): Vector3 {
    const r = this.random;
    const u = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return out.set(Math.cos(a) * s, u, Math.sin(a) * s);
  }

  /** Far things read as they would up close: effects grow with distance, a little. */
  private reach(distance: number): number {
    return Math.max(1, distance / 22);
  }

  /** A fragment vaporised: a white-hot flash, a puff of metal vapour, sparks that glitter out. */
  vaporise(at: Vector3, drift: Vector3, size: number, distance: number, golden: boolean): void {
    const r = this.random;
    const k = this.reach(distance) * Math.max(0.6, size);
    const reduced = this.reducedFlashing;
    this.additive.emit(at.x, at.y, at.z, drift.x, drift.y, drift.z, reduced ? FLASH_SOFT : FLASH, k, golden ? tint.setRGB(9, 7, 2.5) : undefined);
    for (let i = 0; i < 3; i++) this.additive.emit(at.x, at.y, at.z, drift.x + (r() - 0.5), drift.y + (r() - 0.5), drift.z + (r() - 0.5), VAPOUR, k * 0.8);
    for (let i = 0; i < 22; i++) {
      this.randomDir(v).multiplyScalar((2 + r() * 7) * Math.min(3, k));
      this.additive.emit(at.x, at.y, at.z, drift.x + v.x, drift.y + v.y, drift.z + v.z, reduced ? SPARK_SOFT : SPARK, Math.min(3, k));
    }
    for (let i = 0; i < 14; i++) {
      this.randomDir(v).multiplyScalar((0.6 + r() * 2.5) * Math.min(3, k));
      this.additive.emit(at.x, at.y, at.z, drift.x + v.x, drift.y + v.y, drift.z + v.z, reduced ? GLITTER_SOFT : GLITTER, Math.min(3, k));
    }
    this.flashLight(at, tint.setRGB(1, 0.92, 0.8), 30 * k, 10 * k, 0.12);
  }

  /** A split: a smaller flash where the laser cut, a spray of sparks. */
  split(at: Vector3, drift: Vector3, distance: number): void {
    const r = this.random;
    const k = this.reach(distance);
    const reduced = this.reducedFlashing;
    this.additive.emit(at.x, at.y, at.z, drift.x, drift.y, drift.z, reduced ? FLASH_SOFT : FLASH, k * 0.6);
    for (let i = 0; i < 14; i++) {
      this.randomDir(v).multiplyScalar((2 + r() * 6) * Math.min(3, k));
      this.additive.emit(at.x, at.y, at.z, drift.x + v.x, drift.y + v.y, drift.z + v.z, reduced ? SPARK_SOFT : SPARK, Math.min(3, k));
    }
  }

  /** The gold wrap torn off: flakes of foil tumbling away. */
  flakes(at: Vector3, drift: Vector3, distance: number): void {
    const r = this.random;
    const k = Math.min(3, this.reach(distance));
    for (let i = 0; i < 26; i++) {
      this.randomDir(v).multiplyScalar(0.8 + r() * 2.2);
      this.additive.emit(at.x + v.x * 0.2, at.y + v.y * 0.2, at.z + v.z * 0.2, drift.x + v.x, drift.y + v.y, drift.z + v.z, FLAKE, k);
    }
  }

  /** A shot the Derelict's armour shrugs off: a few sparks. */
  deflect(at: Vector3, normal: Vector3, distance: number): void {
    const r = this.random;
    const k = Math.min(3, this.reach(distance));
    for (let i = 0; i < 8; i++) {
      this.around(normal, 0.9, v).multiplyScalar(3 + r() * 5);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, this.reducedFlashing ? SPARK_SOFT : SPARK, k);
    }
  }

  /** The Derelict's tank venting a thin plume along `dir`. */
  plume(at: Vector3, dir: Vector3, drift: Vector3, strength: number): void {
    const r = this.random;
    this.around(dir, 0.15, v).multiplyScalar(4 + r() * 4);
    this.alpha.emit(at.x, at.y, at.z, drift.x + v.x, drift.y + v.y, drift.z + v.z, PLUME, strength);
  }

  /** A puff of cold gas from a thruster. */
  thruster(at: Vector3, dir: Vector3): void {
    const r = this.random;
    for (let i = 0; i < 2; i++) {
      this.around(dir, 0.25, v).multiplyScalar(1.5 + r() * 1.5);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, PUFF, 1);
    }
  }

  /** The drone's weld: a blue-white arc and its sparks, lighting the glass. */
  weld(at: Vector3, normal: Vector3): void {
    const r = this.random;
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, this.reducedFlashing ? WELD_SOFT : WELD, 0.8 + r() * 0.6);
    if (r() < 0.6) {
      this.around(normal, 1, v).multiplyScalar(0.6 + r() * 1.4);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, WELD_SPARK);
    }
    if (r() < 0.25) this.flashLight(at, tint.setRGB(0.5, 0.75, 1), 3.5, 3, 0.08);
  }

  /** A strike on the glass or the metal: grit and sparks thrown back out. */
  strike(at: Vector3, outward: Vector3, size: number): void {
    const r = this.random;
    const n = Math.round(10 + size * 14);
    for (let i = 0; i < n; i++) {
      this.around(outward, 0.9, v).multiplyScalar(0.8 + r() * 3.5);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, GRIT, 0.6 + size * 0.5);
    }
    for (let i = 0; i < 8; i++) {
      this.around(outward, 1, v).multiplyScalar(2 + r() * 4);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, this.reducedFlashing ? SPARK_SOFT : SPARK, 0.35);
    }
  }

  /** A pane gives way: its glass bursts outward in a glitter of shards, and the air with it. */
  burst(center: Vector3, outward: Vector3, radius: number): void {
    const r = this.random;
    const side = new Vector3().copy(outward).cross(Math.abs(outward.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    const up = new Vector3().copy(outward).cross(side).normalize();
    for (let i = 0; i < 160; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * radius;
      const x = center.x + (side.x * Math.cos(a) + up.x * Math.sin(a)) * d;
      const y = center.y + (side.y * Math.cos(a) + up.y * Math.sin(a)) * d;
      const z = center.z + (side.z * Math.cos(a) + up.z * Math.sin(a)) * d;
      this.around(outward, 0.5, v).multiplyScalar(3 + r() * 14);
      tint.setRGB(0.85 + r() * 0.15, 0.9 + r() * 0.1, 0.95);
      this.shards.emit(x, y, z, v.x, v.y, v.z, -1e9, SHARDS, tint);
    }
    for (let i = 0; i < 60; i++) {
      this.around(outward, 0.6, v).multiplyScalar(2 + r() * 10);
      this.additive.emit(center.x, center.y, center.z, v.x, v.y, v.z, this.reducedFlashing ? GLITTER_SOFT : GLITTER, 1.5);
    }
    // The air, going out: a white gush of condensation.
    for (let i = 0; i < 40; i++) {
      this.around(outward, 0.45, v).multiplyScalar(4 + r() * 12);
      this.alpha.emit(center.x, center.y, center.z, v.x, v.y, v.z, GUST, 1 + r());
    }
  }

  /** A running light hit in the aim check: a soft green ring swells round it. */
  pulse(at: Vector3, distance: number): void {
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, RING_PULSE, Math.max(1, distance * 0.08));
  }

  /**
   * A facet flashing in the sun: a star and a thin streak held the same size
   * on screen whatever the distance, as bright as the reflection is square.
   */
  glint(at: Vector3, distance: number, strength: number, blue = false): void {
    const k = Math.max(1, distance) * this.viewSpan * 0.03 * Math.min(1.4, 0.5 + strength);
    const c = blue ? tint.setRGB(2.2 * strength, 3.6 * strength, 6 * strength) : tint.setRGB(6 * strength, 5.8 * strength, 5.2 * strength);
    const reduced = this.reducedFlashing;
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, reduced ? GLINT_SOFT : GLINT, k, reduced ? c.multiplyScalar(0.35) : c);
    if (strength > 0.55) this.additive.emit(at.x, at.y, at.z, 0, 0, 0, reduced ? GLINT_STREAK_SOFT : GLINT_STREAK, k, reduced ? undefined : blue ? tint.setRGB(1.6, 2.6, 4.4) : undefined);
  }

  /** A fragment in the sun, far out, as a point of light a few pixels across. */
  sparkle(at: Vector3, distance: number, strength: number): void {
    const k = Math.max(1, distance) * this.viewSpan * 0.006;
    // In the world, not the lens: the cupola's frame hides what is behind it.
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, SPARKLE, k, tint.setRGB(1.6 * strength, 1.55 * strength, 1.45 * strength));
  }

  /**
   * A light that flashes on for a moment. With reduced flashing it is a fifth
   * as bright and fades three times as long.
   */
  flashLight(at: Vector3, color: Color, intensity: number, distance: number, duration: number): void {
    if (this.reducedFlashing) this.lights.flash(at, color, intensity * SOFT, distance, duration * 3);
    else this.lights.flash(at, color, intensity, distance, duration);
  }

  clearAll(): void {
    this.additive.clear();
    this.lens.clear();
    this.alpha.clear();
    this.shards.clear();
  }

  dispose(): void {
    this.additive.dispose();
    this.lens.dispose();
    this.alpha.dispose();
    this.shards.dispose();
    this.lights.dispose();
  }
}

export { col };
