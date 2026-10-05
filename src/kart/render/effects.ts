/**
 * Particles: drift sparks (blue, then orange), boost flames, dust off the
 * road, tyre smoke, bump puffs and the confetti of a win. Two pooled
 * systems, one drawn additively (light) and one with ordinary blending
 * (smoke and dust), each a single draw call over a ring buffer of sprites.
 * Nothing is allocated while racing.
 */
import { Group, type Points } from "three";
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
const BLUE0 = [0.22, 0.7, 2.0, 1] as const;
const BLUE1 = [0.08, 0.25, 1.6, 0] as const;
const ORANGE0 = [1.9, 0.8, 0.08, 1] as const;
const ORANGE1 = [1.5, 0.22, 0.0, 0] as const;
const WHITE0 = [1.5, 1.4, 1.1, 0.9] as const;
const WHITE1 = [1.2, 0.7, 0.25, 0] as const;

export class Effects {
  readonly group = new Group();
  private readonly add: Sprites;
  private readonly norm: Sprites;
  private readonly now: Sprites;
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
    this.group.add(this.norm.points, this.add.points, this.now.points);
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
    this.now.emit(x, y, z, 0, 0, 0, 0.03, size, size, [r, g, b, a], [r, g, b, a]);
  }

  /** One soft mote of a moving thing's trail. */
  trail(x: number, y: number, z: number, r: number, g: number, b: number, size = 0.4): void {
    this.add.emit(x, y, z, this.spread() * 0.4, this.spread() * 0.4, this.spread() * 0.4, 0.32, size, 0.05, [r, g, b, 0.8], [r, g, b, 0], 0, 1.5);
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

  /** A burst of glitter where an item box was taken. */
  pickup(x: number, y: number, z: number): void {
    for (let i = 0; i < 26; i++) {
      const hue = this.r();
      const rgb = hsl(hue);
      const a = this.r() * Math.PI * 2;
      const s = 2 + this.r() * 5;
      this.add.emit(x, y + 1.2, z, Math.cos(a) * s, 1.5 + this.r() * 4, Math.sin(a) * s, 0.5 + this.r() * 0.5, 0.34, 0.06, [rgb[0], rgb[1], rgb[2], 1], [rgb[0], rgb[1], rgb[2], 0], -6, 1.2);
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
          for (let i = 0; i < 9; i++) {
            this.add.emit(
              k.x + rx * side * KART_REAR_WHEEL.right + fx * KART_REAR_WHEEL.forward,
              k.y + 0.3,
              k.z + rz * side * KART_REAR_WHEEL.right + fz * KART_REAR_WHEEL.forward,
              rx * side * (1 + this.r() * 3) - fx * 2,
              2 + this.r() * 3,
              rz * side * (1 + this.r() * 3) - fz * 2,
              0.3 + this.r() * 0.2,
              0.3,
              0.06,
              c0,
              c1,
              -14,
              0.5,
            );
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
        const n = e.boost ? 14 : 9;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + this.r() * 0.4;
          const sp = 2.5 + this.r() * 2.5;
          this.norm.emit(k.x + Math.cos(a) * 0.9, k.y + 0.25, k.z + Math.sin(a) * 0.9, Math.cos(a) * sp, 0.5 + this.r() * 1.2, Math.sin(a) * sp, 0.55 + this.r() * 0.35, 0.6, 2.0, [0.95 + d[0] * 0.0, 0.94, 0.9, 0.5], [d[0], d[1], d[2], 0], 0, 2.4);
        }
        if (e.boost) this.sparksBurst(k.x, k.y + 0.4, k.z, 16, 6.5, true);
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
      st = { spark: 0, flame: 0, dust: 0, smoke: 0, star: 0, lastLevel: 0, lastBoost: 0, snow: 0, ice: 0, mud: 0, sand: 0, trail: 0, trick: 0 };
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

    // Drift sparks: a few pale ones while it builds, then blue, then orange.
    if (k.drift !== 0 && !k.offroad) {
      const level = k.driftLevel;
      const rate = level === 0 ? 16 : level === 1 ? 130 : 170;
      st.spark += rate * dt;
      const c0 = level === 0 ? WHITE0 : level === 1 ? BLUE0 : ORANGE0;
      const c1 = level === 0 ? WHITE1 : level === 1 ? BLUE1 : ORANGE1;
      const size = level === 0 ? 0.16 : level === 1 ? 0.3 : 0.38;
      // The charge shows as a glow at each rear wheel, too.
      if (level > 0) {
        const glow = level === 1 ? [0.25, 0.65, 1.8] : [1.8, 0.75, 0.08];
        for (const side of [-1, 1]) {
          const p = wheel(side, 0.2);
          this.glowNow(p[0], p[1], p[2], level === 1 ? 1.5 : 1.9, glow[0]!, glow[1]!, glow[2]!, 0.55);
        }
      }
      while (st.spark >= 1) {
        st.spark -= 1;
        const side = this.r() < 0.5 ? -1 : 1;
        const p = wheel(side, 0.14);
        // Thrown out sideways and back, with a flick up, falling quickly.
        const out = 1.2 + this.r() * 3.2;
        this.add.emit(
          p[0],
          p[1],
          p[2],
          rx * side * out - fx * (1.5 + this.r() * 3) + this.spread() * 0.8,
          1.8 + this.r() * 3.5,
          rz * side * out - fz * (1.5 + this.r() * 3) + this.spread() * 0.8,
          0.22 + this.r() * 0.3,
          size,
          0.04,
          c0,
          c1,
          -16,
          0.4,
        );
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
        this.glowNow(k.x + rx * ex + fx * back, k.y + KART_EXHAUST.y + 0.05, k.z + rz * ex + fz * back, 1.1, 1.8, 0.7, 0.12, 0.6);
      }
      st.flame += 190 * dt;
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
          blue ? 0.4 : 0.62,
          0.08,
          blue ? [0.4, 0.9, 2.0, 0.95] : [1.9, 0.9, 0.15, 0.95],
          blue ? [0.1, 0.3, 1.6, 0] : [1.5, 0.25, 0.02, 0],
          0,
          1.2,
        );
      }
    } else {
      st.flame = 0;
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
  }

  /** Forgets per-kart state (a new race). */
  clear(): void {
    this.state.clear();
  }

  dispose(): void {
    for (const s of [this.add, this.norm, this.now]) {
      s.points.geometry.dispose();
      (s.points.material as { dispose(): void }).dispose();
    }
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
