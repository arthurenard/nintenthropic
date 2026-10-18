/**
 * A game in play, as the page holds it: the game and how it is aimed, where
 * its round has got to - the aim check, play, the results - and what is
 * holding it (the pause menu, a hand that has gone, a camera's trouble). One
 * session lasts from the game's load to the way back to the arcade; Play
 * Again, Restart and a new camera are new rounds of the same session.
 *
 * Here too are the page's pieces a round draws on, shared by the round
 * (round.ts) and its helpers: the wait for the hand (handHold.ts), the camera
 * mid-game (cameraInPlay.ts) and the scope (scopeInPlay.ts).
 */
import type { CameraIdentity } from "../calibration/storage";
import type { EngineHost } from "../engine/host";
import type { Game, GameContext, GameEntry, InputKind, InputSource, Settings } from "../engine/types";
import type { HandInput } from "../input/handInput";
import type { ScopeControl } from "../input/scope";
import type { AimCheckView } from "./aimCheckView";
import type { Crosshair } from "./crosshair";
import type { HandCamera } from "./handCamera";
import type { FireToPlay, HandWatch } from "./handWatch";
import type { Hud } from "./hud";
import type { Pip } from "./pip";
import type { Result } from "./results";
import type { Yielding } from "./yielding";

export type Phase = "loading" | "check" | "play" | "over";

export interface Session {
  entry: GameEntry;
  game: Game;
  /** What the game was given; its `input` follows a switch to the mouse mid-round. */
  context: GameContext;
  control: InputKind;
  input: InputSource & { reset(): void };
  hand: HandInput | null;
  check: AimCheckView | null;
  phase: Phase;
  paused: boolean;
  /** The round frozen while it waits for the hand (see handWatch.ts). */
  held: boolean;
  /** The round frozen under a camera trouble's sheet. */
  troubled: boolean;
  /** The player has fallen: the death plays out untouched, hand or no hand. */
  down: boolean;
  /** The results have been up a while: the world stopped drawing under them. */
  idle: boolean;
  watch: HandWatch;
  camera: CameraIdentity | null;
  unsubscribe: () => void;
  lostSince: number | null;
  /** Until when (performance.now() ms) the page says what the crosshair now does, after Play Anyway. */
  noteUntil: number;
  result: Result | null;
  /** Play Again with a fold of the thumb, while the results are up. */
  fire: FireToPlay | null;
  /** Timers that belong to this round's results, cleared when it moves on. */
  timers: number[];
  /** The scope, in a game that has one (GameEntry.uses.scope). */
  scope: ScopeControl | null;
  /** Stops Shift scoping, when the session ends. */
  stopScopeKeys: () => void;
  /** Stops the right mouse button scoping with the hand (a pointer's own input does it for itself). */
  stopScopeMouse: () => void;
  /** The player has looked through the scope this round, by any means. */
  scoped: boolean;
  /** Since when the eye has not seen the face, ms; null while it does. */
  faceAway: number | null;
}

/** The page's pieces a round draws on. */
export interface PlayPieces {
  /** The renderer and its loop: made with the first game, null until then. */
  host(): EngineHost | null;
  readonly hud: Hud;
  readonly crosshair: Crosshair;
  /** The camera's picture, in the corner. */
  readonly pip: Pip;
  /** The corners' chrome, stepping aside for what the player aims at. */
  readonly yielding: Yielding;
  /** What the game reads: the player's settings, put into effect. */
  readonly settings: Settings;
  readonly camera: HandCamera;
}
