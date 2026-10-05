/**
 * The wheel: both of the player's hands, held up like the grips of a steering
 * wheel, read from the camera into a DriveInput (docs/GRIP_PRIX.md, "Input").
 *
 * WheelReader is pure: it is fed HandFrames and asked for the input at a time,
 * and touches no camera, clock or DOM, so every gesture can be tested with
 * made-up hands. wheelControl() (control.ts) is what plugs it into the tracker
 * and the game.
 *
 *   - the angle of the line from the left palm to the right palm steers
 *   - both fists: the kart drives itself (throttle 1)
 *   - both hands open: brake, and the sim backs up if it is held
 *   - one hand opened and closed again, the other staying a fist: use the item
 *   - both hands jerked up: hop, which starts a drift the player lets go of by
 *     straightening the wheel
 *   - hands out of the picture: hold the angle a moment, then ease to the centre
 *
 * Times are seconds inside, milliseconds at the doors (a frame's capturedAt,
 * sample's `now`), as the rest of the tracker's clock is.
 */
import { OneEuroFilter } from "../../input/filter";
import type { DriveInput, WheelHand, WheelStatus } from "../contract";
import type { HandFrame } from "../../tracking/types";
import { Grip, readHand, type HandReading } from "./hands";

/** How much turn is full lock: Settings, Steering. */
export type Steering = "gentle" | "normal" | "quick";

/** Degrees of wheel for full lock. */
export const STEERING_LOCK: Readonly<Record<Steering, number>> = { gentle: 50, normal: 40, quick: 30 };

/** Every number the wheel's feel rests on, in one place so real hands can move them. */
export const WHEEL = {
  /** Degrees either side of level that do nothing: a straight line stays straight. */
  deadZone: 4,
  /** Steer = (how far into the lock, 0..1) to this power: below 1 would be twitchy, above 1 is gentle near the centre. */
  curve: 1.5,
  /** The angle's One Euro filter: steady when the wheel rests, quick when it is turned fast. */
  smoothing: { minCutoff: 1.5, beta: 0.05 },
  /** Both hands open this long: brake, seconds. */
  brakeAfter: 0.15,
  /** A hand open for longer than this and closed again is not a flick, seconds. */
  flick: 0.6,
  /** Both hands opening within this of each other is a brake, never an item, seconds. */
  together: 0.25,
  hop: {
    /** The wheel's centre must rise faster than this many hand-spans a second... */
    speed: 1.6,
    /** ...by at least this many spans. */
    rise: 0.25,
    /** Looking back this far for the start of the rise, seconds. */
    window: 0.3,
    /** No second hop for this long after one, seconds. */
    cooldown: 0.5,
  },
  drift: {
    /** The drift ends when |steer| has stayed below this... */
    straight: 0.15,
    /** ...for this long, seconds. */
    hold: 0.2,
  },
  /** One hand gone: hold the angle this long, then ease to the centre over `ease`, seconds. */
  oneHand: { hold: 0.4, ease: 0.6 },
  /** Both gone: steer eases to the centre after `hold` over `ease`; throttle stops after `throttle`; mode says lost after `mode`. */
  noHands: { hold: 0.25, ease: 0.5, throttle: 0.5, mode: 0.3 },
  /** A hand seen this recently still counts as in the picture (a dropped frame or two), seconds. */
  present: 0.2,
  /** A hand missing this long keeps its grip as it was, for gestures, seconds. */
  held: 0.4,
  /** A hand missing this long is forgotten: it comes back as a new one, told left from right by side again, seconds. */
  forget: 1.5,
  /** The steer comes back in over this long after hands return, seconds. */
  recover: 0.25,
  level: {
    /** Hold the wheel steady this long to set the level, seconds. */
    hold: 1,
    /** Steady means the angle stays within this many degrees. */
    steady: 5,
    /** A wheel turned further than this is not level, however steady. */
    tilt: 30,
  },
} as const;

/** Steer, -1..1, for a wheel turned `angle` degrees from level. */
export function shapeSteer(angle: number, steering: Steering | number = "normal"): number {
  const lock = typeof steering === "number" ? steering : STEERING_LOCK[steering];
  const size = Math.abs(angle);
  if (!(size > WHEEL.deadZone)) return 0;
  const fraction = Math.min(1, (size - WHEEL.deadZone) / (lock - WHEEL.deadZone));
  return Math.sign(angle) * Math.pow(fraction, WHEEL.curve);
}

