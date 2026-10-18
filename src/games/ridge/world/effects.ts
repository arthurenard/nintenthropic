/**
 * Overwatch Ridge's effects, over the engine's pools: what a round does where
 * it lands - dust off turf, chips and a spark off stone, a spark and a ring
 * off steel, a splash, glass - sized to read through a 6× scope at a few
 * hundred metres; the enemy's muzzle flashes across the valley; the glint
 * of a lens catching the low sun; steam from a dead engine; a mortar's
 * fountain of earth; and the vapour trail a round leaves in the scope.
 * Every emitter writes into fixed pools; nothing allocates per shot.
 */
import { Color, Vector3, type Group, type Points, type ShaderMaterial } from "three";
import { DecalPool } from "../../../engine/fx/decals";
import { ParticleSystem, scatter, type ParticleStyle } from "../../../engine/fx/particles";
import { bulletHoleTexture, particleAtlas } from "../../../engine/fx/textures";
import type { Quality } from "../../../engine/types";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "./atmosphere";
import type { Surface } from "./valley";

const col = (hex: string) => new Color(hex);
const hdr = (r: number, g: number, b: number) => new Color(r, g, b);

// Colours are linear; above 1 they bloom. Sizes in metres: these are seen from 200-900 m.
const DUST: ParticleStyle = { life: [1.2, 2.2], size: [0.5, 2.6], color: col("#a8977f"), alpha: [0.7, 0], fadeIn: 0.05, gravity: -0.1, drag: 1.8, frame: 1, spin: 0.5 };
const TURF: ParticleStyle = { life: [0.6, 1.1], size: [0.12, 0.08], color: col("#3f3a2a"), alpha: [1, 0.8], gravity: 9.8, drag: 0.3, frame: 0, spin: 0 };
const STONE_DUST: ParticleStyle = { ...DUST, color: col("#b9b4aa"), size: [0.4, 2] };
const CHIP: ParticleStyle = { life: [0.4, 0.9], size: [0.1, 0.06], color: col("#8a877f"), alpha: [1, 0.7], gravity: 9.8, drag: 0.2, frame: 0, spin: 0 };
const SPARK: ParticleStyle = { life: [0.12, 0.3], size: [0.25, 0.06], color: hdr(9, 6, 2.5), color2: hdr(3, 1, 0.2), alpha: [1, 0.4], gravity: 6, drag: 1, frame: 0, spin: 0 };
const FLASH: ParticleStyle = { life: [0.05, 0.08], size: [1.4, 0.8], color: hdr(12, 8, 3.5), alpha: [1, 0.1], gravity: 0, drag: 0, frame: 2, spin: 0 };
const SPRAY: ParticleStyle = { life: [0.7, 1.2], size: [0.18, 0.1], color: col("#c8d8dc"), alpha: [0.9, 0.2], gravity: 9.8, drag: 0.4, frame: 0, spin: 0 };
const WATER_MIST: ParticleStyle = { life: [0.8, 1.4], size: [0.6, 2.4], color: col("#dfe8ea"), alpha: [0.55, 0], gravity: 0.3, drag: 2, frame: 1, spin: 0.4 };
const GLASS: ParticleStyle = { life: [0.2, 0.35], size: [0.35, 0.1], color: hdr(4, 4.4, 5), alpha: [1, 0], gravity: 0, drag: 0, frame: 2, spin: 3 };
const SHARD: ParticleStyle = { life: [0.5, 0.9], size: [0.06, 0.05], color: col("#c9dde0"), alpha: [1, 0.6], gravity: 9.8, drag: 0.3, frame: 0, spin: 0 };
const WOOD: ParticleStyle = { ...DUST, color: col("#b09372"), size: [0.3, 1.4] };
const SPLINTER: ParticleStyle = { life: [0.5, 1], size: [0.1, 0.08], color: col("#9a7a52"), alpha: [1, 0.8], gravity: 9.8, drag: 0.3, frame: 3, spin: 8 };
const SNOW: ParticleStyle = { ...DUST, color: col("#f4f7fb"), size: [0.6, 3], life: [1.5, 2.6] };
// A round's wake in the air: pale, brief, gone in a third of a second.
const VAPOUR: ParticleStyle = { life: [0.3, 0.5], size: [0.06, 0.14], color: col("#e6ecf2"), alpha: [0.26, 0], fadeIn: 0.04, gravity: 0, drag: 2, frame: 1, spin: 0.4 };
const BODY: ParticleStyle = { life: [0.4, 0.8], size: [0.2, 0.7], color: col("#4a3a30"), alpha: [0.8, 0], gravity: 1, drag: 2.5, frame: 1, spin: 1 };
const STEAM: ParticleStyle = { life: [1.6, 2.8], size: [0.5, 3.2], color: col("#eef2f4"), alpha: [0.75, 0], fadeIn: 0.08, gravity: -1.6, drag: 0.8, frame: 1, spin: 0.6 };
const SMOKE: ParticleStyle = { life: [1, 1.8], size: [0.3, 1.8], color: col("#c9c3b8"), alpha: [0.45, 0], fadeIn: 0.1, gravity: -0.4, drag: 1.5, frame: 1, spin: 0.5 };
const MUZZLE: ParticleStyle = { life: [0.05, 0.07], size: [0.9, 0.5], color: hdr(10, 6.5, 2.4), alpha: [1, 0.2], gravity: 0, drag: 0, frame: 2, spin: 0 };
const EARTH: ParticleStyle = { life: [1.4, 2.4], size: [0.4, 0.3], color: col("#4b3f30"), alpha: [1, 0.8], gravity: 9.8, drag: 0.25, frame: 0, spin: 0 };
const BLAST_SMOKE: ParticleStyle = { life: [2.2, 3.6], size: [2.5, 9], color: col("#5a5046"), alpha: [0.8, 0], fadeIn: 0.05, gravity: -0.6, drag: 1.2, frame: 1, spin: 0.3 };
const FIREBALL: ParticleStyle = { life: [0.12, 0.2], size: [4, 7], color: hdr(6, 3, 1), alpha: [1, 0], gravity: 0, drag: 0, frame: 1, spin: 0 };
// The lens's flares, sized as fractions of the view's height (see glint()).
const GLINT_CORE: ParticleStyle = { life: [0.3, 0.3], size: [0.012, 0.006], color: hdr(12, 11, 9), alpha: [1, 0], fadeIn: 0.15, gravity: 0, drag: 0, frame: 0, spin: 0 };
const GLINT_STREAK: ParticleStyle = { life: [0.3, 0.3], size: [0.07, 0.09], color: hdr(8, 6.5, 3.5), color2: hdr(4, 2.6, 1), alpha: [0.9, 0], fadeIn: 0.15, gravity: 0, drag: 0, frame: 4, spin: 0, angle: 0 };
const GLINT_RAY: ParticleStyle = { ...GLINT_STREAK, size: [0.03, 0.04], angle: Math.PI / 2, alpha: [0.7, 0] };
// The flash of a shot fired at you, sized as a fraction of the view's height like the glint's (see shotFlare()):
// a brief star and a short flare line, bright enough to bloom - or, with reduced flashing, a dim glow that eases in and out.
const SHOT_STAR: ParticleStyle = { life: [0.22, 0.22], size: [0.022, 0.009], color: hdr(14, 9, 4), alpha: [1, 0], fadeIn: 0.08, gravity: 0, drag: 0, frame: 2, spin: 0 };
const SHOT_LINE: ParticleStyle = { life: [0.16, 0.16], size: [0.05, 0.028], color: hdr(8, 5.5, 2.5), color2: hdr(3.5, 2, 0.8), alpha: [0.85, 0], fadeIn: 0.1, gravity: 0, drag: 0, frame: 4, spin: 0, angle: 0 };
const SHOT_GLOW: ParticleStyle = { life: [0.5, 0.5], size: [0.02, 0.012], color: hdr(1.1, 0.8, 0.45), alpha: [0.55, 0], fadeIn: 0.45, gravity: 0, drag: 0, frame: 0, spin: 0 };

