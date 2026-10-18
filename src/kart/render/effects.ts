/**
 * Particles: drift sparks (blue, then orange), boost flames, dust off the
 * road, tyre smoke, bump puffs and the confetti of a win. Two pooled
 * systems, one drawn additively (light) and one with ordinary blending
 * (smoke and dust), each a single draw call over a ring buffer of sprites.
 * Nothing is allocated while racing.
 */
import { AdditiveBlending, BufferAttribute, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, type Points } from "three";
import type { KartView, RaceEvent } from "../contract";
import { KART_EXHAUST, KART_REAR_WHEEL } from "./kartModel";
import { clamp } from "./math";
import { makePoints } from "./points";

class Sprites {
  readonly points: Points;
  private readonly n: number;
  private next = 0;
  // Per particle.
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly c0: Float32Array; // r g b a
  private readonly c1: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;

  /** Light holds its brightness most of its life and then drops away; smoke fades steadily. */
  private readonly hold: boolean;

  constructor(capacity: number, additive: boolean) {
    this.n = capacity;
    this.hold = additive;
    this.points = makePoints(capacity, additive);
    const f = (k = 1) => new Float32Array(capacity * k);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.s0 = f();
    this.s1 = f();
    this.c0 = f(4);
    this.c1 = f(4);
    this.gravity = f();
    this.drag = f();
    this.age.fill(1);
    this.life.fill(1);
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    c0: readonly [number, number, number, number],
    c1: readonly [number, number, number, number],
    gravity = 0,
    drag = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.c0.set(c0, i * 4);
    this.c1.set(c1, i * 4);
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    const pos = this.points.geometry.getAttribute("position");
    const col = this.points.geometry.getAttribute("aColour");
    const size = this.points.geometry.getAttribute("aSize");
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    const S = size.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      let a = this.age[i]!;
      const L = this.life[i]!;
      if (a >= L) {
        S[i] = 0;
        continue;
      }
      a += dt;
      this.age[i] = a;
      if (a >= L) {
        S[i] = 0;
        continue;
      }
      const dr = Math.exp(-this.drag[i]! * dt);
      this.vx[i] = this.vx[i]! * dr;
      this.vz[i] = this.vz[i]! * dr;
      this.vy[i] = this.vy[i]! * dr + this.gravity[i]! * dt;
      this.x[i] = this.x[i]! + this.vx[i]! * dt;
      this.y[i] = this.y[i]! + this.vy[i]! * dt;
      this.z[i] = this.z[i]! + this.vz[i]! * dt;
      const u = a / L;
      P[i * 3] = this.x[i]!;
      P[i * 3 + 1] = this.y[i]!;
      P[i * 3 + 2] = this.z[i]!;
      const k = i * 4;
      const uc = this.hold ? u * u : u;
      for (let q = 0; q < 3; q++) C[k + q] = this.c0[k + q]! + (this.c1[k + q]! - this.c0[k + q]!) * u;
      C[k + 3] = this.c0[k + 3]! + (this.c1[k + 3]! - this.c0[k + 3]!) * uc;
      S[i] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * u;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    size.needsUpdate = true;
  }

  /** Every particle gone (the next update hides them). */
  clear(): void {
    this.age.fill(1);
    this.life.fill(1);
  }

  /** How many particles are alive. */
  get live(): number {
    let n = 0;
    for (let i = 0; i < this.n; i++) if (this.age[i]! < this.life[i]!) n++;
    return n;
  }
}


/**
 * Speed lines: thin soft streaks standing in the air round a fast kart that it
 * rushes past (a pool of camera-facing quads stretched along the heading).
 * They are world-static, so every split-screen view sees them go by.
 */
class Streaks {
  readonly mesh: Mesh;
  private readonly n: number;
  private next = 0;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly col: Float32Array;
  private readonly w: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly base: Float32Array;
  private readonly attrs: InstancedBufferAttribute[];