export interface WheelOptions {
  steering?: Steering;
  /** Two players on one camera: only hands whose (mirrored) palm is in this half of the picture count. */
  half?: "left" | "right" | null;
  /** The picture's width over its height (x and y are fractions of each, so angles need it). */
  aspect?: number;
}

/** What the wheel gives at a moment: for the screens, and for the kart. */
export interface WheelOutput {
  status: WheelStatus;
  input: DriveInput;
}

type Side = "left" | "right";

/** What the reader remembers of one hand of the wheel. */
interface Slot {
  grip: Grip;
  /** The newest reading, and when it came (-Infinity: never). */
  reading: HandReading | null;
  seenAt: number;
  /** When the current (or last) open stretch began, and whether it can still end as an item flick. */
  openedAt: number;
  flickOk: boolean;
}

/** A lone hand within this of the one known (picture heights) is that hand, not the other. */
const NEAR = 0.25;

const newSlot = (): Slot => ({ grip: new Grip(), reading: null, seenAt: -Infinity, openedAt: -Infinity, flickOk: false });

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** An angle in degrees brought into -180..180. */
const wrap = (degrees: number): number => degrees - 360 * Math.round(degrees / 360);

export class WheelReader {
  steering: Steering;
  half: "left" | "right" | null;
  /** The picture's width over its height. Set it from the camera (width / height) once it is open. */
  aspect: number;

  private readonly slots: Record<Side, Slot> = { left: newSlot(), right: newSlot() };
  private readonly filter = new OneEuroFilter(WHEEL.smoothing.minCutoff, WHEEL.smoothing.beta);
  /** The smoothed wheel angle before the level is taken away, degrees, unwrapped (it can pass 180). */
  private angle = 0;
  private haveAngle = false;
  private levelDegrees = 0;
  private isLevelled = false;
  private time = -Infinity;
  private lastAnySeen = -Infinity;
  private lastBothSeen = -Infinity;
  private lastSettle = -Infinity;
  private fade = 0;
  private braking = false;
  private drifting = false;
  private straightSince: number | null = null;
  private presses = 0;
  private hopTrail: { t: number; y: number }[] = [];
  private hopAllowedAt = -Infinity;
  private auto: { samples: { t: number; a: number }[]; done: (() => void) | undefined } | null = null;
  private progress = 0;

  constructor(options: WheelOptions = {}) {
    this.steering = options.steering ?? "normal";
    this.half = options.half ?? null;
    this.aspect = options.aspect ?? 16 / 9;
  }

  // ─── Feeding it ───────────────────────────────────────────────────────────

  /**
   * One camera frame. `at` is when it arrived, ms (by default when the camera
   * took it): the clock `sample` is asked the time on. Frames with no hand in
   * them matter as much as those with two - they are how the wheel knows the
   * hands have gone.
   */
  push(frame: HandFrame, at: number = frame.capturedAt): void {
    const t = this.advance(at);
    const seen = this.assign(this.candidates(frame), t);
    for (const side of ["left", "right"] as const) {
      const slot = this.slots[side];
      // A hand back after a long absence is a stranger again: no hold against what it was.
      if (seen[side] && t - slot.seenAt > WHEEL.held) slot.grip.reset();
    }
    const before = { left: this.slots.left.grip.state, right: this.slots.right.grip.state };
    for (const side of ["left", "right"] as const) {
      const slot = this.slots[side];
      const reading = seen[side];
      if (!reading) continue;
      slot.reading = reading;
      slot.seenAt = t;
      slot.grip.update(reading.fingers, t);
    }
    // Grip changes are read once both hands have this frame's, so a flick
    // never sees the other hand a frame out of date.
    for (const side of ["left", "right"] as const) {
      if (seen[side]) this.gripChanged(side, before[side], t);
    }
    if (seen.left || seen.right) this.lastAnySeen = t;
    const both = seen.left !== null && seen.right !== null;
    if (both) {
      this.lastBothSeen = t;
      this.turn(seen.left!, seen.right!, t);
    } else {
      this.hopTrail.length = 0;
      this.restartAutoLevel();
    }
    this.settle(t);
    if (both) this.hop(seen.left!, seen.right!, t);
  }

  /**
   * The input for the tick at `now` (ms), and what the camera sees, for the
   * screens. Cheap enough to call every tick and every animation frame.
   */
  sample(now: number): WheelOutput {
    const t = this.advance(now);
    this.settle(t);
    return { status: this.statusAt(t), input: this.inputAt(t) };
  }