const v = new Vector3();
const t1 = new Vector3();

/** The valley's air over a particle: haze and mist on dust (blended), only the dimming on light (added). */
function patchParticles(points: Points, atmosphere: AtmosphereUniforms, additive: boolean): void {
  const m = points.material as ShaderMaterial;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, atmosphere);
    shader.vertexShader = shader.vertexShader
      .replace("varying vec4 vColor;", "varying vec4 vColor;\nvarying vec3 vAtmoWorld;")
      .replace("gl_Position = projectionMatrix * mvPosition;", "gl_Position = projectionMatrix * mvPosition;\n  vAtmoWorld = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("varying vec4 vColor;", `varying vec4 vColor;\nvarying vec3 vAtmoWorld;\n${ATMOSPHERE_GLSL}`)
      .replace(
        "#include <fog_fragment>",
        additive
          ? "{ float d = length(vAtmoWorld - cameraPosition); gl_FragColor.rgb *= exp(-d * uHazeDensity * 0.9); }"
          : "gl_FragColor.rgb = atmoAir(gl_FragColor.rgb, vAtmoWorld);",
      );
  };
  m.customProgramCacheKey = () => `ridge-particles-${additive ? "add" : "alpha"}`;
  m.needsUpdate = true;
}

/**
 * The effects. `setScale` gives them the view's height at one metre (for
 * flares sized on screen); the game calls it whenever the lens changes (the scope).
 */
