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
 *     straightening the wheel (or turning it hard the other way); a wheel held
 *     near full lock for a moment starts one too
 *   - the wheel shaken left and right: a shake (a trick in the air)
 *   - hands out of the picture: hold the angle a moment, then ease to the centre
 *   - a clap (a horn), both open hands raised high (a cheer) and one open hand
 *     waving (a wave) are gestures.ts's
 *
 * Times are seconds inside, milliseconds at the doors (a frame's capturedAt,
 * sample's `now`), as the rest of the tracker's clock is.
 */
import { OneEuroFilter } from "../../input/filter";
import type { DriveInput, WheelHand, WheelStatus } from "../contract";
import type { HandFrame } from "../../tracking/types";
import { Gestures, type GestureHand } from "./gestures";
import { Grip, readHand, type HandReading } from "./hands";
import { ShakeCounter } from "./shake";

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
    /**
     * The wheel's centre must rise faster than this many wheel widths (the
     * distance between the palms) a second, so a wheel held small and far
     * from the camera hops as readily as one held close...
     */
    speed: 1.6,
    /** ...by at least this many wheel widths. */
    rise: 0.25,
    /** Looking back this far for the start of the rise, seconds. */
    window: 0.3,
    /** No second hop for this long after one, seconds. */
    cooldown: 0.5,
    /**
     * A hop while the drift is still held lets go of it this long first, so
     * the kart sees a fresh lift (three ticks: a dropped input or two cannot
     * hide it), seconds.
     */
    release: 0.05,
  },
  drift: {
    /** The drift ends when |steer| has stayed below this... */
    straight: 0.15,
    /** ...for this long, seconds. */
    hold: 0.2,
    /**
     * A wheel held this near full lock (|steer|)... (the sim starts the drift
     * only at speed, so a slow hairpin is only a turn)
     */
    lock: 0.85,
    /** ...for this long starts a drift by itself, as a hop would, seconds. */
    lockHold: 0.22,
    /** Turned the other way past this (|steer|)... */
    against: 0.5,
    /** ...for this long, the drift is let go (and its boost given): an S-bend is not one long slide, seconds. */
    againstHold: 0.1,
  },
  /** A shake: the wheel's angle swinging back this many degrees the other way counts as a reversal (shake.ts has the rest). */
  shake: { swing: 14 },
  /** One hand gone: hold the angle this long, then ease to the centre over `ease`, seconds. */
  oneHand: { hold: 0.4, ease: 0.6 },
  /** Both gone: steer eases to the centre after `hold` over `ease`; throttle stops after `throttle`; mode says lost after `mode`. */
  noHands: { hold: 0.25, ease: 0.5, throttle: 0.5, mode: 0.3 },
  /** A hand seen this recently still counts as in the picture (a dropped frame or two), seconds. */
  present: 0.2,
  /** A hand missing this long keeps its grip as it was, for the brake and the item flick, seconds. */
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
  /**
   * A wheel turned steeper than this many degrees is past where the line
   * through the palms can say on its own which way the wheel went (at 90° it
   * points straight up either way), so from here the wheel's last angle decides.
   */
  steep: 60,
} as const;

/**
 * The wheel's turn, degrees, from the two palms: + when the right hand is
 * lower. The wheel is read as a LINE through the palms, not an arrow from
 * one to the other: which hand is which can be mistaken (the hands cross, or
 * one is lost and found again), and an arrow would then point the other way
 * and turn the steering inside out. A line is the same whichever end is
 * which, so a swap changes nothing. Its angle is in (-90°, 90°]. Only once
 * the wheel was already turned past `WHEEL.steep` (60°), where the line alone
 * could be either way round, does its `previous` angle decide which, so the
 * wheel carries on round the way it was going.
 */
export function wheelAngle(left: { x: number; y: number }, right: { x: number; y: number }, aspect: number, previous: number | null): number {
  let dx = (right.x - left.x) * aspect;
  let dy = right.y - left.y;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  let degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (previous !== null && Math.abs(previous) > WHEEL.steep) degrees += 180 * Math.round((previous - degrees) / 180);
  return degrees;
}

/** Steer, -1..1, for a wheel turned `angle` degrees from level. */
export function shapeSteer(angle: number, steering: Steering | number = "normal"): number {
  const lock = typeof steering === "number" ? steering : STEERING_LOCK[steering];
  const size = Math.abs(angle);
  if (!(size > WHEEL.deadZone)) return 0;
  const fraction = Math.min(1, (size - WHEEL.deadZone) / (lock - WHEEL.deadZone));
  return Math.sign(angle) * Math.pow(fraction, WHEEL.curve);
}