  /** Forgets the hands and the filter (the level and the item count stay). */
  reset(): void {
    this.slots.left = newSlot();
    this.slots.right = newSlot();
    this.filter.reset();
    this.haveAngle = false;
    this.angle = 0;
    this.lastAnySeen = -Infinity;
    this.lastBothSeen = -Infinity;
    this.fade = 0;
    this.braking = false;
    this.drifting = false;
    this.straightSince = null;
    this.hopTrail.length = 0;
    this.restartAutoLevel();
  }

  // ─── The level ────────────────────────────────────────────────────────────

  /** Takes the wheel as it is now for level. False when both hands are not in view to hold it. */
  setLevel(): boolean {
    if (!this.haveAngle || !this.bothPresent(this.time)) return false;
    this.level = this.angle;
    return true;
  }

  /** The level offset, degrees: the camera's tilt and the way this player holds the wheel (to keep between visits). */
  get level(): number {
    return this.levelDegrees;
  }

  set level(degrees: number) {
    this.levelDegrees = degrees;
    this.isLevelled = true;
  }

  get levelled(): boolean {
    return this.isLevelled;
  }

  /** Forgets the level: the camera's own horizon again. */
  resetLevel(): void {
    this.levelDegrees = 0;
    this.isLevelled = false;
    this.progress = 0;
  }

  /**
   * Starts watching for the player holding the wheel level and still: after
   * WHEEL.level.hold seconds of it the level is set and `done` called.
   * `levelProgress` says how far along it is, for the wheel check's ring.
   */
  startAutoLevel(done?: () => void): void {
    this.auto = { samples: [], done };
    this.progress = 0;
  }

  cancelAutoLevel(): void {
    this.auto = null;
    this.progress = this.isLevelled ? 1 : 0;
  }

  /** 0..1 of the way to the level being set by itself; 1 once it has been. */
  get levelProgress(): number {
    return this.progress;
  }

  // ─── Debugging ────────────────────────────────────────────────────────────

  /** Fingers out on each hand last seen (0..4), null for a hand not in view: for tuning the fist/open line with real hands. */
  get fingers(): { left: number | null; right: number | null } {
    const at = this.time;
    return {
      left: this.slotPresent("left", at) ? this.slots.left.reading!.fingers : null,
      right: this.slotPresent("right", at) ? this.slots.right.reading!.fingers : null,
    };
  }

  // ─── Inside ───────────────────────────────────────────────────────────────

  private advance(ms: number): number {
    this.time = Math.max(this.time, ms / 1000);
    return this.time;
  }

  /** The hands of a frame that count: in this player's half, at most two. */
  private candidates(frame: HandFrame): HandReading[] {
    const readings: HandReading[] = [];
    for (const hand of frame.hands) {
      const reading = readHand(hand, this.aspect);
      if (this.half === "left" && reading.x >= 0.5) continue;
      if (this.half === "right" && reading.x < 0.5) continue;
      readings.push(reading);
      if (readings.length === 2) break;
    }
    return readings;
  }

  private distance(slot: Slot, hand: HandReading): number {
    const known = slot.reading!;
    return Math.hypot((hand.x - known.x) * this.aspect, hand.y - known.y);
  }

  /**
   * Which hand is the left and which the right. Told apart by side when they
   * first appear, then kept by continuity: each frame's pairing is the one
   * that moves the hands least from where they were, so a wheel turned past
   * 90° (the left hand now level with, or past, the right) does not swap them.
   */
  private assign(hands: HandReading[], t: number): Record<Side, HandReading | null> {
    const none = { left: null, right: null };
    const left = this.slots.left;
    const right = this.slots.right;
    const knowsLeft = t - left.seenAt <= WHEEL.forget;
    const knowsRight = t - right.seenAt <= WHEEL.forget;
    const [a, b] = hands;
    if (!a) return none;
    if (b) {
      const [west, east]: [HandReading, HandReading] = a.x <= b.x ? [a, b] : [b, a];
      const bySide = { left: west, right: east };
      const crossed = { left: east, right: west };
      if (knowsLeft && knowsRight) {
        return this.distance(left, east) + this.distance(right, west) < this.distance(left, west) + this.distance(right, east) ? crossed : bySide;
      }
      if (knowsLeft) return this.distance(left, east) < this.distance(left, west) ? crossed : bySide;
      if (knowsRight) return this.distance(right, west) < this.distance(right, east) ? crossed : bySide;
      return bySide;
    }
    if (knowsLeft && knowsRight) return this.distance(left, a) <= this.distance(right, a) ? { left: a, right: null } : { left: null, right: a };
    // With one hand known and the other not, a hand near the known one is it; a far one is the other.
    if (knowsLeft) return this.distance(left, a) < NEAR ? { left: a, right: null } : { left: null, right: a };
    if (knowsRight) return this.distance(right, a) < NEAR ? { left: null, right: a } : { left: a, right: null };
    const middle = this.half === "left" ? 0.25 : this.half === "right" ? 0.75 : 0.5;
    return a.x < middle ? { left: a, right: null } : { left: null, right: a };
  }

