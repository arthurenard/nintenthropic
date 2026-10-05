/**
 * Fireworks over the Fun Fair finish line when a player wins there: rockets
 * climb with a trail of glitter and burst into rings of light that fall
 * away. One pooled additive sprite cloud (points.ts), no allocation while it
 * runs, and a show is planned from a seed (`planShow`) so it is tested
 * without a picture.
 */
import { Group, type BufferAttribute } from "three";
import { mulberry32 } from "../../engine/rules/rng";
import { makePoints } from "./points";

/** Linear RGB, above 1 where the light should glow. */
const PALETTE: readonly (readonly [number, number, number])[] = [
  [3.2, 0.5, 1.3], // pink
  [3.0, 2.0, 0.4], // gold
  [0.4, 2.2, 3.2], // cyan
  [0.6, 3.0, 0.9], // green
  [3.0, 3.0, 3.0], // white
  [1.9, 0.8, 3.2], // violet
];

/** One rocket of a show. Positions are in the show's own frame: x to the right of the road, z ahead along it, metres from the line. */
export interface Shell {
  /** Seconds after the show begins that it leaves the ground. */
  at: number;
  x: number;
  z: number;
  /** The height it bursts at, metres. */
  burst: number;
  /** Seconds in the air. */
  flight: number;
  colour: readonly [number, number, number];
  second: readonly [number, number, number];
  sparks: number;
  /** m/s at the burst. */
  speed: number;
}

/** A show of `count` rockets, one every third of a second or so, from a seed. */
export function planShow(seed: number, count = 14): Shell[] {
  const random = mulberry32(seed);
  const between = (low: number, high: number) => low + (high - low) * random();
  const shells: Shell[] = [];
  for (let i = 0; i < count; i++) {
    const colour = PALETTE[Math.floor(random() * PALETTE.length)]!;
    let second = PALETTE[Math.floor(random() * PALETTE.length)]!;
    if (second === colour) second = PALETTE[(PALETTE.indexOf(colour) + 3) % PALETTE.length]!;
    const z = between(55, 140);
    shells.push({
      at: i * 0.36 + between(0, 0.25),
      x: between(-48, 48),
      z,
      // Seen from the line, a shell this far off bursts up in the sky at a comfortable angle, not over the camera's head.
      burst: Math.max(16, z * between(0.2, 0.42)),
      flight: between(1.05, 1.5),
      colour,
      second,
      sparks: Math.round(between(46, 72)),
      speed: between(16, 26),
    });
  }
  return shells;
}

const CAPACITY = 1400;
/** Gravity on a spark, m/s²; the sparks are light and drag hard. */
const GRAVITY = 7;

export class Fireworks {
  readonly group = new Group();
  /** Reduce Motion: no show. */
  calm = false;

