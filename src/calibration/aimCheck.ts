/**
 * The aim check that begins every game (docs/WEB_ARCHITECTURE.md, "The aim
 * check"): a few shots at the game's own targets that learn how the player's
 * fingertip in the camera maps onto the screen, then measure honestly how well
 * that map predicts where they aim - and end on their own at 95%.
 *
 * This is the logic alone, fed one observation per camera frame; the screen
 * around it lives in src/app.
 *
 * While the aim is being learned the player points at the lit target, and
 * every shot is taken there: the words and the progress say that, and the
 * page shows no crosshair until the aim is set (see AimCheckView), so there is
 * nothing to steer onto a target.
 */
import type { CalibrationTarget, TargetNoun } from "../engine/types";
import { AimController } from "../input/aim";
import type { Point } from "../input/filter";
import { apply, fitAffine, fitScaled, gain, type Matrix } from "../input/homography";
import { AIM_RADIUS, MIN_ERRORS, READY_SCORE, measure, type Measure, type Vector } from "./score";
import { GAIN_LIMIT } from "./storage";

/** Only this many of the latest shots are fitted: the hand drifts, and the
 * newest shots say most about where it is now. */
export const FIT_POOL = 10;
/** After this many shots without reaching 95%, the player may play anyway. */
export const PLAY_ANYWAY_AFTER = 12;
/** Thumb-up samples older than this before the fold are not the aim. */
const AIM_MEMORY = 0.25;
/** A fold under this is still aiming; past it the hand starts to move with the shot. */
const STILL_AIMING = 0.35;
/** Two shots closer together than this are one shot seen twice. */
const MIN_SHOT_GAP = 0.45;
/** A camera silent for longer than this has lost the thread of the aim. */
const STALE = 0.35;
/** The shots a first check needs before any can be measured: two that fit scale and offset, one that fits the whole map. */
const LEARNING_SHOTS = 3;
/** The ring stops short of full until the check is done: how far the shots and the aim's quality can take it. */
const PROGRESS_CAP = 0.94;
/** What a stage's targets are called when it does not say. */
export const TARGET_NOUN: TargetNoun = { one: "target", many: "targets" };

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const NUMBERS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const number = (n: number) => NUMBERS[n] ?? String(n);

/** One camera frame, as the aim check needs it. */
export interface Observation {
  /** The fingertip in the mirrored camera image, or null when no hand is seen. */
  pointer: Point | null;
  armed: boolean;
  /** The thumb's fold, 0 up to 1 folded. */
  travel: number;
  fired: boolean;
  /** The hand's size in the picture (palm span), for the distance tip. */
  span?: number;
}

export type ShotOutcome = "hit" | "miss" | "refused" | "unaimed";

export interface ShotEvent {
  target: CalibrationTarget;
  outcome: ShotOutcome;
  /** Where the map in force says the shot went, in viewport fractions. */
  landed: [number, number] | null;
  /** How far from the target's centre, in fractions of the smaller side. */
  error: number | null;
}

export interface Words {
  title: string;
  detail: string;
}