  /** Counts a hand's change between fist and open towards an item flick. */
  private gripChanged(side: Side, before: "fist" | "open" | null, t: number): void {
    const slot = this.slots[side];
    const other = this.slots[side === "left" ? "right" : "left"];
    const state = slot.grip.state;
    if (state === before) return;
    const otherFist = this.slotHeld(other, t) && other.grip.state === "fist";
    if (state === "open") {
      const first = before === null;
      // The other hand opening within a quarter second of this one, or already
      // open, makes a brake of it: neither hand's flick is an item.
      const together = slot.grip.since - other.openedAt < WHEEL.together;
      slot.openedAt = slot.grip.since;
      slot.flickOk = !first && otherFist && !together;
      if (other.grip.state === "open") other.flickOk = false;
    } else if (state === "fist") {
      if (slot.flickOk && otherFist && slot.grip.since - slot.openedAt <= WHEEL.flick) this.presses++;
      slot.flickOk = false;
    }
  }

  /** Turns the two palms into the wheel's angle (and feeds the level helper). */
  private turn(left: HandReading, right: HandReading, t: number): void {
    let degrees = (Math.atan2(right.y - left.y, (right.x - left.x) * this.aspect) * 180) / Math.PI;
    // Keep to the branch the wheel was on, so turning through 180° carries on rather than jumping.
    if (this.haveAngle) degrees += 360 * Math.round((this.angle - degrees) / 360);
    this.angle = this.filter.filter(degrees, t);
    this.haveAngle = true;
    if (this.auto) this.watchLevel(t);
  }

  private watchLevel(t: number): void {
    const auto = this.auto!;
    auto.samples.push({ t, a: this.angle });
    // Keep only the newest stretch over which the angle stayed within the steady band.
    let low = Infinity;
    let high = -Infinity;
    let start = auto.samples.length - 1;
    for (; start >= 0; start--) {
      const a = auto.samples[start]!.a;
      low = Math.min(low, a);
      high = Math.max(high, a);
      if (high - low > WHEEL.level.steady) break;
    }
    auto.samples.splice(0, start + 1);
    if (!auto.samples.length) return this.restartAutoLevel();
    const mean = auto.samples.reduce((sum, s) => sum + s.a, 0) / auto.samples.length;
    if (Math.abs(mean) > WHEEL.level.tilt) {
      this.progress = 0;
      return;
    }
    this.progress = Math.min(1, (t - auto.samples[0]!.t) / WHEEL.level.hold);
    if (this.progress >= 1) {
      const done = auto.done;
      this.auto = null;
      this.level = mean;
      done?.();
    }
  }

  private restartAutoLevel(): void {
    if (!this.auto) return;
    this.auto.samples.length = 0;
    this.progress = 0;
  }

  /**
   * Looks for the hop: the wheel's centre rising faster than WHEEL.hop.speed
   * hand-spans a second by at least WHEEL.hop.rise spans, within a short
   * look back. Needs both hands, and no brake: open hands are not a wheel to lift.
   */
  private hop(left: HandReading, right: HandReading, t: number): void {
    const centre = (left.y + right.y) / 2;
    const span = Math.hypot((right.x - left.x) * this.aspect, right.y - left.y);
    this.hopTrail.push({ t, y: centre });
    while (this.hopTrail.length > 1 && t - this.hopTrail[0]!.t > WHEEL.hop.window) this.hopTrail.shift();
    if (this.braking || t < this.hopAllowedAt || !(span > 0.02)) return;
    for (const earlier of this.hopTrail) {
      const seconds = t - earlier.t;
      if (seconds <= 0) continue;
      const rise = (earlier.y - centre) / span; // up the picture is down in y
      if (rise >= WHEEL.hop.rise && rise / seconds >= WHEEL.hop.speed) {
        this.drifting = true;
        this.straightSince = null;
        this.hopAllowedAt = t + WHEEL.hop.cooldown;
        this.hopTrail.length = 0;
        return;
      }
    }
  }

