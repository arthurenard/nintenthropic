/**
 * Particles: drift sparks (blue, then orange), boost flames, dust off the
 * road, tyre smoke, bump puffs and the confetti of a win. Two pooled
 * systems, one drawn additively (light) and one with ordinary blending
 * (smoke and dust), each a single draw call over a ring buffer of sprites.
 * Nothing is allocated while racing.
 */
import { Group, type Points } from "three";
import type { KartView, RaceEvent } from "../contract";
import { KART_EXHAUST, KART_REAR_WHEEL } from "./kart";
import { clamp } from "./math";
import { makePoints } from "./points";

type Pool = "add" | "norm";

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

  constructor(capacity: number, additive: boolean) {
    this.n = capacity;
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
    const col = this.points.geometry.getAttribute("aColor");
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
      for (let q = 0; q < 4; q++) C[k + q] = this.c0[k + q]! + (this.c1[k + q]! - this.c0[k + q]!) * u;
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
}

const BLUE0 = [0.35, 0.78, 1.0, 1] as const;
const BLUE1 = [0.1, 0.3, 1.0, 0] as const;
const ORANGE0 = [1.0, 0.78, 0.22, 1] as const;
const ORANGE1 = [1.0, 0.25, 0.0, 0] as const;
const WHITE0 = [1.0, 0.96, 0.8, 0.9] as const;
const WHITE1 = [1.0, 0.7, 0.3, 0] as const;

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
      default:
        return;
    }
  }

  // ── Per kart, every frame ───────────────────────────────────────────────
  kart(k: KartView, dt: number): void {
    let st = this.state.get(k.id);
    if (!st) {
      st = { spark: 0, flame: 0, dust: 0, smoke: 0, star: 0, lastLevel: 0, lastBoost: 0 };
      this.state.set(k.id, st);
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
      const rate = level === 0 ? 14 : level === 1 ? 80 : 110;
      st.spark += rate * dt;
      const c0 = level === 0 ? WHITE0 : level === 1 ? BLUE0 : ORANGE0;
      const c1 = level === 0 ? WHITE1 : level === 1 ? BLUE1 : ORANGE1;
      const size = level === 0 ? 0.14 : level === 1 ? 0.22 : 0.28;
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
        this.norm.emit(p[0], p[1], p[2], this.spread() * 0.8 - fx * 1.2, 0.5 + this.r() * 0.8, this.spread() * 0.8 - fz * 1.2, 0.5 + this.r() * 0.4, 0.45, 1.5, [0.94, 0.94, 0.98, 0.28], [0.9, 0.9, 0.95, 0], 0, 1.5);
      }
    } else {
      st.spark = 0;
      st.smoke = 0;
    }

    // Boost flames out of both exhausts.
    if (k.boost > 0) {
      st.flame += 110 * dt;
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
          0.16 + this.r() * 0.16,
          blue ? 0.28 : 0.42,
          0.06,
          blue ? [0.55, 0.8, 1.0, 0.95] : [1.0, 0.8, 0.3, 0.95],
          blue ? [0.2, 0.4, 1.0, 0] : [1.0, 0.25, 0.04, 0],
          0,
          1.2,
        );
      }
    } else {
      st.flame = 0;
    }

    // Dust off the road: the harder the faster.
    if (k.offroad && Math.abs(k.speed) > 3 && k.hop < 0.1) {
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