/**
 * One player's column of the picture when several share a camera: seat
 * `index` (0 is the leftmost, as the player sees the mirrored picture) of
 * `of` equal vertical columns.
 */
export interface Seat {
  index: number;
  of: number;
}

/** A column's edges across the mirrored picture, 0..1. */
export function seatZone(seat: Seat): readonly [number, number] {
  return [seat.index / seat.of, (seat.index + 1) / seat.of];
}

/**
 * Whether a frame looked at this seat's column: a frame that read only other players' columns (each read in a worker
 * of its own, HandFrame.read) brings this player no news, not a picture without their hands.
 */
export function readsSeat(frame: HandFrame, seat: Seat | null): boolean {
  if (!frame.read || !seat) return true;
  const [from, to] = seatZone(seat);
  // The column's middle in the camera's own picture (the zones are in the mirrored one).
  const middle = 1 - (from + to) / 2;
  return frame.read.some(([a, b]) => a <= middle && middle <= b);
}

/** The seat a half is: the left or the right of two. */
export function halfSeat(half: "left" | "right"): Seat {
  return { index: half === "left" ? 0 : 1, of: 2 };
}

/** The seat the options name (a `seat`, else a `half`), or null for the whole picture. */
export function seatOf(options: { seat?: Seat | null; half?: "left" | "right" | null }): Seat | null {
  if (options.seat && options.seat.of > 1) {
    const of = Math.round(options.seat.of);
    return { index: Math.max(0, Math.min(of - 1, Math.round(options.seat.index))), of };
  }
  return options.half ? halfSeat(options.half) : null;
}

export interface WheelOptions {
  steering?: Steering;
  /**
   * Several players on one camera (up to four): only hands whose (mirrored)
   * palm is in this player's column of the picture count.
   */
  seat?: Seat | null;
  /** Two players on one camera, said as a side: a shorthand for `seat` 0 or 1 of 2. */
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

/** How far a hand may have moved to still be the one seen a moment ago: this much (picture heights), and this much more per second. */
const FOLLOW = { base: 0.08, speed: 0.6 } as const;

/**
 * Between neighbouring columns, a band this wide (picture widths) either side
 * of the line belongs to whoever already had the hand: a fist that strays
 * over the line stays its player's, and a stranger's hand has to be properly
 * inside a column to be taken for theirs.
 */
export const SEAT_MARGIN = 0.02;

const newSlot = (): Slot => ({ grip: new Grip(), reading: null, seenAt: -Infinity, openedAt: -Infinity, flickOk: false });

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** An angle in degrees brought into -180..180. */
const wrap = (degrees: number): number => degrees - 360 * Math.round(degrees / 360);

export class WheelReader {
  steering: Steering;
  /** This player's column of a shared camera, or null for the whole picture. */
  seat: Seat | null;
  /** The picture's width over its height. Set it from the camera (width / height) once it is open. */
  aspect: number;

  private readonly slots: Record<Side, Slot> = { left: newSlot(), right: newSlot() };
  private readonly filter = new OneEuroFilter(WHEEL.smoothing.minCutoff, WHEEL.smoothing.beta);
  private readonly gestures = new Gestures();
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
  /** The way the drift goes, as far as the wheel can tell: the side it was turned to when it began (0: not yet). */
  private driftSide = 0;
  private straightSince: number | null = null;
  private lockSince: number | null = null;
  private againstSince: number | null = null;
  private readonly shaker = new ShakeCounter(WHEEL.shake.swing);
  private presses = 0;
  private hopTrail: { t: number; y: number }[] = [];
  private hopAllowedAt = -Infinity;
  /** Until then the drift reads as let go, for a hop that came while it was already held. */
  private releaseUntil = -Infinity;
  private auto: { samples: { t: number; a: number }[]; done: (() => void) | undefined } | null = null;
  private progress = 0;

  constructor(options: WheelOptions = {}) {
    this.steering = options.steering ?? "normal";
    this.seat = seatOf(options);
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
    if (!readsSeat(frame, this.seat)) return;
    const t = this.advance(at);
    const seen = this.assign(this.candidates(frame, t), t);
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
      // Back after a while without both hands: the wheel is read afresh, not carried on from where it was.
      const fresh = t - this.lastBothSeen > WHEEL.held;
      this.lastBothSeen = t;
      this.turn(seen.left!, seen.right!, t, fresh);
      // Palms pressed together or raised high swing the line between them every which way: no shake in that.
      if (fresh || this.gestures.stands(t) || this.braking) this.shaker.reset();
      else this.shaker.push(t, this.angle);
    } else {
      this.shaker.reset();
      // The hop trail is kept: a sharp lift blurs the hands and often costs a frame
      // or two, which must not hide the very jerk being looked for. Its own
      // time window lets old points go.
      this.restartAutoLevel();
    }
    this.settle(t);
    this.gestures.frame(t, this.aspect, this.gestureHand("left", t), this.gestureHand("right", t), shapeSteer(this.angleAt(), this.steering), this.braking);
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

