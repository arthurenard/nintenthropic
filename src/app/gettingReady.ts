/**
 * A game getting ready. Before the browser first asks for the camera, the
 * page says why; then everything the game needs downloads side by side
 * behind one loading bar with real numbers - the camera and the hand tracker
 * when it is played with the hand (and the face, for a game that reads the
 * eye), and the game itself. Whatever fails is told calmly, with the one fix
 * that matters.
 */
import { WebGLUnavailable } from "../engine/common";
import { DownloadError, type Progress } from "../engine/fetch";
import type { EngineHost } from "../engine/host";
import { seededRandom } from "../engine/random";
import type { Game, GameContext, GameEntry, InputKind, Settings } from "../engine/types";
import { CameraError, cameraPermission } from "../tracking/camera";
import { ModelError } from "../tracking/errors";
import { $, setText } from "../ui/dom";
import { touchOnly } from "../ui/touch";
import type { HandCamera } from "./handCamera";
import type { Hud } from "./hud";
import { prefs } from "./prefs";
import { closeSheet, openSheet, type Fix, type Trouble } from "./sheets";
import type { PageAudio } from "./sound";

/** Tags a failure with the part of getting ready it came from. */
class Stage extends Error {
  constructor(
    readonly part: "camera" | "tracker" | "game",
    readonly error: unknown,
  ) {
    super(part);
  }
}

const tagged = <T>(part: Stage["part"], promise: Promise<T>): Promise<T> =>
  promise.catch((error: unknown) => {
    throw new Stage(part, error);
  });

/**
 * Before the browser asks for the camera, say why: once, for a player whose
 * browser has not already given it. Resolves the control to play with, or
 * null to stay in the arcade; a browser that cannot give the camera at all
 * is told through `trouble`.
 */
export async function askForCamera(eye: boolean, trouble: (kind: Trouble) => void): Promise<InputKind | null> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    trouble("insecure");
    return null;
  }
  const permission = await cameraPermission();
  if (permission === "denied") {
    trouble("denied");
    return null;
  }
  if (permission === "granted" || prefs.cameraOpened) return "hand";
  setText(
    "prime-body",
    eye
      ? "Super Claude Bros. needs your camera to see your hand, and in this game whether one eye is closed. The picture stays on this computer."
      : "Super Claude Bros. needs your camera to see your hand. The picture stays on this computer.",
  );
  return new Promise((resolve) => {
    const sheet = openSheet("prime");
    const done = (value: InputKind | null) => {
      sheet.onclose = null;
      closeSheet("prime");
      resolve(value);
    };
    $("prime-continue").onclick = () => done("hand");
    $("prime-mouse").onclick = () => done(touchOnly() ? "touch" : "mouse");
    sheet.onclose = () => resolve(null); // Esc: back to the arcade
    $("prime-continue").focus();
  });
}

/** What a game is given: the renderer and its canvas, the sound, the HUD, the player's settings, and how they aim. */
export function gameContext(host: EngineHost, control: InputKind, audio: PageAudio, hud: Hud, settings: Settings): GameContext {
  return {
    renderer: host.renderer,
    canvas: host.canvas,
    audio,
    hud,
    assets: host.assets,
    settings,
    quality: host.quality,
    random: seededRandom((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0),
    clock: () => new Date(),
    input: control,
  };
}

export interface LoadPlan {
  /** A game that can be played (see playable). */
  entry: GameEntry & { create(): Promise<Game> };
  /** What the game is given (gameContext). */
  context: GameContext;
  /** Played with the real camera (not the scripted hand): the camera and the tracker get ready too. */
  withCamera: boolean;
  /** The face landmarker comes too, for a game that reads the eye. */
  eye: boolean;
  camera: HandCamera;
  progress: Progress;
  /** The player has gone elsewhere since: a tracker that arrives now is not wanted. */
  stale(): boolean;
  /** A trouble to simulate (`model`, `game`), in dev and test builds. */
  fail: string | null | undefined;
}

/**
 * Loads everything the game needs side by side, each into its part of the
 * one bar. Resolves the game, loaded; a failure is tagged with the part it
 * came from (see whatWentWrong).
 */
export async function loadForPlay(plan: LoadPlan): Promise<Game> {
  const { camera, progress } = plan;
  let game: Game | null = null;
  const work: Promise<unknown>[] = [];
  if (plan.withCamera) {
    if (!camera.camera) work.push(tagged("camera", camera.open()));
    if (!camera.tracker) {
      const wasm = progress.part("wasm", 12);
      const model = progress.part("model", 8);
      const face = plan.eye ? progress.part("face", 4) : undefined;
      work.push(
        tagged(
          "tracker",
          plan.fail === "model"
            ? Promise.reject(new ModelError())
            : camera.loadTracker({ wasm, model, ...(face ? { face } : {}) }, plan.eye).then((tracker) => {
                if (plan.stale()) tracker.dispose();
                else camera.tracker = tracker;
              }),
        ),
      );
    } else if (plan.eye && !camera.tracker.hasFace) {
      // The eye is a help, not a need: a face that will not load leaves Shift to scope.
      work.push(camera.tracker.addFace(progress.part("face", 4)).catch((error: unknown) => console.warn("The face landmarker did not load.", error)));
    }
  }
  const gamePart = progress.part("game", plan.withCamera && !camera.tracker ? 10 : 1);
  const loaded = tagged(
    "game",
    (async () => {
      const created = await plan.entry.create();
      game = created;
      if (plan.fail === "game") throw new DownloadError("game", 404);
      await created.load(plan.context, gamePart);
      return created;
    })(),
  );
  work.push(loaded);
  try {
    await Promise.all(work);
  } catch (error) {
    // Whatever is still loading is let finish, then put away: disposing
    // a game under its own load would leave that load failing on its own.
    void loaded.then(
      (done) => done.dispose(),
      () => game?.dispose(),
    );
    throw error;
  }
  return loaded;
}

/**
 * What to tell a player whose game did not get ready: the trouble's sheet,
 * and which fixes it offers beside Try Again. `cause` is the error itself,
 * for the console.
 */
export function whatWentWrong(error: unknown): { cause: unknown; trouble: Trouble; choices?: { secondary?: Fix | null } } {
  const part = error instanceof Stage ? error.part : null;
  const cause = error instanceof Stage ? error.error : error;
  if (cause instanceof WebGLUnavailable) return { cause, trouble: "webgl" };
  if (cause instanceof CameraError) return { cause, trouble: cause.trouble };
  // Anything else that failed with the browser offline was a download (a
  // file, or a piece of the page's own code): say so, it is the one fix
  // that matters. The mouse helps only if it was the hand's download.
  if (navigator.onLine === false) {
    return { cause, trouble: "offline", choices: { secondary: part === "tracker" ? "Use Mouse or Trackpad" : "Choose a Game" } };
  }
  if (part === "tracker" || cause instanceof ModelError) return { cause, trouble: "model" };
  return { cause, trouble: "game" };
}