  private slotPresent(side: Side, t: number): boolean {
    return this.slots[side].reading !== null && t - this.slots[side].seenAt <= WHEEL.present;
  }

  private bothPresent(t: number): boolean {
    return this.slotPresent("left", t) && this.slotPresent("right", t);
  }

  /** Is the hand in the picture, or gone so briefly that its grip still counts? */
  private slotHeld(slot: Slot, t: number): boolean {
    return slot.grip.state !== null && t - slot.seenAt <= WHEEL.held;
  }

  /** Everything that moves with time alone, not only with a new frame: the brake, the easing, the drift's end. */
  private settle(t: number): void {
    const left = this.slots.left;
    const right = this.slots.right;
    this.braking =
      this.slotHeld(left, t) &&
      this.slotHeld(right, t) &&
      left.grip.state === "open" &&
      right.grip.state === "open" &&
      t - Math.max(left.grip.since, right.grip.since) >= WHEEL.brakeAfter;

    // The steer's fade: 1 while the hands are there, easing to 0 as they go.
    const sinceBoth = t - this.lastBothSeen;
    const sinceAny = t - this.lastAnySeen;
    const one = 1 - smooth((sinceBoth - WHEEL.oneHand.hold) / WHEEL.oneHand.ease);
    const none = 1 - smooth((sinceAny - WHEEL.noHands.hold) / WHEEL.noHands.ease);
    const target = Math.min(one, none);
    const elapsed = Number.isFinite(this.lastSettle) ? Math.max(0, t - this.lastSettle) : 0;
    this.fade = target < this.fade ? target : Math.min(target, this.fade + elapsed / WHEEL.recover);
    this.lastSettle = t;

    if (this.drifting) {
      if (this.braking) {
        this.drifting = false;
        this.straightSince = null;
      } else if (Math.abs(shapeSteer(this.angleAt(), this.steering)) < WHEEL.drift.straight) {
        this.straightSince ??= t;
        if (t - this.straightSince >= WHEEL.drift.hold) {
          this.drifting = false;
          this.straightSince = null;
        }
      } else {
        this.straightSince = null;
      }
    }
  }

  /** The wheel's turn, degrees from level, as the kart should see it (smoothed, eased out when hands are gone). */
  private angleAt(): number {
    return wrap(this.angle - this.levelDegrees) * this.fade;
  }

  private modeAt(t: number): WheelStatus["mode"] {
    if (t - this.lastAnySeen > WHEEL.noHands.mode) return "lost";
    return this.braking ? "brake" : "drive";
  }

  private handOf(side: Side, t: number): WheelHand | null {
    const slot = this.slots[side];
    if (!this.slotPresent(side, t)) return null;
    const reading = slot.reading!;
    return { x: reading.x, y: reading.y, size: reading.size, open: slot.grip.state === "open" };
  }

  private statusAt(t: number): WheelStatus {
    const left = this.handOf("left", t);
    const right = this.handOf("right", t);
    const hands = (left ? 1 : 0) + (right ? 1 : 0);
    let grip: WheelStatus["grip"] = "none";
    if (left && right) grip = left.open && right.open ? "open" : left.open || right.open ? "one-open" : "fists";
    return {
      hands: hands as WheelStatus["hands"],
      left,
      right,
      angle: this.angleAt(),
      steer: shapeSteer(this.angleAt(), this.steering),
      grip,
      mode: this.modeAt(t),
      levelled: this.isLevelled,
    };
  }

  private inputAt(t: number): DriveInput {
    const mode = this.modeAt(t);
    // Fists drive by themselves; open hands brake; with the hands gone the kart
    // coasts on for half a second (a dropped frame must not stop it) and then lifts.
    const throttle = mode === "drive" ? 1 : mode === "lost" && t - this.lastAnySeen <= WHEEL.noHands.throttle ? 1 : 0;
    return {
      steer: shapeSteer(this.angleAt(), this.steering),
      throttle,
      brake: mode === "brake" ? 1 : 0,
      drift: this.drifting,
      itemPresses: this.presses,
    };
  }
}
