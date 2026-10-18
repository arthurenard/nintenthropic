/**
 * The scope in play, for a game that has one (GameEntry.uses.scope): Shift,
 * the right mouse button and, on a touch screen, the Scope button - held or
 * toggled, as Settings says - and, with the hand in a game that reads it, a
 * closed eye. A change in Settings reaches the round in play at once. The
 * face is read only while an eye can scope; the eye's indicator in the HUD
 * shows how far it has closed, and a face that stays out of view before the
 * player has scoped at all is said, with the way that always works.
 */
import type { Aim, GameEntry, InputKind, Settings } from "../engine/types";
import { EYE_SCOPE, EyeScope, FACE_EVERY, ScopeControl, type EyeView } from "../input/scope";
import { $ } from "../ui/dom";
import { touchCapable } from "../ui/touch";
import type { HandCamera } from "./handCamera";
import type { Hud } from "./hud";
import { loadEyeProfile, saveEyeProfile, type ScopePreferences } from "./prefs";
import type { Session } from "./session";

/** The face out of view this long, ms, before the player has scoped: the page says so, for this long after. */
const FACE_AWAY = 6000;
const FACE_AWAY_SAID = 8000;

export class ScopeInPlay {
  constructor(
    /** What the game is told of how the player scopes (`Settings.scope`). */
    private readonly settings: Settings,
    /** How the player scopes, as Settings' Scope group has it. */
    private readonly prefs: ScopePreferences,
    private readonly camera: HandCamera,
    private readonly hud: Hud,
    private readonly current: () => Session | null,
  ) {}

  /** Does this game read the eye when played this way, as the player has it set? */
  readsEye(entry: GameEntry, control: InputKind): boolean {
    return control === "hand" && entry.uses?.scope === true && entry.uses.eye === true && this.prefs.eye;
  }

  /**
   * The scope for a new session, in a game with one: Shift, the right button
   * or the Scope button, and - with the hand, in a game that reads it - the eye.
   */
  forGame(entry: GameEntry, control: InputKind): ScopeControl | null {
    const uses = entry.uses ?? {};
    const scope = uses.scope ? new ScopeControl(this.prefs.button, control === "hand" && uses.eye ? this.newEye() : null) : null;
    if (scope) {
      scope.useEye = this.prefs.eye;
      scope.onChange = () => $("scope-button").setAttribute("aria-pressed", String(scope.buttons));
    }
    return scope;
  }

  /** The eye for a scope: this player's own eyes, as learned from their winks before. */
  private newEye(): EyeScope {
    const eye = new EyeScope(EYE_SCOPE, loadEyeProfile());
    eye.onLearn = (profile) => saveEyeProfile(profile);
    return eye;
  }

  /**
   * The session's scope as the player has it set now: held or toggled, the
   * eye read or not (and the face with it), the Scope button on a touch
   * screen, and what the game is told.
   */
  apply(session: Session): void {
    const scope = session.scope;
    const eye = scope !== null && scope.eye !== null && session.control === "hand" && this.prefs.eye;
    if (scope) {
      scope.mode = this.prefs.button;
      scope.useEye = eye;
    }
    // What the game tells the player: the eye only where the face landmarker is really there to read it.
    this.settings.scope = { eye: eye && this.camera.faceReady, button: this.prefs.button, touch: touchCapable() };
    const tracker = this.camera.tracker;
    if (eye && !this.camera.scripted && tracker && !tracker.hasFace) {
      // Turned on mid-game, or it did not come with the hand: the face comes quietly, and is
      // read once it is here. A face that will not load leaves Shift to scope, and says so.
      tracker.addFace(() => {}).then(
        () => this.current() === session && this.apply(session),
        (error: unknown) => console.warn("The face landmarker did not load.", error),
      );
    }
    this.camera.readFaces(eye ? FACE_EVERY : 0);
    // The Scope button: on a touch screen, with a pointer or with the hand (a touch screen has no Shift).
    const button = $("scope-button");
    button.hidden = !(scope && (session.control === "touch" || (session.control === "hand" && touchCapable())));
    button.setAttribute("aria-pressed", String(scope?.buttons ?? false));
  }

  /** The Scope group changed in Settings: the round in play takes it at once; at the arcade, the next game is told. */
  changed(): void {
    const session = this.current();
    if (session) this.apply(session);
    else this.settings.scope = { eye: false, button: this.prefs.button };
  }

  /** The face read again as the round in play asks (after the Eye Test borrowed the tracker). */
  readFacesForRound(): void {
    this.camera.readFaces(this.current()?.scope?.useEye ? FACE_EVERY : 0);
  }

  /** The session is over: no face is read, and the Scope button goes. */
  stop(): void {
    this.camera.readFaces(0);
    $("scope-button").hidden = true;
  }

  /**
   * The eye's indicator in the HUD, every frame of play: whether the face is
   * seen and how far the eye has closed. And when the face stays out of view
   * - the hand across it, a head turned away, a camera that cannot see it -
   * before the player has looked through the scope at all, the page says so
   * (faceAwayHint).
   */
  watch(session: Session, now: number, aim: Aim): void {
    const scope = session.scope;
    if (aim.scope) session.scoped = true;
    const view: EyeView | null = session.phase === "play" && !session.down && scope ? scope.eyeView(now) : null;
    this.hud.eye(view);
    if (view && !view.seen && !view.scoped) session.faceAway ??= now;
    else session.faceAway = null;
  }

  /**
   * The words for a face out of view, or null: said only while the player has
   * not yet scoped, for a few seconds once the face has been away a while (it
   * must not hide the game's own hints for good), and again if the face comes
   * and goes. They say the way that always works.
   */
  faceAwayHint(session: Session, now: number): string | null {
    if (session.faceAway === null || session.scoped) return null;
    const away = now - session.faceAway;
    if (away < FACE_AWAY || away > FACE_AWAY + FACE_AWAY_SAID) return null;
    const way = touchCapable() && session.control !== "mouse" ? "Scope" : "Shift";
    // A face landmarker that never came (nothing to see the eyes with) is told apart from a face out of view.
    const why = this.camera.faceReady ? "Your face isn’t in view." : "Your camera can’t read your eyes here.";
    return `${why} ${this.prefs.button === "toggle" ? "Press" : "Hold"} ${way} to look through the scope.`;
  }

  /** The touch screen's Scope button: held (or tapped, to toggle) with a thumb while the other hand aims. */
  wireButton(): void {
    const button = $("scope-button");
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.current()?.scope?.press("touch");
      // Held as the thumb slides off it, until the thumb lifts.
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer knows: nothing to hold on to.
      }
    });
    for (const type of ["pointerup", "pointercancel"] as const) {
      button.addEventListener(type, () => this.current()?.scope?.release("touch"));
    }
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    // From the keyboard it can only be pressed, not held: once, as a toggle does.
    button.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      this.current()?.scope?.press("touch");
      this.current()?.scope?.release("touch");
    });
  }
}