interface Sample {
  pointer: Point;
  target: [number, number];
  id: string;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Everything the check knows about how the shots went, for the one tip it
 * offers when the aim will not settle. */
export interface CheckStats {
  frames: number;
  framesWithoutHand: number;
  spans: number[];
  /** How many shots were taken with the fingertip near the edge of the picture. */
  edgeShots: number;
  /** How many shots were refused, the fingertip not having moved enough to learn from. */
  refused?: number;
  /** How many shots came with no aim seen before the fold ("Raise Your Thumb First"). */
  unaimed?: number;
}

/** A palm span under this, in fractions of the picture, is a hand too far from the camera to read well. */
export const FAR_SPAN = 0.07;
/** A palm span over this is a hand too close to it. */
export const NEAR_SPAN = 0.34;
/** A fingertip this close to the picture's edge, in fractions of it, is about to leave it. */
export const EDGE = 0.06;

/**
 * One specific tip for a player whose aim will not reach 95% - light, framing
 * or distance - picked from what the camera actually saw, or steadiness when
 * nothing else stands out.
 */
export function tipFor(stats: CheckStats): string {
  if (stats.edgeShots >= 2) return "Keep your hand inside the camera’s view at every target.";
  if (stats.frames > 30 && stats.framesWithoutHand / stats.frames > 0.25) {
    return "More light on your hand helps. Face a lamp or a window.";
  }
  if (stats.spans.length >= 10) {
    const span = median(stats.spans);
    if (span < FAR_SPAN) return "Move a little closer to your camera.";
    if (span > NEAR_SPAN) return "Sit back a little from your camera.";
  }
  if ((stats.refused ?? 0) >= 2) return "Move your whole hand toward each one, not just your finger.";
  return "Keep your finger still as your thumb folds.";
}

/** What the camera says about the hand's framing right now: too far, too near, at the edge, or fine. */
export type Framing = "closer" | "back" | "edge" | null;

/** The framing of one camera frame, by the same lines as tipFor. Keeping the hand in the picture comes first. */
export function framingOf(pointer: Point | null, span: number | undefined): Framing {
  if (!pointer) return null;
  if (pointer[0] < EDGE || pointer[0] > 1 - EDGE || pointer[1] < EDGE || pointer[1] > 1 - EDGE) return "edge";
  if (span === undefined) return null;
  if (span < FAR_SPAN) return "closer";
  if (span > NEAR_SPAN) return "back";
  return null;
}

/**
 * Framing help that does not flicker: a problem is shown once it has lasted
 * `show` ms, and goes once it has been gone for `hide` ms, so a hand resting
 * on a line neither blinks the words nor keeps them from ever appearing. A
 * frame the tracker dropped says nothing either way (a far hand drops more
 * of them); a hand gone for longer starts afresh.
 */
export class FramingHelp {
  private shown: Framing = null;
  private candidate: Framing = null;
  private since = 0;
  private clearSince: number | null = null;
  private lastSeen = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly show = 1000,
    private readonly hide = 500,
  ) {}

  /** One camera frame at `now` ms (`pointer` null without a hand); returns the help to show. */
  update(pointer: Point | null, span: number | undefined, now: number): Framing {
    if (!pointer) {
      if (now - this.lastSeen > this.hide) this.reset();
      return this.shown;
    }
    this.lastSeen = now;
    const seen = framingOf(pointer, span);
    if (seen !== this.candidate) {
      this.candidate = seen;
      this.since = now;
    }
    if (seen && seen !== this.shown && now - this.since >= this.show) {
      this.shown = seen;
      this.clearSince = null;
    } else if (this.shown && seen !== this.shown) {
      this.clearSince ??= now;
      if (now - this.clearSince >= this.hide) {
        this.shown = null;
        this.clearSince = null;
      }
    } else if (seen === this.shown) {
      this.clearSince = null;
    }
    return this.shown;
  }

  /** The hand is gone: whatever it was doing, it is not doing it now. */
  reset(): void {
    this.shown = null;
    this.candidate = null;
    this.clearSince = null;
  }
}

export interface AimCheckOptions {
  /** The aim saved for this camera, if it passed its checks. */
  saved: Matrix | null;
  targets: CalibrationTarget[];
  viewport: { width: number; height: number };
  /** What the game's targets are: its bottles, jars, lights or plates, for the words. */
  noun?: TargetNoun;
}

export class AimCheck {
  /** The map in force: null until two shots have been learned (without a saved aim). */
  mapping: Matrix | null;
  /** Counts changes to `mapping`, so the input can be told to follow. */
  mappingVersion = 0;
  /** The kind of map in force, for tests and the debug overlay. */
  fit: "saved" | "none" | "scaled" | "affine";
  readonly returning: boolean;
  /** Every predictive error, in fractions of the smaller viewport side. */
  readonly errors: Vector[] = [];
  measure: Measure = measure([]);
  shots = 0;
  done = false;
  canPlayAnyway = false;
  tip: string | null = null;
  words: Words;
  lit: CalibrationTarget | null = null;
  /**
   * How far along the check is, 0..1, for the ring that fills while the aim
   * is learned. It climbs with every shot - the shots a check must take
   * (three to learn the aim and three to prove it; a returning player's
   * three) are most of it, how near the aim is to 95% the rest - and never
   * falls back, so the ring is calm. Only a finished check fills it.
   */
  progress = 0;
  readonly noun: TargetNoun;

  private targets: CalibrationTarget[] = [];
  private viewport: { width: number; height: number };
  private readonly pool: Sample[] = [];
  private readonly uses = new Map<string, number>();
  private plan: string[] = [];
  private history: { time: number; pointer: Point }[] = [];
  private lastShot = Number.NEGATIVE_INFINITY;
  private lastFrame = Number.NEGATIVE_INFINITY;
  /** When a hand was last seen, s. */
  private handAt = Number.NEGATIVE_INFINITY;
  private readonly stats: CheckStats = { frames: 0, framesWithoutHand: 0, spans: [], edgeShots: 0 };

