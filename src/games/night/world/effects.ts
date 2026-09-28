import { BoxGeometry, BufferAttribute, BufferGeometry, Color, MeshStandardMaterial, Vector3, type Group } from "three";
import { DebrisPool, type DebrisStyle } from "../../../engine/fx/debris";
import { DecalPool } from "../../../engine/fx/decals";
import { LightPool } from "../../../engine/fx/lights";
import { ParticleSystem, type ParticleStyle } from "../../../engine/fx/particles";
import { bulletHoleTexture, particleAtlas } from "../../../engine/fx/textures";
import type { Quality } from "../../../engine/types";
import type { NightUniforms } from "./shading";
import type { Surface } from "./road";

const col = (hex: string) => new Color(hex);
const hdr = (r: number, g: number, b: number) => new Color(r, g, b);

// Particle presets. Colours are linear; above 1 they bloom. At night the
// dust and smoke are dark: they show where the beam or a lamp is on them.
const GRIT: ParticleStyle = { life: [0.35, 0.7], size: [0.025, 0.018], color: col("#2e2c29"), alpha: [1, 0.6], gravity: 9.8, drag: 0.4, frame: 0, spin: 0, floor: 0.01 };
const DUST: ParticleStyle = { life: [0.6, 1.2], size: [0.1, 0.45], color: col("#4a4740"), alpha: [0.45, 0], fadeIn: 0.08, gravity: -0.1, drag: 2.6, frame: 1, spin: 0.8 };
const LEAF: ParticleStyle = { life: [0.8, 1.6], size: [0.05, 0.04], color: col("#5d5638"), alpha: [1, 0.2], gravity: 1.6, drag: 2.2, frame: 3, spin: 6, floor: 0.02 };
const SAND: ParticleStyle = { life: [0.5, 0.9], size: [0.02, 0.015], color: col("#6e6250"), alpha: [1, 0.5], gravity: 9.8, drag: 0.6, frame: 0, spin: 0, floor: 0.01 };
const SPARK: ParticleStyle = { life: [0.15, 0.35], size: [0.045, 0.02], color: hdr(6, 4, 1.8), color2: hdr(2, 0.6, 0.1), alpha: [1, 0.5], gravity: 6, drag: 1.2, frame: 0, spin: 0 };
const SPARK_SOFT: ParticleStyle = { ...SPARK, color: SPARK.color.clone().multiplyScalar(0.2), color2: (SPARK.color2 as Color).clone().multiplyScalar(0.2) };
const DROPLET: ParticleStyle = { life: [0.5, 0.9], size: [0.045, 0.03], color: col("#28303a"), alpha: [0.8, 0.2], gravity: 9.8, drag: 0.3, frame: 0, spin: 0, floor: 0.02 };
// The dead's dark spray: a puff, never more.
const SPRAY: ParticleStyle = { life: [0.25, 0.5], size: [0.06, 0.24], color: col("#1a0806"), alpha: [0.75, 0], gravity: 2, drag: 3, frame: 1, spin: 1 };
const SPRAY_DROP: ParticleStyle = { life: [0.35, 0.6], size: [0.025, 0.02], color: col("#140504"), alpha: [0.9, 0.3], gravity: 9.8, drag: 0.8, frame: 0, spin: 0, floor: 0.01 };
// The bloater's burst: a sickly cloud that hangs, and wet matter raining down.
const GAS: ParticleStyle = { life: [1.8, 3.2], size: [0.6, 3.2], color: col("#5f6a3a"), color2: col("#3a4230"), alpha: [0.55, 0], fadeIn: 0.1, gravity: -0.15, drag: 1.4, frame: 1, spin: 0.3 };
const GAS_GLOW: ParticleStyle = { life: [0.12, 0.2], size: [1.2, 2.2], color: hdr(0.9, 1.1, 0.4), alpha: [0.6, 0], gravity: 0, drag: 0, frame: 0, spin: 0 };
const MATTER: ParticleStyle = { life: [0.7, 1.2], size: [0.05, 0.04], color: col("#2a2c14"), alpha: [1, 0.4], gravity: 9.8, drag: 0.4, frame: 0, spin: 0, floor: 0.01 };
// The player's shot: smoke curling from the unseen barrel in the lower right.
const PUFF: ParticleStyle = { life: [0.6, 1.1], size: [0.02, 0.16], color: col("#9a9aa0"), alpha: [0.14, 0], fadeIn: 0.15, gravity: -0.2, drag: 2, frame: 1, spin: 0.8 };
const FLASH: ParticleStyle = { life: [0.045, 0.07], size: [0.3, 0.2], color: hdr(6, 3.8, 1.6), color2: hdr(3, 1.2, 0.3), alpha: [1, 0.2], gravity: 0, drag: 0, frame: 2, spin: 0 };
const FLASH_SOFT: ParticleStyle = { ...FLASH, life: [0.16, 0.22], color: FLASH.color.clone().multiplyScalar(0.2), color2: (FLASH.color2 as Color).clone().multiplyScalar(0.2), alpha: [0.8, 0], fadeIn: 0.4 };
// A mason jar bursting: glass glints, the candle's embers, a puff of wax smoke.
const EMBER: ParticleStyle = { life: [0.4, 0.9], size: [0.03, 0.01], color: hdr(4, 2, 0.6), color2: hdr(1, 0.3, 0.05), alpha: [1, 0.3], gravity: 3, drag: 1.2, frame: 0, spin: 0 };
const WAX_SMOKE: ParticleStyle = { life: [1.2, 2.2], size: [0.05, 0.45], color: col("#8a8680"), alpha: [0.3, 0], fadeIn: 0.15, gravity: -0.45, drag: 1.6, frame: 1, spin: 0.7 };
const GLINT: ParticleStyle = { life: [0.3, 0.36], size: [0.18, 0.05], color: hdr(4, 3.6, 2.8), alpha: [1, 0], gravity: 0, drag: 0, frame: 2, spin: 2.5 };
const CANDLE: ParticleStyle = { life: [0.12, 0.16], size: [0.09, 0.07], color: hdr(3.2, 1.7, 0.5), alpha: [0.9, 0.5], gravity: 0, drag: 0, frame: 0, spin: 0 };

