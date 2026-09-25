import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshStandardMaterial,
  Vector3,
  type Group,
} from "three";
import { DebrisPool, type DebrisStyle } from "../../../engine/fx/debris";
import { DecalPool } from "../../../engine/fx/decals";
import { LightPool } from "../../../engine/fx/lights";
import { ParticleSystem, type ParticleStyle } from "../../../engine/fx/particles";
import { bulletHoleTexture, particleAtlas } from "../../../engine/fx/textures";
import type { Quality } from "../../../engine/types";
import type { Surface } from "./town";

const col = (hex: string) => new Color(hex);
const hdr = (r: number, g: number, b: number) => new Color(r, g, b);

// Particle presets. Colours are linear; above 1 they bloom.
const DUST: ParticleStyle = { life: [0.7, 1.3], size: [0.12, 0.55], color: col("#c9a882"), alpha: [0.55, 0], fadeIn: 0.08, gravity: -0.15, drag: 2.6, frame: 1, spin: 0.8 };
const DUST_PALE: ParticleStyle = { ...DUST, color: col("#d9c3a2") };
const GRIT: ParticleStyle = { life: [0.4, 0.8], size: [0.03, 0.02], color: col("#7a5c40"), alpha: [1, 0.6], gravity: 9.8, drag: 0.4, frame: 0, spin: 0, floor: 0.01 };
const SMOKE: ParticleStyle = { life: [0.9, 1.6], size: [0.08, 0.6], color: col("#bdb3a6"), alpha: [0.35, 0], fadeIn: 0.1, gravity: -0.35, drag: 1.8, frame: 1, spin: 0.6 };
const FLASH: ParticleStyle = { life: [0.05, 0.075], size: [0.55, 0.35], color: hdr(6, 3.6, 1.5), color2: hdr(3, 1.2, 0.3), alpha: [1, 0.2], gravity: 0, drag: 0, frame: 2, spin: 0 };
const FLASH_CORE: ParticleStyle = { life: [0.04, 0.06], size: [0.3, 0.2], color: hdr(9, 8, 6), alpha: [1, 0.5], gravity: 0, drag: 0, frame: 0, spin: 0 };
const SPARK: ParticleStyle = { life: [0.15, 0.4], size: [0.05, 0.02], color: hdr(6, 4, 1.8), color2: hdr(2, 0.6, 0.1), alpha: [1, 0.5], gravity: 6, drag: 1.2, frame: 0, spin: 0 };
const GLINT: ParticleStyle = { life: [0.32, 0.36], size: [0.2, 0.05], color: hdr(5, 4.6, 3.8), alpha: [1, 0], gravity: 0, drag: 0, frame: 2, spin: 2.5 };
const DROPLET: ParticleStyle = { life: [0.5, 0.9], size: [0.05, 0.03], color: col("#9fc0c8"), alpha: [0.8, 0.2], gravity: 9.8, drag: 0.3, frame: 0, spin: 0, floor: 0.02 };
const MIST: ParticleStyle = { life: [0.4, 0.8], size: [0.1, 0.45], color: col("#d6e4e6"), alpha: [0.4, 0], gravity: 0.5, drag: 2.5, frame: 1, spin: 0.5 };
const BLOOD: ParticleStyle = { life: [0.25, 0.45], size: [0.08, 0.22], color: col("#5a0a06"), alpha: [0.7, 0], gravity: 2, drag: 3, frame: 1, spin: 1 };
const FIRE: ParticleStyle = { life: [0.3, 0.6], size: [0.9, 2.4], color: hdr(3.2, 1.3, 0.3), color2: hdr(0.6, 0.12, 0.02), alpha: [1, 0], gravity: -2.5, drag: 3, frame: 1, spin: 1.5 };
const FIRE_CORE: ParticleStyle = { life: [0.08, 0.14], size: [1.6, 2.4], color: hdr(4, 2.6, 1.2), alpha: [1, 0], gravity: 0, drag: 0, frame: 0, spin: 0 };
const BLAST_SMOKE: ParticleStyle = { life: [1.8, 3.2], size: [0.9, 3.8], color: col("#4a403a"), alpha: [0.75, 0], fadeIn: 0.12, gravity: -0.9, drag: 1.5, frame: 1, spin: 0.4 };
const FUSE_GLOW: ParticleStyle = { life: [0.06, 0.08], size: [0.45, 0.35], color: hdr(2.4, 1.3, 0.35), alpha: [0.9, 0.3], gravity: 0, drag: 0, frame: 0, spin: 0 };
const FUSE: ParticleStyle = { life: [0.12, 0.3], size: [0.04, 0.01], color: hdr(8, 5, 1.6), color2: hdr(2, 0.5, 0.1), alpha: [1, 0.4], gravity: 2, drag: 0.5, frame: 0, spin: 0 };
const FEATHER: ParticleStyle = { life: [1.4, 2.4], size: [0.07, 0.06], color: col("#f4efe6"), alpha: [1, 0], gravity: 0.9, drag: 2.2, frame: 3, spin: 5, floor: 0.02 };
const MOTE: ParticleStyle = { life: [6, 11], size: [0.02, 0.02], color: hdr(1.3, 1.1, 0.8), alpha: [0, 0.6], fadeIn: 0.5, gravity: -0.02, drag: 0.1, frame: 0, spin: 0 };
const GOLD_FLASH = hdr(7, 4.6, 1.0);
const GOLD_SPARK: ParticleStyle = { ...SPARK, color: hdr(6, 4.2, 0.8), color2: hdr(3, 1.6, 0.1), life: [0.2, 0.5] };