  constructor({ saved, targets, viewport, noun }: AimCheckOptions) {
    this.noun = noun ?? TARGET_NOUN;
    this.mapping = saved;
    this.returning = saved !== null;
    this.fit = saved ? "saved" : "none";
    this.viewport = viewport;
    this.setTargets(targets);
    // Point your finger at the lit one: there is no crosshair to steer, and
    // the words say so.
    this.words = this.returning
      ? { title: "Welcome Back", detail: `Point at the lit ${this.noun.one} and fire. Three shots and you’re in.` }
      : { title: `Point at the Lit ${capital(this.noun.one)}`, detail: "Point your finger at it and fire. Handheld is learning where you point." };
  }

  /** The stage's targets as they sit in the view now (they move on resize). */
  setTargets(targets: CalibrationTarget[]): void {
    this.targets = targets;
    if (!this.plan.length) this.plan = this.openingOrder();
    if (!this.lit || !targets.some((t) => t.id === this.lit!.id)) this.lit = this.next();
    else this.lit = targets.find((t) => t.id === this.lit!.id)!;
    // A stage whose targets stay broken can run out before the check is
    // done: never leave the player with nothing to shoot and no way on.
    if (!targets.length && this.shots > 0 && !this.done && !this.canPlayAnyway) {
      this.canPlayAnyway = true;
      // An aim already scoring well only ran out of targets to prove it on:
      // say so, rather than give a tip it does not need.
      const good = (this.measure.score ?? 0) >= READY_SCORE;
      this.tip = good ? null : tipFor(this.stats);
      this.words = good
        ? { title: "Aim Looks Good", detail: "Play on, or Start Over to check again." }
        : { title: `That’s Every ${capital(this.noun.one)}`, detail: this.tip! };
    }
  }

  setViewport(width: number, height: number): void {
    this.viewport = { width, height };
  }

  /** One camera frame. Returns what happened if a shot was taken on it. */
  observe(o: Observation, time: number): ShotEvent | null {
    this.stats.frames++;
    if (!o.pointer) this.stats.framesWithoutHand++;
    else if (o.span !== undefined) this.stats.spans.push(o.span);
    // A hand lost for longer than the trigger bridges (AimController.GRACE), or a camera gone quiet, has nothing to
    // say about the aim. A frame or two dropped as the thumb folds is bridged here too, or the shot the trigger keeps
    // through them would arrive with no aim and be refused ("Raise Your Thumb First") from a player who did.
    if (o.pointer) this.handAt = time;
    if (time - this.handAt > AimController.GRACE || time - this.lastFrame > STALE) this.history = [];
    this.lastFrame = time;
    // Keep the last thumb-up aim, rather than the fingertip after firing. The
    // window rolls only while the thumb is up; once the fold begins it holds
    // still, however long the fold takes - so a fold that pauses part way
    // still has its aim - and raising the thumb again rolls it on, so an
    // abandoned fold leaves nothing behind.
    if (o.pointer && o.armed && o.travel < STILL_AIMING) {
      this.history = this.history.filter((sample) => time - sample.time <= AIM_MEMORY);
      this.history.push({ time, pointer: o.pointer });
    }
    if (!o.fired || this.done || time - this.lastShot < MIN_SHOT_GAP || !this.lit) return null;
    this.lastShot = time;
    const target = this.lit;
    if (!this.history.length) {
      this.stats.unaimed = (this.stats.unaimed ?? 0) + 1;
      this.words = { title: "Raise Your Thumb First", detail: "Point with it up, then fold it to fire." };
      this.uncounted();
      return { target, outcome: "unaimed", landed: null, error: null };
    }
    const pointer: Point = [median(this.history.map((s) => s.pointer[0])), median(this.history.map((s) => s.pointer[1]))];
    this.history = [];
    return this.shoot(pointer, target);
  }