export class Effects {
  readonly additive: ParticleSystem;
  readonly alpha: ParticleSystem;
  /** Flares in the lens: drawn over everything, sized on screen. */
  readonly lens: ParticleSystem;
  readonly decals: DecalPool;
  private random: () => number = Math.random;
  private viewSpan = 0.8;
  /** Settings.reducedFlashing: flashes glow instead. */
  reducedFlashing = false;

  constructor(
    root: Group,
    quality: Quality,
    atmosphere: AtmosphereUniforms,
  ) {
    const atlas = particleAtlas();
    const n = quality.tier === "low" ? 900 : quality.tier === "medium" ? 1500 : 2400;
    this.additive = new ParticleSystem(Math.round(n * 0.5), atlas, true);
    this.alpha = new ParticleSystem(n, atlas, false);
    this.lens = new ParticleSystem(64, atlas, true, true);
    patchParticles(this.additive.points, atmosphere, true);
    patchParticles(this.alpha.points, atmosphere, false);
    this.decals = new DecalPool(bulletHoleTexture(), quality.tier === "low" ? 40 : 96);
    root.add(this.alpha.points, this.additive.points, this.lens.points, this.decals.mesh);
  }

  setRandom(random: () => number): void {
    this.random = random;
    this.additive.setRandom(random);
    this.alpha.setRandom(random);
    this.lens.setRandom(random);
  }

  /** The lens changed (the scope): particles are sized in metres through it, flares on screen. */
  setScale(bufferHeight: number, fov: number): void {
    this.additive.setScale(bufferHeight, fov);
    this.alpha.setScale(bufferHeight, fov);
    this.lens.setScale(bufferHeight, fov);
    this.viewSpan = 2 * Math.tan((fov * Math.PI) / 360);
  }

  update(dt: number): void {
    this.additive.update(dt);
    this.alpha.update(dt);
    this.lens.update(dt);
  }

  /**
   * The vapour trail a round leaves, seen through the scope: a wisp of
   * disturbed air at a point of its path, `distance` metres from the eye,
   * sized to read as a thin streak at any range.
   */
  vapour(at: Vector3, distance: number, strength: number): void {
    const r = this.random;
    // About a milliradian across wherever it is: a thread of disturbed air.
    const size = distance * 0.0012;
    this.alpha.emit(at.x, at.y, at.z, (r() - 0.5) * 0.05, 0.03, (r() - 0.5) * 0.05, VAPOUR, (size / 0.06) * strength);
  }

