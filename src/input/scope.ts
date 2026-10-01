/**
 * Looking through a scope (Aim.scope), for a game whose entry asks for one
 * (GameEntry.uses.scope): Overwatch Ridge's rifle.
 *
 * With the hand, the player closes one eye - as anyone does to look down a
 * sight - and the face landmarker, reading the same camera frames, sees it:
 * EyeScope turns the eyes' blink scores into a steady "scoping" that a
 * normal blink never gives. And a game must be playable without the eye
 * (a camera that sees the face badly, a player who cannot wink, the mouse):
 * holding Shift, or the right mouse button, or on a touch screen the page's
 * Scope button, scopes too, held or toggled as the player chooses in
 * Settings, with the hand as much as with the mouse. ScopeControl puts them
 * together.
 *
 * What the eye has to cope with, in a real room:
 *   - The pointing hand is in front of the face, and the landmarker loses a
 *     face it cannot see (it finds none behind a fist). A scope held by the
 *     eye is kept while the face is missing, until the face is seen again
 *     with the eye open - or, at the longest, for `occlusion` ms.
 *   - Blink scores differ a lot between people, glasses and lights: a wink
 *     reads 0.9 on one face and 0.45 on another, and an open eye 0.05 on one
 *     and 0.3 on another (looking down raises it). So nothing is a fixed
 *     number: each eye's open level is followed as the player plays, and the
 *     scope closes on a clear rise above it, set between the open level and
 *     how far this player's eye really closes (learned from their winks).
 *   - A blink closes both eyes, a wink one. One eye shut and the other open
 *     scopes quickly; both shut takes a long, hard squeeze, which a blink
 *     and a downward look never are.
 */
import type { FaceReading } from "../tracking/types";

/**
 * How often the face is read, for a game that reads the eye: every other
 * camera frame. Every frame kept the tracking worker busy 20 ms a frame and
 * cost the hand frames; every other costs nothing the player sees
 * (measured in tracking/tracker.ts).
 */
export const FACE_EVERY = 2;

/** What this player's eyes read, from the face landmarker's blink scores: open, and one shut. */
export interface EyeProfile {
  open: number;
  closed: number;
}

export interface EyeScopeOptions {
  /**
   * How far an eye travels from open to shut, in blink score, until this
   * player's own winks say otherwise (a modest wink; most reach more). It is
   * a distance, not a level: a player whose open eyes read 0.25 is not
   * thereby asked for less.
   */
  span: number;
  /**
   * The rise above an eye's open level that scopes, and the rise it must
   * fall back under to let go (hysteresis), as fractions of that span; each
   * kept between its own limits, in blink score.
   */
  on: number;
  off: number;
  onLimits: readonly [number, number];
  offLimits: readonly [number, number];
  /** One eye shut, the other clearly more open (a wink): this long, ms, scopes. */
  hold: number;
  /** Both eyes shut (a blink, a squeeze): this long, ms - far longer than any blink. */
  holdBoth: number;
  /** The least that both eyes shut must rise, in blink score, to be a squeeze: a look down, a squint or a laugh does not reach it. */
  bothRise: number;
  /** A wink's other eye has risen at least this fraction of the scoping rise less than the winking one (the eyes are not alike). */
  asymmetry: number;
  /** The eye must read open this long, ms, before the scope lets go (one low reading is noise). */
  release: number;
  /** A face lost for this long, ms, in the middle of closing an eye is waited for. */
  grace: number;
  /** A scope held by the eye lets go when the face has been lost this long, ms (the hand across it). */
  occlusion: number;
  /** No reading at all for this long (the camera or the face landmarker stopped) ends it too, ms. */
  stale: number;
  /** How fast an eye's open level follows its readings: down, up, as time constants in ms. */
  fall: number;
  rise: number;
  /** A face seen this recently, ms, is "seen" (for the indicator). */
  seen: number;
  /** A scope held at least this long, ms, teaches the player's closed level... */
  learnAfter: number;
  /** ... by this much of the way from what was known to what the scope read (0 to 1). */
  learn: number;
}

/**
 * The defaults. An eye scopes once it has risen half of a modest span (0.57:
 * an eye that opens at 0.08 and shuts to 0.65) above its own open level: a
 * rise of 0.285, so a wink that only reads 0.4 works, and a squint, a look
 * down or a laugh (a rise of 0.2 to 0.4 in both eyes at once) does not -
 * the other eye must stay well behind it. Both shut takes a rise of 0.62.
 * (Tried against simulated natural traces - blinks, squints, looks down,
 * laughs, head turns - on four kinds of open eye (open reading 0.05 to 0.4),
 * 200 of each: no false scope, bar a head turned so far that one eye reads as
 * a wink, and a look down with one eye 0.2 ahead of the other, which now and
 * then does. A wink that rises 0.4 or more scopes in about 0.27 s.)
 */