  private shoot(pointer: Point, target: CalibrationTarget): ShotEvent {
    const { width, height } = this.viewport;
    const side = Math.min(width, height);
    // Measured before the shot teaches the map anything: an honest
    // prediction, not a fit to its own answer.
    const landed = this.mapping ? apply(this.mapping, pointer) : null;
    const error: Vector | null = landed
      ? [((landed[0] - target.x) * width) / side, ((landed[1] - target.y) * height) / side]
      : null;
    if (framingOf(pointer, undefined) === "edge") this.stats.edgeShots++;

    // Only a full map's predictions are scored. The two-shot map of scale and
    // offset is a first guess to learn from (it is never shown); it cannot
    // know how the camera is turned, so its misses would be the camera's, not
    // the player's, and would hold the score down for six more shots.
    const scored = error !== null && this.fit !== "scaled";
    const errors = scored ? [...this.errors, error] : this.errors;
    const measured = measure(errors);
    this.pool.push({ pointer, target: [target.x, target.y], id: target.id });
    const wasSaved = this.fit === "saved";
    // The shot that proves the aim does not also change it: the map that
    // earned the score is the one the game is played on.
    if (!measured.ready && !this.refit()) {
      // Two shots from the same spot cannot say which way the hand moves.
      this.pool.pop();
      this.stats.refused = (this.stats.refused ?? 0) + 1;
      this.words = { title: "Move Your Finger", detail: `That was the same spot as the last. Point at the lit ${this.noun.one}.` };
      this.uncounted();
      return { target, outcome: "refused", landed: null, error: null };
    }

    if (scored) this.errors.push(error);
    this.measure = measured;
    // A saved aim the camera has moved away from since (a laptop's lid
    // tilted, another game's stage) misses the same way on every shot: a
    // bias of R/2 or more, the camera's and not the player's, as the scaled
    // map's misses are. Once the shots have fitted an aim of their own, those
    // misses are not held against it: they kept a returning player to nine
    // shots, three more than a first check.
    if (wasSaved && this.fit !== "saved" && Math.hypot(...measured.bias) >= AIM_RADIUS / 2) {
      this.errors.length = 0;
      this.measure = measure(this.errors);
    }
    this.shots++;
    this.uses.set(target.id, (this.uses.get(target.id) ?? 0) + 1);
    const distance = error ? Math.hypot(error[0], error[1]) : null;
    const hit = distance === null || distance <= Math.max(target.radius, AIM_RADIUS / 2);
    this.done = this.measure.ready;
    this.progress = this.done ? 1 : Math.max(this.progress, this.progressNow());
    if (!this.done && this.shots >= PLAY_ANYWAY_AFTER) {
      this.canPlayAnyway = true;
      this.tip = tipFor(this.stats);
    }
    this.words = this.say();
    if (!this.done) this.lit = this.next();
    return { target, outcome: hit ? "hit" : "miss", landed, error: distance };
  }

  /**
   * A shot that did not count (refused, or with no aim seen). A hand whose
   * fingertip hardly moves as it aims is refused again and again, and a
   * camera reading too few frames a second never shows an aim before the
   * fold: such tries count towards Play Anyway as shots do, so nobody is
   * trapped in the check.
   */
  private uncounted(): void {
    if (this.canPlayAnyway || this.shots + (this.stats.refused ?? 0) + (this.stats.unaimed ?? 0) < PLAY_ANYWAY_AFTER) return;
    this.canPlayAnyway = true;
    this.tip = tipFor(this.stats);
    this.words = { title: "Still Learning", detail: this.tip };
  }

  /** Refits the map after a shot; false if the shots cannot determine one. */
  private refit(): boolean {
    const recent = this.pool.slice(-FIT_POOL);
    const source = recent.map((s) => s.pointer);
    const destination = recent.map((s) => s.target);
    let fitted: Matrix | null;
    let kind: "scaled" | "affine";
    if (recent.length >= 3) {
      fitted = this.robustAffine(source, destination);
      kind = "affine";
    } else if (recent.length === 2 && !this.returning) {
      fitted = fitScaled(source, destination);
      kind = "scaled";
    } else {
      return true; // nothing to fit yet: the saved aim (or none) stays
    }
    const sane = fitted !== null && source.every((p) => gain(fitted!, p) <= GAIN_LIMIT);
    if (!sane) {
      // The first map is the one that cannot be done without; later ones can
      // keep the map they have and wait for a shot that tells them more.
      return kind !== "scaled";
    }
    this.mapping = fitted;
    this.fit = kind;
    this.mappingVersion++;
    return true;
  }