const SHARDS: DebrisStyle = { life: [2.5, 4], scale: [0.5, 1.4], gravity: 9.8, bounce: 0.3, spin: 18, drag: 0.2 };
const SPLINTERS: DebrisStyle = { life: [2, 3.5], scale: [0.6, 1.3], gravity: 9.8, bounce: 0.25, spin: 20, drag: 0.4 };

/** A flashing light, reduced: a fifth as bright, fading three times as long. */
const SOFT = 0.2;
const SOFT_TIME = 3;

const v = new Vector3();
const t1 = new Vector3();
const tint = new Color();

function shardGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const p = [0, 0.05, 0, -0.03, -0.03, 0.002, 0.035, -0.02, -0.002, 0, 0.05, 0, 0.035, -0.02, -0.002, -0.03, -0.03, 0.002];
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Dead of Night's effects, over the engine's shared pools: impacts by
 * surface, the dead's dark spray (a puff, PG-13), the bloater's burst, the
 * rifle's flash and smoke, sparks off the Mechanic's mask, the jars. The
 * muzzle flash lights the barricade for a frame: the characters through
 * the pooled lights, the baked road through the night's `uFlash` uniform.
 * With reduced flashing every flash is a fifth as bright and fades in.
 */
export class Effects {
  readonly additive: ParticleSystem;
  readonly alpha: ParticleSystem;
  readonly shards: DebrisPool;
  readonly splinters: DebrisPool;
  readonly decals: DecalPool;
  readonly lights: LightPool;
  private random: () => number = Math.random;
  reducedFlashing = false;
  /** The muzzle flash on the baked road: its peak and what is left of it. */
  private flash = 0;
  private flashPeak = new Color();
  private flashTime = 0.08;
  private readonly flashAt = new Vector3();