  constructor(capacity: number) {
    this.n = capacity;
    this.a = new Float32Array(capacity * 3);
    this.b = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.w = new Float32Array(capacity);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.base = new Float32Array(capacity * 4);
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const A = new InstancedBufferAttribute(this.a, 3).setUsage(DynamicDrawUsage);
    const B = new InstancedBufferAttribute(this.b, 3).setUsage(DynamicDrawUsage);
    const C = new InstancedBufferAttribute(this.col, 4).setUsage(DynamicDrawUsage);
    const W = new InstancedBufferAttribute(this.w, 1).setUsage(DynamicDrawUsage);
    g.setAttribute("aA", A);
    g.setAttribute("aB", B);
    g.setAttribute("aCol", C);
    g.setAttribute("aW", W);
    this.attrs = [A, B, C, W];
    g.instanceCount = capacity;
    const material = new ShaderMaterial({
      vertexShader: `
        attribute vec3 aA; attribute vec3 aB; attribute vec4 aCol; attribute float aW;
        varying vec4 vCol; varying vec2 vC;
        void main() {
          vec4 a = modelViewMatrix * vec4(aA, 1.0);
          vec4 b = modelViewMatrix * vec4(aB, 1.0);
          vec3 dir = b.xyz - a.xyz;
          vec3 side = normalize(cross(dir, a.xyz + b.xyz));
          vec3 p = mix(a.xyz, b.xyz, position.y) + side * position.x * aW;
          vCol = aCol; vC = position.xy;
          gl_Position = aCol.a <= 0.002 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec4 vCol; varying vec2 vC;
        void main() {
          float soft = (1.0 - abs(vC.x)) * smoothstep(0.0, 0.3, vC.y) * (1.0 - smoothstep(0.55, 1.0, vC.y));
          gl_FragColor = vec4(vCol.rgb, vCol.a * soft);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
  }

  /** A streak from (x, y, z) back along (dx, dz), this long and this wide, in this colour. */
  add(x: number, y: number, z: number, dx: number, dz: number, length: number, width: number, r: number, g: number, b: number, a: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.a[i * 3] = x;
    this.a[i * 3 + 1] = y;
    this.a[i * 3 + 2] = z;
    this.b[i * 3] = x - dx * length;
    this.b[i * 3 + 1] = y;
    this.b[i * 3 + 2] = z - dz * length;
    this.w[i] = width;
    this.base.set([r, g, b, a], i * 4);
    this.age[i] = 0;
    this.life[i] = life;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      const L = this.life[i]!;
      let age = this.age[i]!;
      if (age >= L) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      age += dt;
      this.age[i] = age;
      const u = age / L;
      // Quick in, slow out.
      const fade = Math.min(1, u / 0.15) * (1 - u) ** 1.2;
      this.col[i * 4] = this.base[i * 4]!;
      this.col[i * 4 + 1] = this.base[i * 4 + 1]!;
      this.col[i * 4 + 2] = this.base[i * 4 + 2]!;
      this.col[i * 4 + 3] = u >= 1 ? 0 : this.base[i * 4 + 3]! * fade;
    }
    for (const attr of this.attrs) attr.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(1);
    this.col.fill(0);
    this.attrs[2]!.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

/** Per-kart emitter state: fractional particles owed. */
interface Emit {
  spark: number;
  flame: number;
  dust: number;
  smoke: number;
  star: number;
  lastLevel: number;
  lastBoost: number;
  snow: number;
  ice: number;
  mud: number;
  sand: number;
  trail: number;
  trick: number;
  lines: number;
}

/** Where a kart is on screen while a drone has it (its view says only where it fell), and what it is doing. */
export interface Visual {
  x: number;
  y: number;
  z: number;
  /** True while it is still dropping, false once the drone has the hook in it. */
  falling: boolean;
}

// Overbright colours: the soft sprite's core goes white-hot while its halo keeps the colour.
const BLUE0 = [0.3, 1.05, 3.4, 1] as const;
const BLUE1 = [0.08, 0.3, 2.0, 0] as const;
const ORANGE0 = [3.0, 1.1, 0.08, 1] as const;
const ORANGE1 = [2.2, 0.3, 0.0, 0] as const;
const WHITE0 = [2.4, 2.2, 1.8, 0.95] as const;
const WHITE1 = [1.6, 0.9, 0.3, 0] as const;
/** The hot centre of a spark or a flame. */
const HOT0 = [3.6, 3.3, 2.8, 1] as const;
const HOT1 = [2.4, 1.4, 0.5, 0] as const;

export class Effects {
  readonly group = new Group();
  private readonly add: Sprites;
  private readonly norm: Sprites;
  private readonly now: Sprites;
  private readonly streaks: Streaks;
  private readonly state = new Map<number, Emit>();
  private rnd = 1;
  private dust: [number, number, number] = [0.8, 0.7, 0.5];
  /** Switch off the shakes and flashes for players who asked for less motion. */
  calm = false;
  /** Which world this is, for what a fall looks like (embers over lava, stars in space). */
  world = "meadow";

  constructor(capacity: number) {
    this.add = new Sprites(Math.round(capacity * 0.65), true);
    this.norm = new Sprites(Math.round(capacity * 0.35), false);
    // Glows that last one frame (a seeker's light, a kart's lamps): rewritten every frame.
    this.now = new Sprites(160, true);
    this.streaks = new Streaks(Math.max(80, Math.round(capacity * 0.14)));
    this.group.add(this.norm.points, this.add.points, this.now.points, this.streaks.mesh);
  }

  setDustColour(r: number, g: number, b: number): void {
    this.dust = [r, g, b];
  }

  /** A deterministic-enough random in 0..1; the picture needs no seeded stream. */
  private r(): number {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return (this.rnd - 1) / 2147483646;
  }

  private spread(): number {
    return this.r() * 2 - 1;
  }

  /** A glow for this frame only. */
  glowNow(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void {
    // Dozens a frame (every lamp at night, every item's light): one colour reused, since emit copies it.
    const c = this.glowColour;
    c[0] = r;
    c[1] = g;
    c[2] = b;
    c[3] = a;
    this.now.emit(x, y, z, 0, 0, 0, 0.03, size, size, c, c);
  }
  private readonly glowColour: [number, number, number, number] = [0, 0, 0, 0];

  /** One soft mote of a moving thing's trail. */
  trail(x: number, y: number, z: number, r: number, g: number, b: number, size = 0.4): void {
    this.add.emit(x, y, z, this.spread() * 0.4, this.spread() * 0.4, this.spread() * 0.4, 0.32, size, 0.05, [r, g, b, 0.8], [r, g, b, 0], 0, 1.5);
  }

  // ── Items (itemfx.ts draws their shapes; these are the particles) ──────
  /** A mote of coloured light of hue 0..1 (an item's sparkle). */
  sparkle(x: number, y: number, z: number, hue: number, size = 0.35, life = 0.5, rise = 1.2, gold = 0): void {
    const c = hsl(hue);
    const m = 1 - gold;
    const rgb: [number, number, number, number] = [c[0] * 2 * m + 2.0 * gold, c[1] * 2 * m + 1.5 * gold, c[2] * 2 * m + 0.35 * gold, 1];
    this.add.emit(x, y, z, this.spread() * 0.8, rise + this.r() * 0.8, this.spread() * 0.8, life, size, 0.04, rgb, [rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5, 0], 0, 1.4);
  }

  /** A big soft flash of light that fades quickly. */
  flash(x: number, y: number, z: number, size: number, r: number, g: number, b: number, life = 0.28): void {
    this.add.emit(x, y, z, 0, 0, 0, life, size, size * 1.5, [r, g, b, 0.9], [r, g, b, 0]);
  }

  /** A puff of grey smoke that hangs and spreads (a rocket's trail, a burst's cloud). */
  smoke(x: number, y: number, z: number, size = 0.8, life = 1.3, power = 0.4): void {
    const shade = 0.78 + this.r() * 0.2;
    this.norm.emit(x, y, z, this.spread() * power, this.r() * power, this.spread() * power, life, size * 0.5, size * (1.8 + this.r()), [shade, shade, shade + 0.03, 0.75], [shade * 0.7, shade * 0.72, shade * 0.78, 0], 0, 1.3);
  }

  /** One streak of rain falling. */
  rain(x: number, y: number, z: number): void {
    this.add.emit(x, y, z, this.spread() * 0.5, -13 - this.r() * 4, this.spread() * 0.5, 0.42, 0.11, 0.07, [0.55, 0.8, 1.7, 0.85], [0.3, 0.5, 1.2, 0], 0, 0.1);
  }

  /** Embers thrown outward and up from a point (a burst). */
  fireworks(x: number, y: number, z: number, count: number, power: number, hot: boolean): void {
    for (let i = 0; i < count; i++) {
      const a = this.r() * Math.PI * 2;
      const up = this.r() * 2 - 0.4;
      const horizontal = Math.sqrt(Math.max(0.05, 1 - up * up * 0.25));
      const s = power * (0.5 + this.r() * 0.7);
      const c = hot ? (this.r() < 0.5 ? ORANGE0 : WHITE0) : BLUE0;
      const c1 = hot ? (this.r() < 0.5 ? ORANGE1 : WHITE1) : BLUE1;
      this.add.emit(x, y, z, Math.cos(a) * s * horizontal, up * s * 0.9 + 2, Math.sin(a) * s * horizontal, 0.5 + this.r() * 0.6, 0.3, 0.05, c, c1, -9, 0.7);
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────
  puff(x: number, y: number, z: number, count: number, size = 1.1, power = 2): void {
    for (let i = 0; i < count; i++) {
      this.norm.emit(
        x + this.spread() * 0.3,
        y + this.r() * 0.3,
        z + this.spread() * 0.3,
        this.spread() * power,
        0.5 + this.r() * power * 0.6,
        this.spread() * power,
        0.5 + this.r() * 0.5,
        size * 0.5,
        size * (1.2 + this.r() * 0.8),
        [0.95, 0.95, 0.97, 0.7],
        [0.85, 0.86, 0.9, 0],
        0,
        2.2,
      );
    }
  }

  sparksBurst(x: number, y: number, z: number, count: number, power = 6, hot = true): void {
    for (let i = 0; i < count; i++) {
      this.add.emit(
        x,
        y,
        z,
        this.spread() * power,
        1 + this.r() * power * 0.8,
        this.spread() * power,
        0.25 + this.r() * 0.35,
        0.2,
        0.05,
        hot ? WHITE0 : BLUE0,
        hot ? WHITE1 : BLUE1,
        -16,
        0.6,
      );
    }
  }

  /** Hot sparks and ash lifting off lava. */
  embers(x: number, y: number, z: number, count: number, spread = 1): void {
    for (let i = 0; i < count; i++) {
      const hot = this.r() < 0.6;
      this.add.emit(x + this.spread() * spread, y, z + this.spread() * spread, this.spread() * 2.2, 2 + this.r() * 5, this.spread() * 2.2, 0.7 + this.r() * 0.7, 0.3, 0.04, hot ? [2.2, 0.8, 0.12, 1] : [1.6, 0.3, 0.03, 1], [1.2, 0.15, 0.0, 0], -2, 0.5);
      if (i % 3 === 0) this.norm.emit(x + this.spread() * spread, y, z + this.spread() * spread, this.spread() * 1.4, 1.5 + this.r() * 2, this.spread() * 1.4, 1.0 + this.r() * 0.6, 0.8, 2.6, [0.22, 0.18, 0.2, 0.55], [0.15, 0.12, 0.14, 0], 0.5, 1.2);
    }
  }

  /** A burst of glitter where an item box was taken: a flash, rainbow motes thrown out and a ring of white sparks. */
  pickup(x: number, y: number, z: number): void {
    this.flash(x, y + 1.2, z, 3.6, 1.6, 1.7, 2.2, 0.22);
    for (let i = 0; i < 40; i++) {
      const hue = this.r();
      const rgb = hsl(hue);
      const a = this.r() * Math.PI * 2;
      const s = 2 + this.r() * 5.5;
      const c: [number, number, number, number] = [rgb[0] * 2.6, rgb[1] * 2.6, rgb[2] * 2.6, 1];
      this.add.emit(x, y + 1.2, z, Math.cos(a) * s, 1.5 + this.r() * 4.5, Math.sin(a) * s, 0.5 + this.r() * 0.6, 0.38, 0.06, c, [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0], -6, 1.2);
      if (i % 3 === 0) this.add.emit(x, y + 1.2, z, Math.cos(a) * s * 0.8, 2 + this.r() * 4, Math.sin(a) * s * 0.8, 0.25 + this.r() * 0.2, 0.2, 0.04, HOT0, HOT1, -8, 1.2);
    }
  }

  boostBurst(k: KartView, strong: boolean): void {
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    const n = strong ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const spreadX = this.spread() * 1.2;
      const spreadY = this.r() * 1.2;
      this.add.emit(
        k.x - fx * 1.4,
        k.y + 0.6,
        k.z - fz * 1.4,
        -fx * (6 + this.r() * 8) + spreadX,
        spreadY,
        -fz * (6 + this.r() * 8) + this.spread() * 1.2,
        0.3 + this.r() * 0.2,
        0.5,
        0.1,
        [1.0, 0.82, 0.35, 0.95],
        [1.0, 0.3, 0.05, 0],
        0,
        1.5,
      );
    }
  }

  confetti(x: number, y: number, z: number): void {
    for (let i = 0; i < 90; i++) {
      const rgb = hsl(this.r());
      const a = this.r() * Math.PI * 2;
      const s = 2 + this.r() * 6;
      this.norm.emit(x, y + 1.5, z, Math.cos(a) * s, 4 + this.r() * 6, Math.sin(a) * s, 1.8 + this.r() * 1.2, 0.2, 0.17, [rgb[0], rgb[1], rgb[2], 1], [rgb[0], rgb[1], rgb[2], 0.0], -6.5, 0.9);
    }
  }

  /** Reacts to a race event the picture cares about. `kartAt` finds a kart's current view. */
  onEvent(e: RaceEvent, kartAt: (id: number) => KartView | undefined): void {
    switch (e.type) {
      case "bump": {
        const a = kartAt(e.a);
        const b = kartAt(e.b);
        if (!a || !b) return;
        const x = (a.x + b.x) / 2;
        const z = (a.z + b.z) / 2;
        this.puff(x, a.y + 0.5, z, 5, 0.9, 2.4);
        this.sparksBurst(x, a.y + 0.5, z, 6, 4.5);
        return;
      }
      case "wall": {
        const k = kartAt(e.kart);
        if (!k) return;
        this.puff(k.x, k.y + 0.4, k.z, 7, 1.0, 3);
        this.sparksBurst(k.x, k.y + 0.5, k.z, 12, 6);
        return;
      }
      case "hit": {
        const k = kartAt(e.kart);
        if (!k) return;
        this.puff(k.x, k.y + 0.6, k.z, 12, 1.6, 4);
        this.sparksBurst(k.x, k.y + 0.8, k.z, 14, 7);
        return;
      }
      case "pickup": {
        const k = kartAt(e.kart);
        if (k) this.pickup(k.x + Math.sin(k.heading) * 1.5, k.y, k.z + Math.cos(k.heading) * 1.5);
        return;
      }
      case "boost": {
        const k = kartAt(e.kart);
        if (k) this.boostBurst(k, e.source === "start" || e.level > 1);
        return;
      }
      case "drift-level": {
        const k = kartAt(e.kart);
        if (!k) return;
        const c0 = e.level === 1 ? BLUE0 : ORANGE0;
        const c1 = e.level === 1 ? BLUE1 : ORANGE1;
        const fx = Math.sin(k.heading);
        const fz = Math.cos(k.heading);
        const rx = -Math.cos(k.heading);
        const rz = Math.sin(k.heading);
        for (const side of [-1, 1]) {
          const x = k.x + rx * side * KART_REAR_WHEEL.right + fx * KART_REAR_WHEEL.forward;
          const z = k.z + rz * side * KART_REAR_WHEEL.right + fz * KART_REAR_WHEEL.forward;
          this.flash(x, k.y + 0.3, z, e.level === 1 ? 2.4 : 3, c0[0] * 0.8, c0[1] * 0.8, c0[2] * 0.8, 0.22);
          for (let i = 0; i < 14; i++) {
            const vx = rx * side * (1 + this.r() * 4) - fx * 2 + this.spread() * 0.8;
            const vy = 2 + this.r() * 4;
            const vz = rz * side * (1 + this.r() * 4) - fz * 2 + this.spread() * 0.8;
            this.add.emit(x, k.y + 0.3, z, vx, vy, vz, 0.3 + this.r() * 0.25, 0.34, 0.05, c0, c1, -14, 0.5);
            this.add.emit(x, k.y + 0.3, z, vx, vy, vz, 0.18 + this.r() * 0.1, 0.18, 0.03, HOT0, HOT1, -14, 0.5);
          }
        }
        return;
      }
      case "finish": {
        const k = kartAt(e.kart);
        if (k) this.confetti(k.x, k.y, k.z);
        return;
      }
      case "jump": {
        const k = kartAt(e.kart);
        if (!k) return;
        const d = this.dust;
        for (let i = 0; i < 8; i++) {
          const a = this.r() * Math.PI * 2;
          this.norm.emit(k.x + Math.cos(a) * 0.8, k.y + 0.2, k.z + Math.sin(a) * 0.8, Math.cos(a) * 2.2, 0.6 + this.r(), Math.sin(a) * 2.2, 0.5 + this.r() * 0.3, 0.5, 1.5, [d[0], d[1], d[2], 0.45], [d[0], d[1], d[2], 0], 0, 2);
        }
        return;
      }
      case "trick": {
        const k = kartAt(e.kart);
        if (!k) return;
        // A ring of coloured stars flung out round the kart.
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const c = hsl(i / 22);
          this.add.emit(k.x, k.y + k.hop + 1.1, k.z, Math.cos(a) * 5, 1 + this.r() * 2, Math.sin(a) * 5, 0.55, 0.42, 0.05, [c[0] * 2, c[1] * 2, c[2] * 2, 1], [c[0], c[1], c[2], 0], -3, 1.4);
        }
        return;
      }
      case "land": {
        const k = kartAt(e.kart);
        if (!k) return;
        const d = this.dust;
        const n = e.boost ? 20 : 15;
        // A ring of dust rolling out from under the wheels, low and fast, and a second, softer one behind it.
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + this.r() * 0.4;
          const sp = 3.2 + this.r() * 3.2;
          this.norm.emit(k.x + Math.cos(a) * 0.9, k.y + 0.2, k.z + Math.sin(a) * 0.9, Math.cos(a) * sp, 0.4 + this.r() * 1.0, Math.sin(a) * sp, 0.6 + this.r() * 0.4, 0.7, 2.6, [0.95 + d[0] * 0.0, 0.94, 0.9, 0.62], [d[0], d[1], d[2], 0], 0, 2.4);
        }
        for (let i = 0; i < 7; i++) {
          const a = this.r() * Math.PI * 2;
          this.norm.emit(k.x + Math.cos(a) * 0.5, k.y + 0.3, k.z + Math.sin(a) * 0.5, Math.cos(a) * 1.4, 1.2 + this.r() * 1.4, Math.sin(a) * 1.4, 0.9 + this.r() * 0.4, 0.9, 3.2, [d[0], d[1], d[2], 0.4], [d[0], d[1], d[2], 0], 0, 1.6);
        }
        // Grit thrown up.
        for (let i = 0; i < 10; i++) {
          const a = this.r() * Math.PI * 2;
          const sp = 2 + this.r() * 3;
          this.add.emit(k.x + Math.cos(a) * 0.8, k.y + 0.25, k.z + Math.sin(a) * 0.8, Math.cos(a) * sp, 2 + this.r() * 3, Math.sin(a) * sp, 0.3 + this.r() * 0.25, 0.12, 0.03, WHITE0, WHITE1, -14, 0.5);
        }
        if (e.boost) this.sparksBurst(k.x, k.y + 0.4, k.z, 22, 7, true);
        return;
      }
      case "fall": {
        const k = kartAt(e.kart);
        if (!k) return;
        this.puff(k.x, k.y + 0.4, k.z, 6, 1.1, 3);
        if (this.world === "volcano") this.embers(k.x, k.y - 2, k.z, 26, 1.4);
        return;
      }
      case "rescued": {
        const k = kartAt(e.kart);
        if (!k) return;
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          this.add.emit(k.x + Math.cos(a) * 1.0, k.y + 0.3, k.z + Math.sin(a) * 1.0, Math.cos(a) * 2.2, 2 + this.r() * 2, Math.sin(a) * 2.2, 0.6, 0.3, 0.05, [0.7, 1.7, 1.9, 1], [0.2, 0.7, 1.4, 0], -4, 1.2);
        }
        this.puff(k.x, k.y + 0.3, k.z, 5, 1.0, 2);
        return;
      }
      default:
        return;
    }
  }

  // ── Per kart, every frame ───────────────────────────────────────────────
  kart(k: KartView, dt: number, vis?: Visual): void {
    let st = this.state.get(k.id);
    if (!st) {
      st = { spark: 0, flame: 0, dust: 0, smoke: 0, star: 0, lastLevel: 0, lastBoost: 0, snow: 0, ice: 0, mud: 0, sand: 0, trail: 0, trick: 0, lines: 0 };
      this.state.set(k.id, st);
    }
    // Falling or being carried: the kart is not where the sim says, and none of the driving effects apply.
    if (k.rescue > 0 && vis) {
      st.trail += (vis.falling ? 70 : 16) * dt;
      while (st.trail >= 1) {
        st.trail -= 1;
        const c = this.world === "space" ? [0.5 + this.r() * 0.5, 0.6, 1.8] : this.world === "volcano" ? [2.0, 0.6 + this.r() * 0.4, 0.1] : [1.4, 1.5, 1.7];
        this.add.emit(vis.x + this.spread() * 0.9, vis.y + 0.4 + this.r() * 1.2, vis.z + this.spread() * 0.9, this.spread() * 0.6, vis.falling ? 3 + this.r() * 3 : -0.5, this.spread() * 0.6, 0.5 + this.r() * 0.4, vis.falling ? 0.34 : 0.22, 0.04, [c[0]!, c[1]!, c[2]!, 0.9], [c[0]!, c[1]!, c[2]!, 0], 0, 0.8);
      }
      if (this.world === "volcano" && vis.falling) this.embers(vis.x, vis.y - 1, vis.z, 2, 0.8);
      return;
    }
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    const rx = -Math.cos(k.heading);
    const rz = Math.sin(k.heading);
    const wheel = (side: number, lift: number): [number, number, number] => [
      k.x + rx * side * KART_REAR_WHEEL.right + fx * KART_REAR_WHEEL.forward,
      k.y + lift,
      k.z + rz * side * KART_REAR_WHEEL.right + fz * KART_REAR_WHEEL.forward,
    ];

    // Drift sparks: a few pale ones while it builds, then blue, then orange; each a hot white core with a coloured streak behind.
    if (k.drift !== 0 && !k.offroad) {
      const level = k.driftLevel;
      const rate = level === 0 ? 22 : level === 1 ? 150 : 210;
      st.spark += rate * dt;
      const c0 = level === 0 ? WHITE0 : level === 1 ? BLUE0 : ORANGE0;
      const c1 = level === 0 ? WHITE1 : level === 1 ? BLUE1 : ORANGE1;
      const size = level === 0 ? 0.17 : level === 1 ? 0.34 : 0.42;
      // The charge shows as a glow at each rear wheel, too.
      if (level > 0) {
        const glow = level === 1 ? [0.35, 0.95, 3.2] : [3.2, 1.2, 0.1];
        for (const side of [-1, 1]) {
          const p = wheel(side, 0.2);
          this.glowNow(p[0], p[1], p[2], level === 1 ? 1.9 : 2.3, glow[0]!, glow[1]!, glow[2]!, 0.7);
          this.glowNow(p[0], p[1] + 0.1, p[2], 0.7, glow[0]! * 1.4, glow[1]! * 1.4, glow[2]! * 1.4, 0.8);
        }
      }
      while (st.spark >= 1) {
        st.spark -= 1;
        const side = this.r() < 0.5 ? -1 : 1;
        const p = wheel(side, 0.14);
        // Thrown out sideways and back, with a flick up, falling quickly.
        const out = 1.2 + this.r() * 3.6;
        const vx = rx * side * out - fx * (1.5 + this.r() * 3) + this.spread() * 0.8;
        const vy = 1.8 + this.r() * 3.8;
        const vz = rz * side * out - fz * (1.5 + this.r() * 3) + this.spread() * 0.8;
        const life = 0.24 + this.r() * 0.32;
        this.add.emit(p[0], p[1], p[2], vx, vy, vz, life, size, 0.04, c0, c1, -16, 0.4);
        if (level > 0) {
          // The white-hot core, and two motes of streak trailing back along its path.
          this.add.emit(p[0], p[1], p[2], vx, vy, vz, life * 0.55, size * 0.55, 0.03, HOT0, HOT1, -16, 0.4);
          for (let t = 1; t <= 2; t++) this.add.emit(p[0] - vx * 0.03 * t, p[1] - vy * 0.03 * t, p[2] - vz * 0.03 * t, vx, vy, vz, life * (0.8 - t * 0.2), size * (0.75 - t * 0.2), 0.03, c0, c1, -16, 0.4);
        }
      }
      // A little tyre smoke under the sparks.
      st.smoke += 22 * dt;
      while (st.smoke >= 1) {
        st.smoke -= 1;
        const p = wheel(this.r() < 0.5 ? -1 : 1, 0.2);
        this.norm.emit(p[0], p[1], p[2], this.spread() * 0.8 - fx * 1.2, 0.5 + this.r() * 0.8, this.spread() * 0.8 - fz * 1.2, 0.5 + this.r() * 0.4, 0.45, 1.5, [0.94, 0.94, 0.98, 0.2], [0.9, 0.9, 0.95, 0], 0, 1.5);
      }
    } else {
      st.spark = 0;
      st.smoke = 0;
    }

    // Boost flames out of both exhausts.
    if (k.boost > 0) {
      for (const side of [-1, 1]) {
        const ex = KART_EXHAUST.right * side;
        const back = KART_EXHAUST.forward - 0.5;
        this.glowNow(k.x + rx * ex + fx * back, k.y + KART_EXHAUST.y + 0.05, k.z + rz * ex + fz * back, 1.2, 2.4, 0.9, 0.12, 0.55);
      }
      st.flame += 210 * dt;
      while (st.flame >= 1) {
        st.flame -= 1;
        const side = this.r() < 0.5 ? -1 : 1;
        const ex = KART_EXHAUST.right * side;
        const back = KART_EXHAUST.forward - 0.2;
        const blue = this.r() < 0.28;
        this.add.emit(
          k.x + rx * ex + fx * back,
          k.y + KART_EXHAUST.y + 0.08,
          k.z + rz * ex + fz * back,
          -fx * (4 + this.r() * 5) + this.spread() * 0.5,
          this.spread() * 0.6,
          -fz * (4 + this.r() * 5) + this.spread() * 0.5,
          0.2 + this.r() * 0.22,
          blue ? 0.4 : 0.68,
          0.08,
          blue ? [0.5, 1.2, 3.0, 0.9] : [2.8, 1.2, 0.15, 0.9],
          blue ? [0.1, 0.3, 2.0, 0] : [1.8, 0.3, 0.0, 0],
          0,
          1.2,
        );
        // The white-hot core of the flame, right at the pipe.
        if (this.r() < 0.3) this.add.emit(k.x + rx * ex + fx * (KART_EXHAUST.forward - 0.1), k.y + KART_EXHAUST.y + 0.08, k.z + rz * ex + fz * (KART_EXHAUST.forward - 0.1), -fx * (2 + this.r() * 3), this.spread() * 0.3, -fz * (2 + this.r() * 3), 0.12 + this.r() * 0.08, 0.26, 0.06, HOT0, HOT1, 0, 1.2);
      }
    } else {
      st.flame = 0;
    }

    // Speed lines: streaks hanging in the air that a fast kart (or one on a boost) rushes past.
    const fast = Math.abs(k.speed);
    if (!this.calm && (k.boost > 0 || fast > 30) && k.hop < 3) {
      const power = k.boost > 0 ? 1 : clamp((fast - 30) / 22) * 0.55;
      st.lines += (k.boost > 0 ? 55 : 24 * power) * dt;
      while (st.lines >= 1) {
        st.lines -= 1;
        const ahead = 2 + this.r() * 22;
        const lat = (this.r() < 0.5 ? -1 : 1) * (1.7 + this.r() * 5.5);
        const height = 0.2 + this.r() * 2.9;
        const length = clamp(fast * 0.05, 1.2, 3.8) * (0.6 + this.r() * 0.9);
        const warm = k.boost > 0;
        this.streaks.add(k.x + fx * ahead + rx * lat, k.y + height, k.z + fz * ahead + rz * lat, fx, fz, length, 0.035 + this.r() * 0.025, warm ? 2.4 : 1.2, warm ? 1.5 : 1.5, warm ? 0.7 : 2.2, (warm ? 0.6 : 0.4) * (0.5 + power * 0.5), 0.3 + this.r() * 0.15);
      }
    } else {
      st.lines = 0;
    }

    // Dust off the road: the harder the faster.
    const special = k.surface === "snow" || k.surface === "ice" || k.surface === "mud" || k.surface === "sand";
    if (k.offroad && !special && Math.abs(k.speed) > 3 && k.hop < 0.1) {
      st.dust += (20 + Math.abs(k.speed) * 2) * dt;
      while (st.dust >= 1) {
        st.dust -= 1;
        const p = wheel(this.r() < 0.5 ? -1 : 1, 0.15);
        const d = this.dust;
        this.norm.emit(p[0], p[1], p[2], this.spread() * 1.2 - fx * 1.5, 0.8 + this.r() * 1.4, this.spread() * 1.2 - fz * 1.5, 0.7 + this.r() * 0.5, 0.55, 1.9, [d[0], d[1], d[2], 0.55], [d[0], d[1], d[2], 0], 0.3, 1.3);
      }
    } else {
      st.dust = 0;
    }

    // What the kart is driving on throws up its own stuff: snow spray, ice glints, mud, sand.
    const surf = k.surface;
    if (Math.abs(k.speed) > 3 && k.hop < 0.15) {
      if (surf === "snow") {
        st.snow += (22 + Math.abs(k.speed) * 2.4) * dt;
        while (st.snow >= 1) {
          st.snow -= 1;
          const p = wheel(this.r() < 0.5 ? -1 : 1, 0.2);
          this.norm.emit(p[0], p[1], p[2], this.spread() * 1.6 - fx * 2, 1.0 + this.r() * 2.4, this.spread() * 1.6 - fz * 2, 0.7 + this.r() * 0.5, 0.45, 1.8, [0.97, 0.99, 1.0, 0.7], [0.9, 0.95, 1.0, 0], -2, 1.4);
          if (this.r() < 0.35) this.add.emit(p[0], p[1] + 0.2, p[2], this.spread() * 2 - fx * 2, 1.5 + this.r() * 2.5, this.spread() * 2 - fz * 2, 0.5, 0.12, 0.03, [1.6, 1.8, 2.0, 1], [0.9, 1.2, 1.6, 0], -9, 0.6);
        }
      } else if (surf === "ice") {
        st.ice += 40 * dt;
        while (st.ice >= 1) {
          st.ice -= 1;
          const p = wheel(this.r() < 0.5 ? -1 : 1, 0.06);
          // Bright glints skittering out behind the wheels, and a pale streak where it slides.
          this.add.emit(p[0] + this.spread() * 0.4, p[1], p[2] + this.spread() * 0.4, -fx * (2 + this.r() * 4) + this.spread() * 1.5, 0.3 + this.r() * 1.2, -fz * (2 + this.r() * 4) + this.spread() * 1.5, 0.35 + this.r() * 0.3, 0.2, 0.03, [1.5, 2.0, 2.4, 1], [0.6, 1.2, 2.0, 0], -3, 1.0);
        }
      } else if (surf === "mud") {
        st.mud += (26 + Math.abs(k.speed) * 2.2) * dt;
        while (st.mud >= 1) {
          st.mud -= 1;
          const p = wheel(this.r() < 0.5 ? -1 : 1, 0.2);
          this.norm.emit(p[0], p[1], p[2], this.spread() * 1.4 - fx * 3.4, 2.4 + this.r() * 3.6, this.spread() * 1.4 - fz * 3.4, 0.55 + this.r() * 0.4, 0.34, 0.5, [0.33, 0.21, 0.11, 0.95], [0.26, 0.16, 0.08, 0], -16, 0.5);
        }
      } else if (surf === "sand") {
        st.sand += (24 + Math.abs(k.speed) * 2) * dt;
        while (st.sand >= 1) {
          st.sand -= 1;
          const p = wheel(this.r() < 0.5 ? -1 : 1, 0.15);
          this.norm.emit(p[0], p[1], p[2], this.spread() * 1.4 - fx * 2, 0.8 + this.r() * 1.6, this.spread() * 1.4 - fz * 2, 0.8 + this.r() * 0.5, 0.6, 2.2, [0.93, 0.8, 0.52, 0.55], [0.93, 0.8, 0.52, 0], 0.2, 1.3);
        }
      }
    }
    // A trick throws coloured lights round the kart.
    if (k.trick > 0) {
      const t = k.trick * 12;
      for (let i = 0; i < 3; i++) {
        const a = t + (i * Math.PI * 2) / 3;
        const c = hsl(((k.trick * 1.4 + i / 3) % 1 + 1) % 1);
        this.glowNow(k.x + Math.cos(a) * 1.3, k.y + k.hop + 1.0 + Math.sin(a * 0.5) * 0.4, k.z + Math.sin(a) * 1.3, 0.6, c[0] * 2.4, c[1] * 2.4, c[2] * 2.4, 0.9);
      }
    }

    // A spin-out throws up smoke and circling sparkles.
    if (k.spin > 0) {
      st.star += 38 * dt;
      while (st.star >= 1) {
        st.star -= 1;
        const a = this.r() * Math.PI * 2;
        this.norm.emit(k.x + Math.cos(a) * 0.6, k.y + 0.2, k.z + Math.sin(a) * 0.6, this.spread() * 1.2, 0.8 + this.r(), this.spread() * 1.2, 0.6, 0.6, 2.0, [0.92, 0.92, 0.96, 0.4], [0.85, 0.86, 0.9, 0], 0, 1.4);
      }
      const t = performance.now() / 1000;
      for (let i = 0; i < 3; i++) {
        const a = t * 9 + (i * Math.PI * 2) / 3;
        this.glowNow(k.x + Math.cos(a) * 0.9, k.y + 2.1 + Math.sin(t * 3 + i) * 0.1, k.z + Math.sin(a) * 0.9, 0.5, 1.0, 0.85, 0.2, 1);
      }
    } else {
      st.star = 0;
    }
    st.lastLevel = k.driftLevel;
    st.lastBoost = k.boost;
  }

  update(dt: number): void {
    const step = clamp(dt, 0, 0.1);
    this.add.update(step);
    this.norm.update(step);
    this.now.update(step);
    this.streaks.update(step);
  }

  /** Forgets per-kart state and lets every particle go (a new race: the last one's smoke and confetti do not hang over the grid). */
  clear(): void {
    this.state.clear();
    this.streaks.clear();
    this.add.clear();
    this.norm.clear();
    this.now.clear();
  }

  /** Particles alive, of the lasting kinds (light and smoke). */
  get live(): number {
    return this.add.live + this.norm.live;
  }

  dispose(): void {
    for (const s of [this.add, this.norm, this.now]) {
      s.points.geometry.dispose();
      (s.points.material as { dispose(): void }).dispose();
    }
    this.streaks.dispose();
  }
}

/** A bright, saturated colour for hue 0..1 as linear-ish RGB. */
function hsl(h: number): [number, number, number] {
  // Standard HSL to RGB at s = 0.9, l = 0.6, then roughly linearised.
  const s = 0.9;
  const l = 0.6;
  const c = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const lin = (v: number) => Math.pow(v, 2.2);
  return [lin(c(0)), lin(c(8)), lin(c(4))];
}