  /**
   * Least squares over the recent shots, then again without any shot beyond
   * 3σ of the first fit: one shot fired while the hand was still moving should
   * not bend the map for every shot after it. σ never counts as smaller than
   * R/3, so a tight fit does not throw away good shots for being merely good.
   */
  private robustAffine(source: Point[], destination: [number, number][]): Matrix | null {
    const first = fitAffine(source, destination);
    if (!first || source.length < 5) return first;
    const { width, height } = this.viewport;
    const side = Math.min(width, height);
    const residuals = source.map((p, i) => {
      const landed = apply(first, p);
      if (!landed) return Number.POSITIVE_INFINITY;
      return Math.hypot(((landed[0] - destination[i]![0]) * width) / side, ((landed[1] - destination[i]![1]) * height) / side);
    });
    const sigma = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (2 * residuals.length));
    const limit = 3 * Math.max(sigma, AIM_RADIUS / 3);
    const keep = residuals.map((r) => r <= limit);
    if (keep.every(Boolean) || keep.filter(Boolean).length < 4) return first;
    return (
      fitAffine(
        source.filter((_, i) => keep[i]),
        destination.filter((_, i) => keep[i]),
      ) ?? first
    );
  }

  /** Where the ring would stand now: the shots taken of those the check needs at the least, and how near the aim is to ready. */
  private progressNow(): number {
    const need = (this.returning ? 0 : LEARNING_SHOTS) + MIN_ERRORS;
    const taken = Math.min(need, this.shots) / need;
    const near = Math.min(1, (this.measure.score ?? 0) / READY_SCORE);
    return Math.min(PROGRESS_CAP, 0.88 * taken + 0.12 * near);
  }

  /**
   * What the card says after a shot. Every shot at the lit target is taken,
   * so the words count them and say what Handheld is doing: learning where
   * the player points, then checking it. Nothing here is about where an
   * unfinished crosshair would have landed.
   */
  private say(): Words {
    const { one } = this.noun;
    const n = this.shots;
    if (this.done) return { title: "Aim Set", detail: "The crosshair now follows your finger." };
    if (this.canPlayAnyway && this.tip) return { title: "Still Learning", detail: this.tip };
    if (n === 1) return { title: "One Down", detail: `Point at the next lit ${one} and fire.` };
    if (n === 2) return { title: "Two Down", detail: this.returning ? "One more should do it." : "Handheld is learning where you point. Keep going." };
    if (n === 3) {
      return {
        title: "Three Down",
        detail: this.returning ? "Handheld is adjusting to where you point. Keep going." : "Handheld knows roughly where you point. A few more.",
      };
    }
    return { title: `${number(n)} Down`, detail: `Keep pointing at the lit ${one}. Handheld is checking its aim.` };
  }

  /**
   * The order to learn in: the first two targets as far apart as possible on
   * both axes (a scaled fit needs the hand to move in x and in y), the third
   * off the line between them (an affine fit needs a triangle).
   */
  private openingOrder(): string[] {
    const targets = this.targets;
    if (targets.length < 2) return targets.map((t) => t.id);
    const { width, height } = this.viewport;
    let best: [CalibrationTarget, CalibrationTarget] = [targets[0]!, targets[1]!];
    let bestSpread = -1;
    for (const a of targets) {
      for (const b of targets) {
        if (a === b) continue;
        const spread = Math.min(Math.abs(a.x - b.x) * width, Math.abs(a.y - b.y) * height);
        if (spread > bestSpread + 1e-9) {
          bestSpread = spread;
          best = a.y <= b.y ? [a, b] : [b, a]; // top one first: reading order
        }
      }
    }
    const [a, b] = best;
    let third: CalibrationTarget | null = null;
    let area = -1;
    for (const c of targets) {
      if (c === a || c === b) continue;
      const twice = Math.abs((b.x - a.x) * width * ((c.y - a.y) * height) - (c.x - a.x) * width * ((b.y - a.y) * height));
      if (twice > area) {
        area = twice;
        third = c;
      }
    }
    return third ? [a.id, b.id, third.id] : [a.id, b.id];
  }

  /** The next target to light: the plan first, then the least used, far from the last. */
  private next(): CalibrationTarget | null {
    const targets = this.targets;
    if (!targets.length) return null;
    const planned = this.plan[this.shots];
    if (planned !== undefined) {
      const found = targets.find((t) => t.id === planned);
      if (found && found.id !== this.lit?.id) return found;
    }
    const last = this.lit;
    const { width, height } = this.viewport;
    const candidates = targets.filter((t) => t.id !== last?.id);
    if (!candidates.length) return targets[0]!;
    return candidates.reduce((best, t) => {
      const uses = this.uses.get(t.id) ?? 0;
      const bestUses = this.uses.get(best.id) ?? 0;
      if (uses !== bestUses) return uses < bestUses ? t : best;
      if (!last) return best;
      const far = (c: CalibrationTarget) => Math.hypot((c.x - last.x) * width, (c.y - last.y) * height);
      return far(t) > far(best) ? t : best;
    });
  }
}