  /** A round lands. `toward` is the way it came from (for the spray's direction). */
  impact(surface: Surface, at: Vector3, normal: Vector3, toward: Vector3): void {
    const r = this.random;
    t1.copy(normal).addScaledVector(toward, 0.4).normalize();
    switch (surface) {
      case "rock":
      case "stone":
        for (let i = 0; i < 6; i++) this.alpha.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 0.8, v).multiplyScalar(1 + r() * 2).toArray(), STONE_DUST, 1);
        for (let i = 0; i < 8; i++) this.alpha.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 1, v).multiplyScalar(3 + r() * 5).toArray(), CHIP);
        for (let i = 0; i < 5; i++) this.additive.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 1, v).multiplyScalar(4 + r() * 6).toArray(), SPARK, this.reducedFlashing ? 0.4 : 1);
        break;
      case "metal":
        for (let i = 0; i < 10; i++) this.additive.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 1, v).multiplyScalar(4 + r() * 8).toArray(), SPARK, this.reducedFlashing ? 0.4 : 1);
        this.additive.emit(at.x, at.y, at.z, 0, 0, 0, FLASH, this.reducedFlashing ? 0.25 : 0.6);
        break;
      case "water":
        this.splash(at, 1);
        break;
      case "glass":
        this.additive.emit(at.x, at.y, at.z, 0, 0, 0, GLASS, 1);
        for (let i = 0; i < 10; i++) this.alpha.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 1.1, v).multiplyScalar(1 + r() * 3).toArray(), SHARD);
        break;
      case "wood":
        for (let i = 0; i < 4; i++) this.alpha.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 0.8, v).multiplyScalar(0.6 + r() * 1.4).toArray(), WOOD);
        for (let i = 0; i < 8; i++) this.alpha.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 0.9, v).multiplyScalar(2 + r() * 4).toArray(), SPLINTER);
        break;
      case "snow":
        for (let i = 0; i < 7; i++) this.alpha.emit(at.x, at.y + 0.2, at.z, ...scatter(this.random, t1, 0.7, v).multiplyScalar(1 + r() * 2).toArray(), SNOW, 1.2);
        break;
      case "cloth":
        for (let i = 0; i < 4; i++) this.alpha.emit(at.x, at.y, at.z, ...scatter(this.random, t1, 0.8, v).multiplyScalar(0.5 + r()).toArray(), BODY, 1);
        break;
      default: // grass, dirt
        for (let i = 0; i < 7; i++) this.alpha.emit(at.x, at.y + 0.1, at.z, ...scatter(this.random, t1, 0.7, v).multiplyScalar(0.8 + r() * 2).toArray(), DUST, 1);
        for (let i = 0; i < 10; i++) this.alpha.emit(at.x, at.y + 0.05, at.z, ...scatter(this.random, t1, 0.5, v).multiplyScalar(3 + r() * 4).toArray(), TURF);
        break;
    }
  }

  /** A round striking a man: a puff of dust from his clothes, dark, brief. */
  body(at: Vector3, away: Vector3): void {
    const r = this.random;
    for (let i = 0; i < 5; i++) this.alpha.emit(at.x, at.y, at.z, ...scatter(this.random, away, 0.6, v).multiplyScalar(0.6 + r() * 1.2).toArray(), BODY);
  }

  splash(at: Vector3, scale: number): void {
    const r = this.random;
    for (let i = 0; i < 16 * scale; i++) {
      v.set((r() - 0.5) * 1.6, 3 + r() * 4, (r() - 0.5) * 1.6).multiplyScalar(scale);
      this.alpha.emit(at.x, at.y, at.z, v.x, v.y, v.z, SPRAY, 1.4);
    }
    for (let i = 0; i < 5; i++) this.alpha.emit(at.x, at.y + 0.2, at.z, (r() - 0.5) * 0.6, 1 + r(), (r() - 0.5) * 0.6, WATER_MIST, scale);
  }

  /** An enemy's muzzle flash across the valley (and a puff of smoke), pointing along `dir`. */
  muzzle(at: Vector3, dir: Vector3, scale = 1): void {
    const r = this.random;
    const soft = this.reducedFlashing ? 0.25 : 1;
    this.additive.emit(at.x + dir.x * 0.4, at.y + dir.y * 0.4, at.z + dir.z * 0.4, dir.x, dir.y, dir.z, MUZZLE, scale * soft);
    for (let i = 0; i < 2; i++) this.alpha.emit(at.x + dir.x * 0.6, at.y + 0.1, at.z + dir.z * 0.6, (r() - 0.5) * 0.4, 0.3, (r() - 0.5) * 0.4, SMOKE, scale);
  }

  /**
   * A lens catching the low sun toward the ridge, `distance` metres away:
   * the same size on screen at any range (sized against the view's height),
   * held `seconds`. A scope's glint is the Overwatch Ridge glint.
   */
  glint(at: Vector3, distance: number, seconds: number, strength = 1): void {
    const k = Math.max(1, distance) * this.viewSpan * strength;
    const life = (s: ParticleStyle): ParticleStyle => ({ ...s, life: [seconds, seconds], fadeIn: Math.min(0.5, 0.08 / Math.max(0.1, seconds)) });
    this.lens.emit(at.x, at.y, at.z, 0, 0, 0, life(GLINT_STREAK), k);
    this.lens.emit(at.x, at.y, at.z, 0, 0, 0, life(GLINT_RAY), k);
    this.lens.emit(at.x, at.y, at.z, 0, 0, 0, life(GLINT_CORE), k);
  }

  /**
   * The flash of a shot fired at the player, `distance` metres away. The
   * muzzle's own flash is a metre across, a pixel at 300 m, so this puts a
   * brief star in the lens as well, sized against the view's height (like
   * the glint) so that it reads in the wide view as it does in the scope.
   * With reduced flashing it is a dim glow that comes and goes gently.
   */
  shotFlare(at: Vector3, distance: number, strength = 1): void {
    const k = Math.max(1, distance) * this.viewSpan * strength;
    if (this.reducedFlashing) {
      this.lens.emit(at.x, at.y, at.z, 0, 0, 0, SHOT_GLOW, k);
      return;
    }
    this.lens.emit(at.x, at.y, at.z, 0, 0, 0, SHOT_STAR, k);
    this.lens.emit(at.x, at.y, at.z, 0, 0, 0, SHOT_LINE, k);
  }

  steam(at: Vector3, strength: number): void {
    const r = this.random;
    this.alpha.emit(at.x + (r() - 0.5) * 0.6, at.y, at.z + (r() - 0.5) * 0.6, (r() - 0.5) * 0.5, 1.5 + r(), (r() - 0.5) * 0.5, STEAM, strength);
  }

  /** A mortar round landing: a fireball's blink, earth thrown high, a pall of smoke. */
  blast(at: Vector3, near: boolean): void {
    const r = this.random;
    const soft = this.reducedFlashing ? 0.08 : 1;
    this.additive.emit(at.x, at.y + 1, at.z, 0, 0, 0, FIREBALL, soft);
    for (let i = 0; i < 40; i++) {
      v.set(r() - 0.5, 0.8 + r(), r() - 0.5).normalize().multiplyScalar(8 + r() * 14);
      this.alpha.emit(at.x, at.y + 0.3, at.z, v.x, v.y, v.z, EARTH, near ? 1.6 : 1);
    }
    for (let i = 0; i < 12; i++) {
      v.set(r() - 0.5, 0.4 + r() * 0.6, r() - 0.5).multiplyScalar(2 + r() * 3);
      this.alpha.emit(at.x, at.y + 1, at.z, v.x, v.y, v.z, BLAST_SMOKE, 1);
    }
  }

  /** A little smoke at the muzzle of the player's own rifle (seen unscoped). */
  puff(at: Vector3, golden: boolean): void {
    const r = this.random;
    // A faint wisp low at the edge of the view: the barrel is under the eye, not in it.
    for (let i = 0; i < 2; i++) this.alpha.emit(at.x, at.y, at.z, (r() - 0.5) * 0.2, 0.1 + r() * 0.08, -0.2 - r() * 0.3, SMOKE, 0.14, golden ? col("#e6d29a") : undefined);
  }

  clearAll(): void {
    this.additive.clear();
    this.alpha.clear();
    this.lens.clear();
    this.decals.clear();
  }

  dispose(): void {
    this.additive.dispose();
    this.alpha.dispose();
    this.lens.dispose();
    this.decals.dispose();
  }
}
