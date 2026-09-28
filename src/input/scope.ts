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
 * Settings. ScopeControl puts them together.
 */
import type { FaceReading } from "../tracking/types";

/**
 * How often the face is read, for a game that reads the eye: every other
 * camera frame. Every frame kept the tracking worker busy 20 ms a frame and
 * cost the hand frames; every other costs nothing the player sees
 * (measured in tracking/tracker.ts).
 */
export const FACE_EVERY = 2;

export interface EyeScopeOptions {
  /** The larger blink score must rise above this... */
  on: number;
  /** ... and stay above it this long, ms, to scope (a blink is shorter). */
  hold: number;
  /** Scoping ends when it falls below this (hysteresis: an eye half-open does not flicker it). */
  off: number;
  /** How long a face the landmarker lost is waited for before scoping ends, ms. */
  grace: number;
  /** No reading at all for this long (the camera or the face landmarker stopped) ends it too, ms. */
  stale: number;
}

/**
 * The desktop's numbers: scope when the larger of the two eye-blink scores
 * is above 0.55 for 180 ms, release below 0.30, with 200 ms of grace for a
 * face lost for a moment.
 */
export const EYE_SCOPE: Readonly<EyeScopeOptions> = Object.freeze({ on: 0.55, hold: 180, off: 0.3, grace: 200, stale: 400 });

/**
 * One eye closed, held: the scope. A blink closes both eyes for a tenth of a
 * second or so and never reaches `hold`; an eye closed on purpose stays
 * closed. The larger of the two scores is read, so either eye will do.
 * Pure: readings in (with the time their camera frame was taken), a yes or
 * no out.
 */
export class EyeScope {
  private scoped = false;
  /** When the eye closed past `on` (the start of the hold), ms; null while open. */
  private closedSince: number | null = null;
  /** When the face went missing, ms; null while it is seen. */
  private missingSince: number | null = null;
  /** When the last reading (face or no face) was taken, ms. */
  private lastAt: number | null = null;

  constructor(private readonly options: EyeScopeOptions = EYE_SCOPE) {}

  /** One camera frame's reading: the eyes' blink scores, or null when no face was found. */
  read(face: FaceReading | null, at: number): void {
    this.lastAt = at;
    const o = this.options;
    if (!face) {
      this.missingSince ??= at;
      // A face lost for a moment (a turn of the head, the hand across it)
      // leaves the scope as it was; lost for longer, the scope is let go.
      if (at - this.missingSince > o.grace) {
        this.scoped = false;
        this.closedSince = null;
      }
      return;
    }
    this.missingSince = null;
    const closed = Math.max(face.blinkLeft, face.blinkRight);
    if (this.scoped) {
      if (closed < o.off) {
        this.scoped = false;
        this.closedSince = null;
      }
      return;
    }
    if (closed > o.on) {
      this.closedSince ??= at;
      if (at - this.closedSince >= o.hold) this.scoped = true;
    } else {
      this.closedSince = null;
    }
  }

  /** Scoping now? False once the readings have stopped coming. */
  active(now: number): boolean {
    if (!this.scoped || this.lastAt === null) return false;
    return now - this.lastAt <= this.options.stale;
  }

  reset(): void {
    this.scoped = false;
    this.closedSince = null;
    this.missingSince = null;
    this.lastAt = null;
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
  /** Close One Eye to Scope (Settings), for the hand in a game that uses the eye. */
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