  constructor(
    root: Group,
    quality: Quality,
    private readonly u: NightUniforms,
  ) {
    const atlas = particleAtlas();
    const n = quality.tier === "low" ? 700 : quality.tier === "medium" ? 1300 : 2200;
    this.additive = new ParticleSystem(Math.round(n * 0.5), atlas, true);
    this.alpha = new ParticleSystem(n, atlas, false);
    const glassMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75, name: "shard" });
    const woodMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, name: "splinter" });
    this.shards = new DebrisPool(shardGeometry(), glassMat, quality.tier === "low" ? 80 : 180);
    this.splinters = new DebrisPool(new BoxGeometry(0.012, 0.012, 0.09), woodMat, quality.tier === "low" ? 60 : 140);
    this.decals = new DecalPool(bulletHoleTexture(), quality.tier === "low" ? 40 : 96);
    this.lights = new LightPool(root, 3);
    for (const d of [this.shards, this.splinters]) {
      d.mesh.castShadow = false;
      root.add(d.mesh);
    }
    root.add(this.alpha.points, this.additive.points, this.decals.mesh);
  }

  /** The debris' materials, for the night's fog. */
  get materials(): MeshStandardMaterial[] {
    return [this.shards.mesh.material as MeshStandardMaterial, this.splinters.mesh.material as MeshStandardMaterial];
  }

  setRandom(random: () => number): void {
    this.random = random;
    this.additive.setRandom(random);
    this.alpha.setRandom(random);
    this.shards.setRandom(random);
    this.splinters.setRandom(random);
  }

  setScale(bufferHeight: number, fov: number): void {
    this.additive.setScale(bufferHeight, fov);
    this.alpha.setScale(bufferHeight, fov);
  }

  update(dt: number): void {
    this.additive.update(dt);
    this.alpha.update(dt);
    this.shards.update(dt);
    this.splinters.update(dt);
    this.lights.update(dt);
    // The flash on the road fades as the pooled light's does (as the square of what is left).
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / this.flashTime);
      this.u.uFlashPos.value.copy(this.flashAt);
      this.u.uFlashColor.value.copy(this.flashPeak).multiplyScalar(this.flash * this.flash);
    } else {
      this.u.uFlashColor.value.setRGB(0, 0, 0);
    }
  }

  private scatter(n: Vector3, spread: number, out: Vector3): Vector3 {
    const r = this.random;
    out.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).multiplyScalar(spread).add(n);
    return out.normalize();
  }

  /** A bullet meets the road. */
  impact(surface: Surface, at: Vector3, normal: Vector3, floorY: number, hole = true): void {
    const r = this.random;
    switch (surface) {
      case "wood":
        for (let i = 0; i < 6; i++) {
          this.scatter(normal, 0.9, v).multiplyScalar(2.5 + r() * 3.5);
          tint.setRGB(0.3 + r() * 0.1, 0.24, 0.16);
          this.splinters.emit(at.x, at.y, at.z, v.x, v.y + 1, v.z, floorY, SPLINTERS, tint);
        }
        this.puff(at, normal, 0.6);
        if (hole) this.decals.add(at, normal, 0.07 + r() * 0.03, r() * 6.28, tint.setRGB(0.2, 0.19, 0.18));
        break;
      case "metal":
        for (let i = 0; i < 10; i++) {
          this.scatter(normal, 1.0, v).multiplyScalar(3 + r() * 5);
          this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, this.reducedFlashing ? SPARK_SOFT : SPARK);
        }
        if (hole) this.decals.add(at, normal, 0.045, r() * 6.28, tint.setRGB(0.25, 0.25, 0.26));
        break;
      case "glass":
        this.glass(at, normal, 8, floorY);
        break;
      case "water":
        for (let i = 0; i < 12; i++) {
          v.set((r() - 0.5) * 1.4, 1.8 + r() * 2.2, (r() - 0.5) * 1.4);
          this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, DROPLET);
        }
        break;
      case "plant":
        for (let i = 0; i < 10; i++) {
          this.scatter(normal, 1.2, v).multiplyScalar(0.8 + r() * 1.8);
          this.alpha.emit(at.x, at.y, at.z, v.x, v.y + 0.5, v.z, LEAF, 1 + r());
        }
        break;
      case "sandbag":
        for (let i = 0; i < 12; i++) {
          this.scatter(normal, 0.5, v).multiplyScalar(0.4 + r() * 1.2);
          this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, SAND);
        }
        this.puff(at, normal, 0.5);
        break;
      case "cloth":
        this.puff(at, normal, 0.4);
        break;
      default:
        // Asphalt and dirt: grit flung up and a low puff.
        for (let i = 0; i < 9; i++) {
          this.scatter(normal, 0.5, v).multiplyScalar(2 + r() * 3);
          this.alpha.emit(at.x, at.y + 0.02, at.z, v.x, v.y, v.z, GRIT);
        }
        this.puff(at, normal, 0.8);
        if (hole && surface === "asphalt") this.decals.add(at, normal, 0.06, r() * 6.28, tint.setRGB(0.12, 0.12, 0.12));
        break;
    }
  }

  /** A low puff of dust (a bullet in the dirt, a body falling, a vault). */
  puff(at: Vector3, normal: Vector3, scale: number): void {
    const r = this.random;
    for (let i = 0; i < 6 * scale + 2; i++) {
      this.scatter(normal, 0.7, v).multiplyScalar((0.6 + r() * 1.4) * scale);
      this.alpha.emit(at.x, at.y + 0.05, at.z, v.x, v.y, v.z, DUST, 0.7 + scale * 0.5);
    }
  }

  glass(at: Vector3, normal: Vector3, count: number, floorY: number, color = col("#9fb3b8")): void {
    const r = this.random;
    for (let i = 0; i < count; i++) {
      this.scatter(normal, 1.1, v).multiplyScalar(1 + r() * 3.2);
      tint.copy(color).multiplyScalar(0.8 + r() * 0.5);
      this.shards.emit(at.x + (r() - 0.5) * 0.15, at.y + (r() - 0.5) * 0.15, at.z + (r() - 0.5) * 0.15, v.x, v.y + 1.2, v.z, floorY, SHARDS, tint);
    }
    for (let i = 0; i < 4; i++) {
      this.scatter(normal, 1, v).multiplyScalar(1 + r() * 2);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, GLINT, 0.35);
    }
  }

  /** The dead's dark spray where a bullet went in: a puff, never more. */
  spray(at: Vector3, away: Vector3, headshot: boolean): void {
    const r = this.random;
    const n = headshot ? 7 : 4;
    for (let i = 0; i < n; i++) {
      this.scatter(away, 0.6, v).multiplyScalar(0.5 + r() * 1.3);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, SPRAY, headshot ? 1 : 0.8);
    }
    for (let i = 0; i < n; i++) {
      this.scatter(away, 0.5, v).multiplyScalar(1.2 + r() * 2);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, SPRAY_DROP);
    }
  }

  /** A bloater bursting: the cloud that hangs, the matter raining down, a sickly flare. */
  burst(at: Vector3, floorY: number): void {
    const r = this.random;
    for (let i = 0; i < 26; i++) {
      v.set(r() - 0.5, r() * 0.7, r() - 0.5).normalize().multiplyScalar(0.8 + r() * 2.6);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, GAS, 1);
    }
    for (let i = 0; i < 30; i++) {
      v.set(r() - 0.5, r() * 0.8 + 0.3, r() - 0.5).normalize().multiplyScalar(3 + r() * 5);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, { ...MATTER, floor: floorY + 0.01 });
    }
    if (!this.reducedFlashing) this.additive.emit(at.x, at.y, at.z, 0, 0, 0, GAS_GLOW, 1);
  }

  /** Sparks off the Mechanic's mask. */
  sparks(at: Vector3, normal: Vector3): void {
    const r = this.random;
    for (let i = 0; i < 14; i++) {
      this.scatter(normal, 1.0, v).multiplyScalar(3 + r() * 5);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, this.reducedFlashing ? SPARK_SOFT : SPARK);
    }
    this.flashLight(at, tint.setRGB(1, 0.75, 0.45), 2.5, 4, 0.06);
  }

  /**
   * The rifle fires: a flash at the unseen muzzle low in the right of the
   * view, the smoke curling from it, and its light on the barricade and on
   * whoever stands there - for a frame, or a fifth as bright and fading in
   * with reduced flashing.
   */
  muzzle(at: Vector3, dir: Vector3, golden: boolean): void {
    const r = this.random;
    const reduced = this.reducedFlashing;
    this.additive.emit(at.x, at.y, at.z, dir.x, dir.y, dir.z, reduced ? FLASH_SOFT : FLASH, 1, golden ? tint.setRGB(reduced ? 1.4 : 7, reduced ? 0.9 : 4.6, reduced ? 0.2 : 1) : undefined);
    for (let i = 0; i < 3; i++) {
      this.scatter(dir, 0.5, v).multiplyScalar(0.3 + r() * 0.5);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y + 0.12, v.z, PUFF, 1.2);
    }
    t1.copy(at).addScaledVector(dir, 1.2);
    const c = golden ? tint.setRGB(1, 0.8, 0.4) : tint.setRGB(1, 0.72, 0.45);
    this.flashLight(t1, c, 14, 9, 0.07);
  }

  /** A light that flashes on for a moment, on the characters and the baked road alike. */
  flashLight(at: Vector3, color: Color, intensity: number, distance: number, duration: number): void {
    const k = this.reducedFlashing ? SOFT : 1;
    const time = this.reducedFlashing ? duration * SOFT_TIME : duration;
    this.lights.flash(at, color, intensity * k, distance, time);
    this.flash = 1;
    this.flashTime = time;
    this.flashAt.copy(at);
    this.flashPeak.copy(color).multiplyScalar(intensity * k);
  }

  /** A mason jar bursting: glass, the candle's embers, a puff of wax smoke. */
  jar(at: Vector3, normal: Vector3, floorY: number): void {
    const r = this.random;
    this.glass(at, normal, 18, floorY, col("#b8c8c0"));
    for (let i = 0; i < 10; i++) {
      v.set((r() - 0.5) * 2, 0.6 + r() * 2, (r() - 0.5) * 2);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, this.reducedFlashing ? SPARK_SOFT : EMBER);
    }
    for (let i = 0; i < 5; i++) this.alpha.emit(at.x, at.y, at.z, (r() - 0.5) * 0.3, 0.3 + r() * 0.3, (r() - 0.5) * 0.3, WAX_SMOKE, 1);
  }

  /** A candle's flame, flickering (a jar's, the lit one brighter): one short-lived glow a frame. */
  candle(at: Vector3, size: number): void {
    this.additive.emit(at.x, at.y, at.z, 0, 0.05, 0, CANDLE, size);
  }

  /** A glint of glass (the lit jar's). */
  glint(at: Vector3, size: number): void {
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, GLINT, size / 0.2);
  }

  clearTransient(): void {
    this.additive.clear();
    this.alpha.clear();
  }

  clearAll(): void {
    this.clearTransient();
    this.shards.clear();
    this.splinters.clear();
    this.decals.clear();
    this.flash = 0;
  }

  dispose(): void {
    this.additive.dispose();
    this.alpha.dispose();
    this.shards.dispose();
    this.splinters.dispose();
    this.decals.dispose();
    this.lights.dispose();
  }
}