export const EYE_SCOPE: Readonly<EyeScopeOptions> = Object.freeze({
  span: 0.57,
  on: 0.5,
  off: 0.3,
  onLimits: [0.2, 0.4] as const,
  offLimits: [0.1, 0.25] as const,
  hold: 250,
  holdBoth: 700,
  bothRise: 0.62,
  asymmetry: 0.85,
  release: 120,
  grace: 300,
  occlusion: 10_000,
  stale: 400,
  fall: 300,
  rise: 2500,
  seen: 700,
  learnAfter: 600,
  learn: 0.5,
});

/** What the eye says to the indicator and the Eye Test: the face, the eyes, how near the scope. */
export interface EyeView {
  /** A face was read a moment ago: false while the hand covers it or the head is turned away. */
  seen: boolean;
  /** Each eye's blink score as read, 0 (open) to 1 (shut); both 0 while no face is seen. */
  left: number;
  right: number;
  /** How far the more closed eye is to scoping, 0 (open) to 1 (there). */
  closing: number;
  /** The blink score at which an eye scopes, for this player now. */
  threshold: number;
  /** Looking through the scope by the eye. */
  scoped: boolean;
  /** The scope is kept on faith: the face is lost (a hand across it) and it lets go when it is seen open, or in time. */
  held: boolean;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * One eye closed, held: the scope. A blink closes both eyes for a tenth of a
 * second or so and never reaches the hold; an eye closed on purpose stays
 * closed. Pure: readings in (with the time their camera frame was taken), a
 * yes or no out - and a view of the eyes for the indicator.
 */
export class EyeScope {
  private scoped = false;
  /** When the eyes closed past the threshold (the start of the hold), ms; null while open. */
  private closedSince: number | null = null;
  /** When the eye opened while scoped (the start of the release), ms; null while shut. */
  private openedSince: number | null = null;
  /** When the face went missing, ms; null while it is seen. */
  private missingSince: number | null = null;
  /** When a face was last read, and the last reading of any kind (a missing face is one), ms. */
  private seenAt: number | null = null;
  private lastAt: number | null = null;
  /** Each eye's open level, as followed: left, right. */
  private readonly open: [number, number] = [0.08, 0.08];
  private seeded = false;
  private openAt: number | null = null;
  /** How far this player's eye travels, open to shut, in blink score: as known, then as learned from their winks. */
  private span: number;
  private latest: FaceReading | null = null;
  /** The scope in hand: when it began, and the more closed eye's rises over it (for learning how far this eye shuts). */
  private scopedAt = 0;
  private shutSum = 0;
  private shutCount = 0;
  /** Called with what this player's eyes read when a scope has taught it (to be kept for next time). */
  onLearn: ((profile: EyeProfile) => void) | null = null;

  constructor(
    private readonly options: EyeScopeOptions = EYE_SCOPE,
    profile: EyeProfile | null = null,
  ) {
    this.span = clamp(profile ? profile.closed - profile.open : options.span, 0.3, 0.9);
    if (profile) this.open.fill(clamp(profile.open, 0, 0.45));
  }

  /** The distance, in blink score, an eye must rise above its open level to scope. */
  private get riseOn(): number {
    const o = this.options;
    return clamp(o.on * this.span, o.onLimits[0], o.onLimits[1]);
  }

  /** ... and the one it must fall back under to let go. */
  private get riseOff(): number {
    const o = this.options;
    return Math.min(clamp(o.off * this.span, o.offLimits[0], o.offLimits[1]), this.riseOn - 0.06);
  }

  /** What this player's eyes read - open, and one shut - for keeping. */
  get profile(): EyeProfile {
    const open = (this.open[0] + this.open[1]) / 2;
    return { open: Math.round(open * 100) / 100, closed: Math.round(Math.min(1, open + this.span) * 100) / 100 };
  }