  private readonly points = makePoints(CAPACITY, true);
  private readonly pos = this.points.geometry.getAttribute("position") as BufferAttribute;
  private readonly col = this.points.geometry.getAttribute("aColour") as BufferAttribute;
  private readonly siz = this.points.geometry.getAttribute("aSize") as BufferAttribute;
  // Per particle.
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vy = new Float32Array(CAPACITY);
  private readonly vz = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY).fill(1);
  private readonly life = new Float32Array(CAPACITY).fill(1);
  private readonly size = new Float32Array(CAPACITY);
  private readonly rgb = new Float32Array(CAPACITY * 3);
  private readonly drag = new Float32Array(CAPACITY);
  /** 0 spark, 1 rocket (bursts when its life ends), 2 glitter. */
  private readonly kind = new Uint8Array(CAPACITY);
  /** For a rocket: the shell it carries. */
  private readonly shell: (Shell | null)[] = new Array<Shell | null>(CAPACITY).fill(null);
  private readonly trail = new Float32Array(CAPACITY);
  private next = 0;

  private show: { clock: number; shells: Shell[]; fired: number; ox: number; oy: number; oz: number; fx: number; fz: number } | null = null;

  constructor() {
    this.group.add(this.points);
    this.group.visible = false;
  }

  /** Is anything still in the sky, or yet to be launched? */
  get active(): boolean {
    return this.show !== null || this.live() > 0;
  }

  live(): number {
    let n = 0;
    for (let i = 0; i < CAPACITY; i++) if (this.age[i]! < this.life[i]!) n++;
    return n;
  }

  /** Begins a show over `origin` (the finish line's middle), facing along the road `heading`. A show already going on carries on. */
  start(origin: { x: number; y: number; z: number }, heading: number, seed = 1): void {
    if (this.calm || this.show) return;
    this.show = { clock: 0, shells: planShow(seed), fired: 0, ox: origin.x, oy: origin.y, oz: origin.z, fx: Math.sin(heading), fz: Math.cos(heading) };
    this.group.visible = true;
  }

  clear(): void {
    this.show = null;
    this.age.fill(1);
    this.life.fill(1);
    this.draw();
    this.group.visible = false;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    const show = this.show;
    if (show) {
      show.clock += dt;
      while (show.fired < show.shells.length && show.shells[show.fired]!.at <= show.clock) this.launch(show, show.shells[show.fired++]!);
      if (show.fired >= show.shells.length) this.show = null;
    }
    for (let i = 0; i < CAPACITY; i++) {
      const life = this.life[i]!;
      if (this.age[i]! >= life) continue;
      this.age[i]! += dt;
      const slow = Math.exp(-this.drag[i]! * dt);
      this.vx[i]! *= slow;
      this.vz[i]! *= slow;
      this.vy[i] = this.vy[i]! * slow - (this.kind[i] === 1 ? 0 : GRAVITY) * dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.z[i]! += this.vz[i]! * dt;
      if (this.kind[i] === 1) {
        // A rocket sheds glitter as it climbs, and bursts at the top.
        this.trail[i]! += dt;
        while (this.trail[i]! > 0.025) {
          this.trail[i]! -= 0.025;
          this.emit(this.x[i]!, this.y[i]!, this.z[i]!, (Math.random() - 0.5) * 2, -2 - Math.random() * 2, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.4, 0.9, [3.0, 2.0, 0.7], 2, 2.2);
        }
        if (this.age[i]! >= life) this.burst(this.shell[i]!, this.x[i]!, this.y[i]!, this.z[i]!);
      }
    }
    if (!this.show && this.live() === 0) this.group.visible = false;
    this.draw();
  }

  dispose(): void {
    this.group.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as { dispose(): void }).dispose();
  }

  // ─── Inside ───────────────────────────────────────────────────────────────

  private launch(show: NonNullable<Fireworks["show"]>, shell: Shell): void {
    // In the show's frame: x to the right of the road (the right is (-fz, fx) of the forward (fx, fz)), z ahead.
    const wx = show.ox + shell.z * show.fx - shell.x * show.fz;
    const wz = show.oz + shell.z * show.fz + shell.x * show.fx;
    const i = this.emit(wx, show.oy, wz, 0, shell.burst / shell.flight, 0, shell.flight, 1.1, shell.colour, 1, 0);
    this.shell[i] = shell;
    this.trail[i] = 0;
  }

  private burst(shell: Shell, x: number, y: number, z: number): void {
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < shell.sparks; k++) {
      // Spread over a sphere, in two rings of colour.
      const up = 1 - (2 * (k + 0.5)) / shell.sparks;
      const around = Math.sqrt(1 - up * up);
      const angle = k * golden;
      const speed = shell.speed * (k % 2 ? 1 : 0.62);
      this.emit(x, y, z, Math.cos(angle) * around * speed, up * speed, Math.sin(angle) * around * speed, 1.4 + (k % 3) * 0.3, 1.7, k % 2 ? shell.colour : shell.second, 0, 1.5);
    }
    // A flash at the heart of it.
    this.emit(x, y, z, 0, 0, 0, 0.4, 14, [3.4, 3.2, 2.8], 0, 0);
  }

  /** Brings one particle to life; returns where. */
  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, rgb: readonly [number, number, number], kind: number, drag: number): number {
    const i = this.next;
    this.next = (this.next + 1) % CAPACITY;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.rgb[i * 3] = rgb[0];
    this.rgb[i * 3 + 1] = rgb[1];
    this.rgb[i * 3 + 2] = rgb[2];
    this.kind[i] = kind;
    this.drag[i] = drag;
    this.shell[i] = null;
    return i;
  }

  private draw(): void {
    for (let i = 0; i < CAPACITY; i++) {
      const alive = this.age[i]! < this.life[i]!;
      this.pos.setXYZ(i, this.x[i]!, this.y[i]!, this.z[i]!);
      if (!alive) {
        this.col.setXYZW(i, 0, 0, 0, 0);
        this.siz.setX(i, 0);
        continue;
      }
      const k = this.age[i]! / this.life[i]!;
      // Bright for most of its life, then gone; glitter twinkles.
      const fade = Math.pow(1 - k, this.kind[i] === 1 ? 0.2 : 0.9);
      const twinkle = this.kind[i] === 2 ? 0.55 + 0.45 * Math.sin(this.age[i]! * 60 + i) : 1;
      const a = fade * twinkle;
      this.col.setXYZW(i, this.rgb[i * 3]!, this.rgb[i * 3 + 1]!, this.rgb[i * 3 + 2]!, a);
      this.siz.setX(i, this.size[i]! * (this.kind[i] === 0 ? 1 - 0.55 * k : 1));
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.siz.needsUpdate = true;
  }
}