  // ─── The level ────────────────────────────────────────────────────────────

  /**
   * Takes the wheel as it is now for level. False when both hands are not in
   * view to hold it, or when the wheel is turned too far to be level (past
   * WHEEL.level.tilt): then the level it had is forgotten too.
   */
  setLevel(): boolean {
    if (!this.haveAngle || !this.bothPresent(this.time)) return false;
    this.level = this.angle;
    return this.isLevelled;
  }

  /** The level offset, degrees: the camera's tilt and the way this player holds the wheel (to keep between visits). */
  get level(): number {
    return this.levelDegrees;
  }

  set level(degrees: number) {
    // A level is a small tilt (the camera's, the player's habit). Anything
    // more - a level taken with the wheel held turned, say - would turn every
    // straight into a bend: it is not taken.
    if (!Number.isFinite(degrees) || Math.abs(degrees) > WHEEL.level.tilt) {
      this.levelDegrees = 0;
      this.isLevelled = false;
      return;
    }
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

  /** This player's half of a camera shared by two ("left" or "right"), else null. */
  get half(): "left" | "right" | null {
    return this.seat?.of === 2 ? (this.seat.index === 0 ? "left" : "right") : null;
  }

  /**
   * The hands of a frame that count: those in this player's column, at most
   * two. A hand this wheel already holds keeps counting a little way over the
   * line to a neighbour's column; a hand it does not hold must be inside by
   * the margin. When there are more than two, the hands it holds come first,
   * then those nearest the column's middle.
   */
  private candidates(frame: HandFrame, t: number): HandReading[] {
    const found: { reading: HandReading; follows: number | null }[] = [];
    const seat = this.seat;
    const zone = seat ? seatZone(seat) : null;
    for (const hand of frame.hands) {
      const reading = readHand(hand, this.aspect);
      const follows = zone !== null ? this.follows(reading, t) : null;
      if (seat && zone) {
        const grow = follows !== null ? SEAT_MARGIN : -SEAT_MARGIN;
        if (seat.index > 0 && reading.x < zone[0] - grow) continue;
        if (seat.index < seat.of - 1 && reading.x >= zone[1] + grow) continue;
      }
      found.push({ reading, follows });
    }
    if (found.length > 2 && zone) {
      const middle = (zone[0] + zone[1]) / 2;
      found.sort((a, b) => {
        if (a.follows !== null && b.follows !== null) return a.follows - b.follows;
        if (a.follows !== null || b.follows !== null) return a.follows !== null ? -1 : 1;
        return Math.abs(a.reading.x - middle) - Math.abs(b.reading.x - middle);
      });
    }
    return found.slice(0, 2).map((one) => one.reading);
  }

  /**
   * How far this hand is from where this wheel last had one, if it can be
   * that hand moved on (a hand covers only so much in the time that has
   * passed); null for a hand that is not a continuation of either.
   */
  private follows(reading: HandReading, t: number): number | null {
    let nearest: number | null = null;
    for (const side of ["left", "right"] as const) {
      const slot = this.slots[side];
      if (!slot.reading || t - slot.seenAt > WHEEL.held) continue;
      const far = this.distance(slot, reading);
      if (far < Math.min(NEAR, FOLLOW.base + FOLLOW.speed * (t - slot.seenAt)) && (nearest === null || far < nearest)) nearest = far;
    }
    return nearest;
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
    const zone = this.seat ? seatZone(this.seat) : ([0, 1] as const);
    const middle = (zone[0] + zone[1]) / 2;
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
      // Open hands that clapped, or are raised in a cheer, are no flick.
      if (slot.flickOk && otherFist && slot.grip.since - slot.openedAt <= WHEEL.flick && !this.gestures.stands(t)) this.presses++;
      slot.flickOk = false;
    }
  }