  /** One camera frame's reading: the eyes' blink scores, or null when no face was found. */
  read(face: FaceReading | null, at: number): void {
    this.lastAt = at;
    const o = this.options;
    if (!face) {
      this.missingSince ??= at;
      if (this.scoped) {
        // The hand across the face: the scope is kept, until the face is
        // seen again with the eye open, or for as long as is sane.
        if (at - this.missingSince > o.occlusion) this.letGo(at);
      } else if (this.closedSince !== null && at - this.missingSince > o.grace) {
        // A face lost in the middle of closing an eye is waited for a moment, no longer.
        this.closedSince = null;
      }
      return;
    }
    this.missingSince = null;
    this.seenAt = at;
    this.latest = face;
    if (!this.seeded) {
      this.seeded = true;
      this.open[0] = clamp(face.blinkLeft, 0, 0.45);
      this.open[1] = clamp(face.blinkRight, 0, 0.45);
    }
    const left = face.blinkLeft - this.open[0];
    const right = face.blinkRight - this.open[1];
    const high = Math.max(left, right);
    const low = Math.min(left, right);

    if (this.scoped) {
      if (high > this.riseOff) {
        this.openedSince = null;
        // How far this eye is shut, over the scope, for the next one.
        if (high > this.riseOn) {
          this.shutSum += high;
          this.shutCount++;
        }
      } else {
        this.openedSince ??= at;
        if (at - this.openedSince >= o.release) this.letGo(at);
      }
      return;
    }

    // One eye shut and the other well behind it is a wink; both shut, hard, is a squeeze.
    const behind = o.asymmetry * this.riseOn;
    const wink = high >= this.riseOn && low <= high - behind;
    const squeeze = high >= Math.max(this.riseOn, o.bothRise) && low > high - behind;
    if (wink || squeeze) {
      this.closedSince ??= at;
      if (at - this.closedSince >= (wink ? o.hold : o.holdBoth)) {
        this.scoped = true;
        this.scopedAt = at;
        this.openedSince = null;
        this.shutSum = 0;
        this.shutCount = 0;
      }
      return;
    }
    this.closedSince = null;
    this.followOpen(face, at);
  }

  /** The open level follows the readings while nothing is closing: quickly down, slowly up. */
  private followOpen(face: FaceReading, at: number): void {
    const o = this.options;
    const dt = this.openAt === null ? 0 : Math.min(250, Math.max(0, at - this.openAt));
    this.openAt = at;
    const readings = [face.blinkLeft, face.blinkRight];
    for (let i = 0; i < 2; i++) {
      const value = clamp(readings[i]!, 0, 1);
      // An eye already on its way shut is not an open one.
      if (value - this.open[i]! > this.riseOn * 0.6) continue;
      const tau = value < this.open[i]! ? o.fall : o.rise;
      this.open[i] = this.open[i]! + (value - this.open[i]!) * Math.min(1, dt / tau);
    }
  }

  /** The scope ends: and a scope held long enough has taught how far this player's eye shuts. */
  private letGo(at: number): void {
    if (this.scoped && at - this.scopedAt >= this.options.learnAfter && this.shutCount > 0) {
      const travelled = clamp(this.shutSum / this.shutCount, 0.3, 0.9);
      this.span = clamp(this.span + (travelled - this.span) * this.options.learn, 0.3, 0.9);
      this.onLearn?.(this.profile);
    }
    this.scoped = false;
    this.closedSince = null;
    this.openedSince = null;
  }

  /** Scoping now? False once the readings have stopped coming. */
  active(now: number): boolean {
    if (!this.scoped || this.lastAt === null) return false;
    return now - this.lastAt <= this.options.stale;
  }

  /** The eyes as the indicator and the Eye Test show them. */
  view(now: number): EyeView {
    const seen = this.seenAt !== null && now - this.seenAt <= this.options.seen;
    const face = seen ? this.latest : null;
    const rise = face ? Math.max(face.blinkLeft - this.open[0], face.blinkRight - this.open[1]) : 0;
    const scoped = this.active(now);
    return {
      seen,
      left: face?.blinkLeft ?? 0,
      right: face?.blinkRight ?? 0,
      closing: scoped ? 1 : clamp(rise / this.riseOn, 0, 1),
      threshold: clamp(Math.max(this.open[0], this.open[1]) + this.riseOn, 0, 1),
      scoped,
      held: scoped && !seen,
    };
  }

