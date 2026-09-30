/**
 * A hand that aims like a person: a slightly under-damped spring chases the
 * point it wants, so a move starts gently, arrives with a hint of overshoot
 * and settles, with a faint tremor on top. A Shooter fires when the hand has
 * settled on its target, and schedules each shot a beat ahead so the thumb in
 * the corner picture can start folding before the shot lands.
 */

export interface Want {
  /** Where to point, as stage fractions. */
  x: number;
  y: number;
  /** How close counts as on target (stage-height fractions). */
  r: number;
  /** A moving target's velocity (fractions per second), to lead it a little. */
  vx?: number;
  vy?: number;
  /** Do not fire yet, only follow (e.g. waiting for a scope to come up). */
  hold?: boolean;
  /** Called when a shot is committed (the thumb starts to fold). */
  onFire?: () => void;
  /** Ask for this shot to wait until this time. */
  notBefore?: number;
}

/** A tiny deterministic generator, so a take is the same every time. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShooterOptions {
  /** Spring stiffness, rad/s: higher is a quicker hand. */
  omega?: number;
  /** Damping ratio: below 1 overshoots a little. */
  zeta?: number;
  /** Seconds between a shot and the next (the thumb comes back up). */
  cock?: number;
  /** How long the hand must sit on the target before firing, s. */
  settle?: number;
  /** The thumb starts folding this long before the shot registers, s. */
  lead?: number;
  tremor?: number;
  seed?: number;
}

export class Shooter {
  x = 0.5;
  y = 0.5;
  vx = 0;
  vy = 0;
  /** Times shots were (or will be) registered, for the thumb's envelope. */
  shots: number[] = [];
  /** Shots registered so far. */
  fired = 0;
  private pending: number | null = null;
  private onFor = 0;
  private nextOk = 0;
  private wanderT = 0;
  private readonly rand: () => number;
  private readonly o: Required<ShooterOptions>;
  private goal: { x: number; y: number } = { x: 0.5, y: 0.5 };
  private readonly phase: number[];

  constructor(options: ShooterOptions = {}) {
    this.o = { omega: 15, zeta: 0.72, cock: 0.3, settle: 0.09, lead: 0.07, tremor: 0.0011, seed: 7, ...options };
    this.rand = rng(this.o.seed);
    this.phase = [this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28];
  }

  /** Place the hand somewhere at once (the start of a take). */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = this.vy = 0;
    this.goal = { x, y };
  }

  /**
   * One frame. `want` is where to point and shoot, or null to idle around
   * `rest`. Returns whether a shot registers on this frame.
   */
  step(t: number, dt: number, want: Want | null, rest: { x: number; y: number }): boolean {
    let tx: number;
    let ty: number;
    if (want) {
      // Lead a moving target by a fraction of a second, as a shooter would.
      tx = want.x + (want.vx ?? 0) * 0.12;
      ty = want.y + (want.vy ?? 0) * 0.12;
      this.goal = { x: tx, y: ty };
    } else {
      // Idle: drift around the resting point, slowly.
      this.wanderT += dt;
      tx = rest.x + Math.sin(this.wanderT * 0.7 + this.phase[0]!) * 0.035;
      ty = rest.y + Math.sin(this.wanderT * 0.53 + this.phase[1]!) * 0.02;
      this.goal = { x: tx, y: ty };
    }
    const w = this.o.omega;
    const z = this.o.zeta;
    // Semi-implicit Euler on x'' = w^2 (goal - x) - 2 z w x'.
    const ax = w * w * (tx - this.x) - 2 * z * w * this.vx;
    const ay = w * w * (ty - this.y) - 2 * z * w * this.vy;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    let fires = false;
    if (this.pending !== null && t >= this.pending - 1e-9) {
      this.pending = null;
      this.fired++;
      fires = true;
    }
    if (want && !want.hold && this.pending === null && t >= this.nextOk && t >= (want.notBefore ?? -Infinity)) {
      const dist = Math.hypot((this.x - tx) * 16, (this.y - ty) * 9) / 9; // in stage heights
      const speed = Math.hypot(this.vx * 16, this.vy * 9) / 9;
      if (dist < want.r && speed < 0.55) this.onFor += dt;
      else this.onFor = 0;
      if (this.onFor >= this.o.settle) {
        this.pending = t + this.o.lead;
        want.onFire?.();
        this.shots.push(this.pending);
        this.nextOk = this.pending + this.o.cock;
        this.onFor = 0;
      }
    } else if (!want) {
      this.onFor = 0;
    }
    return fires;
  }

  /** Where the crosshair is shown: the spring's position plus a faint tremor. */
  get shown(): { x: number; y: number } {
    const t = this.wanderT;
    const a = this.o.tremor;
    return {
      x: this.x + a * (Math.sin(this.tick * 9.1 + this.phase[2]!) + 0.6 * Math.sin(this.tick * 17.3 + t)),
      y: this.y + a * (Math.sin(this.tick * 8.3 + this.phase[3]!) + 0.6 * Math.sin(this.tick * 15.7 + t)),
    };
  }
  private tick = 0;
  /** Call once a frame before `shown`. */
  advanceTick(dt: number): void {
    this.tick += dt;
  }

  /** The thumb, 0 (cocked) to 1 (folded), at time t: it folds a beat before each shot registers. */
  fold(t: number): number {
    let f = 0;
    for (let i = this.shots.length - 1; i >= 0 && i >= this.shots.length - 4; i--) {
      const d = t - this.shots[i]!;
      const lead = this.o.lead;
      let e = 0;
      if (d >= -lead && d < 0) e = (d + lead) / lead;
      else if (d >= 0 && d < 0.1) e = 1;
      else if (d >= 0.1 && d < 0.3) e = 1 - (d - 0.1) / 0.2;
      f = Math.max(f, e * e * (3 - 2 * e) || e);
    }
    return f;
  }

  /** Seconds since the last registered shot (for a kick), or Infinity. */
  sinceShot(t: number): number {
    for (let i = this.shots.length - 1; i >= 0; i--) if (this.shots[i]! <= t) return t - this.shots[i]!;
    return Infinity;
  }
}