const SHARDS: DebrisStyle = { life: [2.5, 4], scale: [0.5, 1.4], gravity: 9.8, bounce: 0.3, spin: 18, drag: 0.2 };
const SPLINTERS: DebrisStyle = { life: [2, 3.5], scale: [0.6, 1.3], gravity: 9.8, bounce: 0.25, spin: 20, drag: 0.4 };
const CHIPS: DebrisStyle = { life: [1.5, 2.5], scale: [0.4, 0.9], gravity: 9.8, bounce: 0.35, spin: 14, drag: 0.3 };
const TWIGS: DebrisStyle = { life: [2, 3], scale: [0.8, 1.6], gravity: 7, bounce: 0.2, spin: 12, drag: 1.2 };

const v = new Vector3();
const t1 = new Vector3();
const t2 = new Vector3();
const tint = new Color();

function shardGeometry(): BufferGeometry {
  // A thin irregular triangle.
  const g = new BufferGeometry();
  const p = [0, 0.05, 0, -0.03, -0.03, 0.002, 0.035, -0.02, -0.002, 0, 0.05, 0, 0.035, -0.02, -0.002, -0.03, -0.03, 0.002];
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * High Noon's effects, over the shared pools: impacts by surface, muzzle
 * flashes, glints, glass, water, blood kept to a dark puff, explosions,
 * feathers, dust motes. Every emitter writes into fixed pools; nothing here
 * allocates per shot or per frame.
 */
export class Effects {
  readonly additive: ParticleSystem;
  readonly alpha: ParticleSystem;
  readonly shards: DebrisPool;
  readonly splinters: DebrisPool;
  readonly chips: DebrisPool;
  readonly decals: DecalPool;
  readonly lights: LightPool;
  private random: () => number = Math.random;
  private readonly glassColor = col("#b9d0d6");

  constructor(root: Group, quality: Quality) {
    const atlas = particleAtlas();
    const n = quality.tier === "low" ? 700 : quality.tier === "medium" ? 1400 : 2400;
    this.additive = new ParticleSystem(Math.round(n * 0.6), atlas, true);
    this.alpha = new ParticleSystem(n, atlas, false);
    const glassMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75, name: "shard" });
    const woodMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, name: "splinter" });
    this.shards = new DebrisPool(shardGeometry(), glassMat, quality.tier === "low" ? 80 : 200);
    this.splinters = new DebrisPool(new BoxGeometry(0.012, 0.012, 0.09), woodMat, quality.tier === "low" ? 60 : 160);
    this.chips = new DebrisPool(new BoxGeometry(0.025, 0.02, 0.03), woodMat, quality.tier === "low" ? 60 : 160);
    this.decals = new DecalPool(bulletHoleTexture(), quality.tier === "low" ? 40 : 96);
    this.lights = new LightPool(root, 3);
    for (const d of [this.shards, this.splinters, this.chips]) {
      d.mesh.castShadow = false;
      root.add(d.mesh);
    }
    root.add(this.alpha.points, this.additive.points, this.decals.mesh);
  }

  setRandom(random: () => number): void {
    this.random = random;
    this.additive.setRandom(random);
    this.alpha.setRandom(random);
    this.shards.setRandom(random);
    this.splinters.setRandom(random);
    this.chips.setRandom(random);
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
    this.chips.update(dt);
    this.lights.update(dt);
  }

  /** A random direction in the hemisphere around `n`, into `out`, with `spread` 0..1. */
  private scatter(n: Vector3, spread: number, out: Vector3): Vector3 {
    const r = this.random;
    out.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).multiplyScalar(spread).add(n);
    return out.normalize();
  }

  /** A bullet meets the town. */
  impact(surface: Surface, at: Vector3, normal: Vector3, floorY: number, hole = true): void {
    const r = this.random;
    switch (surface) {
      case "wood":
        for (let i = 0; i < 5; i++) {
          this.scatter(normal, 0.8, v).multiplyScalar(0.6 + r() * 1.2);
          this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, DUST_PALE, 0.7);
        }
        for (let i = 0; i < 7; i++) {
          this.scatter(normal, 0.9, v).multiplyScalar(2.5 + r() * 3.5);
          tint.setRGB(0.55 + r() * 0.2, 0.4 + r() * 0.15, 0.26);
          this.splinters.emit(at.x, at.y, at.z, v.x, v.y + 1, v.z, floorY, SPLINTERS, tint);
        }
        if (hole) this.decals.add(at, normal, 0.075 + r() * 0.03, r() * 6.28, tint.setRGB(0.85, 0.8, 0.75));
        break;
      case "metal":
        for (let i = 0; i < 12; i++) {
          this.scatter(normal, 1.0, v).multiplyScalar(3 + r() * 5);
          this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, SPARK);
        }
        this.additive.emit(at.x, at.y, at.z, 0, 0, 0, FLASH_CORE, 0.4);
        if (hole) this.decals.add(at, normal, 0.05, r() * 6.28, tint.setRGB(1.6, 1.5, 1.4));
        break;
      case "glass":
        this.glass(at, normal, this.glassColor, 10, floorY);
        break;
      case "water":
        this.splash(at, 1);
        break;
      case "stone":
        for (let i = 0; i < 6; i++) {
          this.scatter(normal, 0.8, v).multiplyScalar(0.8 + r() * 1.5);
          this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, DUST, 0.7, tint.setRGB(0.75, 0.72, 0.68));
        }
        for (let i = 0; i < 6; i++) {
          this.scatter(normal, 0.9, v).multiplyScalar(2 + r() * 3);
          tint.setRGB(0.6, 0.58, 0.55);
          this.chips.emit(at.x, at.y, at.z, v.x, v.y + 1, v.z, floorY, CHIPS, tint);
        }
        for (let i = 0; i < 4; i++) {
          this.scatter(normal, 1, v).multiplyScalar(3 + r() * 3);
          this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, SPARK, 0.6);
        }
        if (hole) this.decals.add(at, normal, 0.06, r() * 6.28, tint.setRGB(0.7, 0.68, 0.66));
        break;
      case "cloth":
        for (let i = 0; i < 4; i++) {
          this.scatter(normal, 0.7, v).multiplyScalar(0.5 + r());
          this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, DUST_PALE, 0.5);
        }
        break;
      default: // dirt
        this.dust(at, normal, 1);
        break;
    }
  }

  /** A puff of dust with grit thrown up (bullets in the street, a tell behind a barrel). */
  dust(at: Vector3, normal: Vector3, scale: number): void {
    const r = this.random;
    for (let i = 0; i < 7 * scale; i++) {
      this.scatter(normal, 0.7, v).multiplyScalar((0.8 + r() * 1.8) * scale);
      this.alpha.emit(at.x, at.y + 0.05, at.z, v.x, v.y, v.z, DUST, 0.8 + scale * 0.4);
    }
    for (let i = 0; i < 8 * scale; i++) {
      this.scatter(normal, 0.5, v).multiplyScalar((2 + r() * 3) * scale);
      this.alpha.emit(at.x, at.y + 0.02, at.z, v.x, v.y, v.z, GRIT);
    }
  }

  /** Dust falling from a ledge (a tell on a roof or a door lintel). */
  sift(at: Vector3, width: number): void {
    const r = this.random;
    for (let i = 0; i < 10; i++) {
      this.alpha.emit(at.x + (r() - 0.5) * width, at.y, at.z + (r() - 0.5) * width, 0, -0.3 - r() * 0.4, 0, DUST_PALE, 0.5);
    }
  }

  glass(at: Vector3, normal: Vector3, color: Color, count: number, floorY: number): void {
    const r = this.random;
    for (let i = 0; i < count; i++) {
      this.scatter(normal, 1.1, v).multiplyScalar(1 + r() * 3.5);
      tint.copy(color).multiplyScalar(0.8 + r() * 0.5);
      this.shards.emit(at.x + (r() - 0.5) * 0.2, at.y + (r() - 0.5) * 0.2, at.z + (r() - 0.5) * 0.2, v.x, v.y + 1.2, v.z, floorY, SHARDS, tint);
    }
    for (let i = 0; i < 6; i++) {
      this.scatter(normal, 1, v).multiplyScalar(1 + r() * 2);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, GLINT, 0.4);
    }
  }

  /** A pane of glass the size of `width` × `height` gives way all at once. */
  pane(center: Vector3, normal: Vector3, right: Vector3, width: number, height: number, floorY: number): void {
    const r = this.random;
    const n = Math.min(40, Math.round(width * height * 18));
    for (let i = 0; i < n; i++) {
      t1.copy(center).addScaledVector(right, (r() - 0.5) * width);
      t1.y += (r() - 0.5) * height;
      this.scatter(normal, 0.6, v).multiplyScalar(0.5 + r() * 2);
      tint.copy(this.glassColor).multiplyScalar(0.7 + r() * 0.5);
      this.shards.emit(t1.x, t1.y, t1.z, v.x, v.y, v.z, floorY, SHARDS, tint);
    }
  }

  splash(at: Vector3, scale: number): void {
    const r = this.random;
    for (let i = 0; i < 14 * scale; i++) {
      v.set((r() - 0.5) * 1.6, 2 + r() * 2.5, (r() - 0.5) * 1.6).multiplyScalar(scale);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, DROPLET, 1, undefined);
    }
    for (let i = 0; i < 4; i++) this.alpha.emit(at.x, at.y + 0.05, at.z, (r() - 0.5) * 0.5, 0.6, (r() - 0.5) * 0.5, MIST, scale);
  }

  /** Liquid from a broken bottle: amber or green droplets. */
  liquid(at: Vector3, color: Color): void {
    const r = this.random;
    for (let i = 0; i < 16; i++) {
      v.set((r() - 0.5) * 2.2, 0.5 + r() * 2.2, (r() - 0.5) * 2.2);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, DROPLET, 1.1, color);
    }
    for (let i = 0; i < 3; i++) this.alpha.emit(at.x, at.y, at.z, (r() - 0.5) * 0.4, 0.4, (r() - 0.5) * 0.4, MIST, 0.8, color);
  }

  blood(at: Vector3, away: Vector3): void {
    const r = this.random;
    for (let i = 0; i < 5; i++) {
      this.scatter(away, 0.6, v).multiplyScalar(0.5 + r() * 1.2);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, BLOOD, 0.8);
    }
  }

  /** A gun going off at `at`, pointing along `dir`. */
  muzzle(at: Vector3, dir: Vector3, golden: boolean, scale = 1): void {
    const r = this.random;
    t2.copy(at).addScaledVector(dir, 0.12 * scale);
    this.additive.emit(t2.x, t2.y, t2.z, dir.x * 2, dir.y * 2, dir.z * 2, FLASH, scale, golden ? GOLD_FLASH : undefined);
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, FLASH_CORE, scale);
    for (let i = 0; i < 5; i++) {
      this.scatter(dir, 0.35, v).multiplyScalar(4 + r() * 6);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, golden ? GOLD_SPARK : SPARK, 0.7);
    }
    for (let i = 0; i < 3; i++) {
      this.scatter(dir, 0.5, v).multiplyScalar(0.4 + r() * 0.6);
      this.alpha.emit(t2.x, t2.y, t2.z, v.x, v.y + 0.1, v.z, SMOKE, scale * 0.8);
    }
    this.lights.flash(at, golden ? tint.setRGB(1, 0.8, 0.35) : tint.setRGB(1, 0.72, 0.4), 45 * scale, 7, 0.09);
  }

  /** The player's own shot: a faint puff drifting at the crosshair (no gun on screen). */
  playerPuff(at: Vector3, golden: boolean): void {
    const r = this.random;
    for (let i = 0; i < 3; i++) {
      this.alpha.emit(at.x, at.y, at.z, (r() - 0.5) * 0.15, 0.08 + r() * 0.1, (r() - 0.5) * 0.15, SMOKE, 0.35, golden ? tint.setRGB(0.95, 0.85, 0.6) : undefined);
    }
    if (golden) {
      for (let i = 0; i < 6; i++) {
        v.set((r() - 0.5) * 1.5, (r() - 0.2) * 1.5, (r() - 0.5) * 1.5);
        this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, GOLD_SPARK, 0.35);
      }
    }
  }

  glint(at: Vector3, size: number): void {
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, GLINT, size / 0.2);
  }

  fuse(at: Vector3): void {
    const r = this.random;
    this.additive.emit(at.x, at.y, at.z, (r() - 0.5) * 1.2, r() * 1.4, (r() - 0.5) * 1.2, FUSE);
  }

  /**
   * The lit fuse as a beacon: a glow sized to stay about the same on screen
   * at any distance, so a stick in the air can always be seen and shot.
   */
  fuseGlow(at: Vector3, distance: number): void {
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, FUSE_GLOW, Math.max(0.6, distance * 0.045));
  }

  explosion(at: Vector3, floorY: number): void {
    const r = this.random;
    this.additive.emit(at.x, at.y, at.z, 0, 0, 0, FIRE_CORE, 1);
    for (let i = 0; i < 16; i++) {
      v.set(r() - 0.5, r() * 0.8, r() - 0.5).normalize().multiplyScalar(2 + r() * 5);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, FIRE, 1);
    }
    for (let i = 0; i < 26; i++) {
      v.set(r() - 0.5, r() - 0.2, r() - 0.5).normalize().multiplyScalar(8 + r() * 12);
      this.additive.emit(at.x, at.y, at.z, v.x, v.y, v.z, SPARK, 1.3);
    }
    for (let i = 0; i < 20; i++) {
      v.set(r() - 0.5, r() * 0.6 + 0.2, r() - 0.5).normalize().multiplyScalar(1 + r() * 3);
      this.alpha.emit(at.x, at.y + 0.3, at.z, v.x, v.y, v.z, BLAST_SMOKE, 1);
    }
    for (let i = 0; i < 20; i++) {
      v.set(r() - 0.5, r() * 0.8 + 0.3, r() - 0.5).normalize().multiplyScalar(4 + r() * 8);
      tint.setRGB(0.35 + r() * 0.2, 0.28, 0.2);
      this.chips.emit(at.x, at.y, at.z, v.x, v.y, v.z, floorY, CHIPS, tint);
    }
    this.lights.flash(at, tint.setRGB(1, 0.62, 0.3), 220, 18, 0.35);
  }

  feathers(at: Vector3, count: number): void {
    const r = this.random;
    for (let i = 0; i < count; i++) {
      v.set((r() - 0.5) * 2.4, 0.8 + r() * 2.4, (r() - 0.5) * 2.4);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, FEATHER);
    }
  }

  twigs(at: Vector3, count: number, floorY: number, scale = 1): void {
    const r = this.random;
    for (let i = 0; i < count; i++) {
      v.set((r() - 0.5) * 4, 1 + r() * 3, (r() - 0.5) * 4).multiplyScalar(scale);
      tint.setRGB(0.45 + r() * 0.15, 0.34, 0.2);
      this.splinters.emit(at.x, at.y, at.z, v.x, v.y, v.z, floorY, TWIGS, tint);
    }
    for (let i = 0; i < 6; i++) {
      this.alpha.emit(at.x, at.y, at.z, (r() - 0.5) * 1.5, 0.5 + r(), (r() - 0.5) * 1.5, DUST_PALE, scale);
    }
  }

  /** A mote of dust hanging in the low sun. */
  mote(at: Vector3): void {
    const r = this.random;
    this.additive.emit(at.x, at.y, at.z, (r() - 0.5) * 0.12, (r() - 0.5) * 0.05, (r() - 0.5) * 0.12, MOTE, 0.6 + r() * 0.8);
  }

  clearTransient(): void {
    this.additive.clear();
    this.alpha.clear();
  }

  dispose(): void {
    this.additive.dispose();
    this.alpha.dispose();
    this.shards.dispose();
    this.splinters.dispose();
    this.chips.dispose();
    this.decals.dispose();
    this.lights.dispose();
  }
}