  /** Nothing held over a pause; what has been learned of the player's eyes stays. */
  reset(): void {
    this.scoped = false;
    this.closedSince = null;
    this.openedSince = null;
    this.missingSince = null;
    this.seenAt = null;
    this.lastAt = null;
    this.latest = null;
    this.openAt = null;
  }
}

/** How the scope buttons (Shift, the right mouse button, the touch screen's Scope) work. */
export type ScopeButtonMode = "hold" | "toggle";

/** What can ask for the scope besides the eye. */
export type ScopeButton = "key" | "mouse" | "touch";

/**
 * The scope, asked for by the eye or by a button. Held: scoping while any
 * button is down. Toggled: each press turns it on or off. The eye is always
 * held - the scope lasts as long as the eye stays closed - and either way
 * scopes. `reset` lets everything go (a pause, a new round): nothing held
 * from before comes back on its own.
 */
export class ScopeControl {
  /** Close One Eye to Scope (Settings), for the hand in a game that reads the eye. */
  readonly eye: EyeScope | null;
  private readonly held = new Set<ScopeButton>();
  private latched = false;
  /** Called when the buttons' state changes (for the Scope button's look). */
  onChange: (() => void) | null = null;

  constructor(
    public mode: ScopeButtonMode = "hold",
    eye: EyeScope | null = null,
  ) {
    this.eye = eye;
  }

  press(button: ScopeButton): void {
    if (this.held.has(button)) return; // a key's auto-repeat
    this.held.add(button);
    if (this.mode === "toggle") this.latched = !this.latched;
    this.onChange?.();
  }

  release(button: ScopeButton): void {
    if (!this.held.delete(button)) return;
    this.onChange?.();
  }

  /** The buttons alone ask for the scope now. */
  get buttons(): boolean {
    return this.mode === "toggle" ? this.latched : this.held.size > 0;
  }

  /** Closing an eye scopes (Settings: Close One Eye to Scope), where there is an eye to read. */
  useEye = true;

  /** Is the player asking to look through the scope now? */
  active(now: number): boolean {
    return this.buttons || (this.useEye && (this.eye?.active(now) ?? false));
  }

  /** The eye as the indicator shows it; null where no eye is read (or Settings turned it off). */
  eyeView(now: number): EyeView | null {
    return this.useEye && this.eye ? this.eye.view(now) : null;
  }

  reset(): void {
    const was = this.buttons;
    this.held.clear();
    this.latched = false;
    this.eye?.reset();
    if (was) this.onChange?.();
  }
}

/**
 * Shift scopes, anywhere on the page, while `control` is live: returns the
 * function that stops listening. A window that loses focus lets it go (the
 * key's release would never arrive).
 */
export function scopeKeys(control: ScopeControl, target: Window = window): () => void {
  const down = (event: KeyboardEvent) => {
    if (event.key === "Shift" && !event.repeat) control.press("key");
  };
  const up = (event: KeyboardEvent) => {
    if (event.key === "Shift") control.release("key");
  };
  const blur = () => control.release("key");
  target.addEventListener("keydown", down);
  target.addEventListener("keyup", up);
  target.addEventListener("blur", blur);
  return () => {
    target.removeEventListener("keydown", down);
    target.removeEventListener("keyup", up);
    target.removeEventListener("blur", blur);
  };
}

/**
 * The right mouse button scopes too, for a player whose gun is the hand (the
 * mouse's own input does it for a player who aims with the pointer). It is
 * read from each event's `buttons`, as the pointer's is, and the stage's
 * context menu stays shut. Returns the function that stops listening.
 */
export function scopeMouse(control: ScopeControl, stage: HTMLElement, target: Window = window): () => void {
  let down = false;
  const sync = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const right = (event.buttons & 2) !== 0;
    if (right && !down) {
      // A press on the page's own controls (Pause, a sheet) is theirs.
      if (event.target instanceof Element && event.target.closest("button, a, input, select, [data-not-a-shot]")) return;
      down = true;
      control.press("mouse");
    } else if (!right && down) {
      down = false;
      control.release("mouse");
    }
  };
  const menu = (event: Event) => event.preventDefault();
  const blur = () => {
    down = false;
    control.release("mouse");
  };
  stage.addEventListener("pointerdown", sync);
  stage.addEventListener("contextmenu", menu);
  target.addEventListener("pointermove", sync);
  target.addEventListener("pointerup", sync);
  target.addEventListener("blur", blur);
  return () => {
    stage.removeEventListener("pointerdown", sync);
    stage.removeEventListener("contextmenu", menu);
    target.removeEventListener("pointermove", sync);
    target.removeEventListener("pointerup", sync);
    target.removeEventListener("blur", blur);
    blur();
  };
}