  /** Turns the two palms into the wheel's angle (and feeds the level helper). */
  private turn(left: HandReading, right: HandReading, t: number, fresh: boolean): void {
    if (fresh) this.filter.reset();
    const degrees = wheelAngle(left, right, this.aspect, this.haveAngle && !fresh ? this.angle : null);
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
   * wheel widths (the distance between the palms) a second by at least
   * WHEEL.hop.rise widths, within a short look back. Needs both hands, and no brake: open hands are not a wheel to lift.
   */
  private hop(left: HandReading, right: HandReading, t: number): void {
    const centre = (left.y + right.y) / 2;
    const span = Math.hypot((right.x - left.x) * this.aspect, right.y - left.y);
    this.hopTrail.push({ t, y: centre });
    while (this.hopTrail.length > 1 && t - this.hopTrail[0]!.t > WHEEL.hop.window) this.hopTrail.shift();
    if (this.braking || this.gestures.stands(t) || t < this.hopAllowedAt || !(span > 0.02)) return;
    for (const earlier of this.hopTrail) {
      const seconds = t - earlier.t;
      if (seconds <= 0) continue;
      const rise = (earlier.y - centre) / span; // up the picture is down in y
      if (rise >= WHEEL.hop.rise && rise / seconds >= WHEEL.hop.speed) {
        // The kart hops on the drift being pressed, not on it being held. Still held from an
        // earlier hop (one that was only a hop, or a drift a spin-out ended, the wheel never
        // straightened since), this lift would be lost: let go a moment, and press again.
        if (this.drifting) this.releaseUntil = t + WHEEL.hop.release;
        this.startDrift(shapeSteer(this.angleAt(), this.steering));
        this.hopAllowedAt = t + WHEEL.hop.cooldown;
        this.hopTrail.length = 0;
        return;
      }
    }
  }

  /** A hand as the gestures see it, or null when it is not in the picture. */
  private gestureHand(side: Side, t: number): GestureHand | null {
    if (!this.slotPresent(side, t)) return null;
    const slot = this.slots[side];
    const reading = slot.reading!;
    return { x: reading.x, y: reading.y, size: reading.size, grip: slot.grip.state };
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
      t - Math.max(left.grip.since, right.grip.since) >= WHEEL.brakeAfter &&
      // Palms pressed together or raised high are a clap or a cheer, not a brake.
      !this.gestures.stands(t);

    // The steer's fade: 1 while the hands are there, easing to 0 as they go.
    const sinceBoth = t - this.lastBothSeen;
    const sinceAny = t - this.lastAnySeen;
    const one = 1 - smooth((sinceBoth - WHEEL.oneHand.hold) / WHEEL.oneHand.ease);
    const none = 1 - smooth((sinceAny - WHEEL.noHands.hold) / WHEEL.noHands.ease);
    const target = Math.min(one, none);
    const elapsed = Number.isFinite(this.lastSettle) ? Math.max(0, t - this.lastSettle) : 0;
    this.fade = target < this.fade ? target : Math.min(target, this.fade + elapsed / WHEEL.recover);
    this.lastSettle = t;

    const steer = shapeSteer(this.angleAt(), this.steering);
    if (this.drifting) {
      if (this.driftSide === 0 && Math.abs(steer) > WHEEL.drift.straight * 2) this.driftSide = Math.sign(steer);
      const against = this.driftSide !== 0 && steer * this.driftSide <= -WHEEL.drift.against;
      this.againstSince = against ? (this.againstSince ?? t) : null;
      if (this.braking) {
        this.endDrift();
      } else if (this.againstSince !== null && t - this.againstSince >= WHEEL.drift.againstHold) {
        // Turned hard the other way: let go, so the kart can follow the wheel into the next bend.
        this.endDrift();
      } else if (Math.abs(steer) < WHEEL.drift.straight) {
        this.straightSince ??= t;
        if (t - this.straightSince >= WHEEL.drift.hold) this.endDrift();
      } else {
        this.straightSince = null;
      }
    } else {
      // Held near full lock with the hands on the wheel: a drift begins by itself, as if the wheel had been lifted.
      const holding = this.modeAt(t) === "drive" && this.bothPresent(t) && Math.abs(steer) >= WHEEL.drift.lock;
      this.lockSince = holding ? (this.lockSince ?? t) : null;
      if (this.lockSince !== null && t - this.lockSince >= WHEEL.drift.lockHold) this.startDrift(steer);
    }
  }

  private startDrift(steer: number): void {
    this.drifting = true;
    this.driftSide = Math.abs(steer) > WHEEL.drift.straight * 2 ? Math.sign(steer) : 0;
    this.straightSince = null;
    this.lockSince = null;
    this.againstSince = null;
  }

  private endDrift(): void {
    this.drifting = false;
    this.driftSide = 0;
    this.straightSince = null;
    this.againstSince = null;
    this.lockSince = null;
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
      drift: this.drifting && t >= this.releaseUntil,
      itemPresses: this.presses,
      horn: this.gestures.horns,
      shakes: this.shaker.count,
      emote: this.gestures.emoteAt(t),
    };
  }
}
