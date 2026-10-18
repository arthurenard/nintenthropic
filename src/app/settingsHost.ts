/**
 * The Settings sheet's side of the page (SettingsHost): a choice made on the
 * sheet is saved and put into effect, the Scope group reaches the round in
 * play at once, the camera menu names the camera that will open next, and
 * the Eye Test, Reset Everything and the facts for a bug report are run
 * from here. The sheet itself (settings.ts) only shows and edits.
 */
import type { EngineHost } from "../engine/host";
import type { Samples } from "../engine/stats";
import { gpuName } from "../engine/tier";
import { playableGames } from "../games/index";
import { chooseCamera, chosenCamera, remembered } from "../tracking/camera";
import { touchOnly } from "../ui/touch";
import { runEyeTest } from "./eyeTest";
import type { HandCamera } from "./handCamera";
import { forgetSavedAims, hasSavedAim, savePreferences, saveScopePreferences, type Preferences, type ScopePreferences } from "./prefs";
import type { ScopeInPlay } from "./scopeInPlay";
import { VERSION, type SettingsHost, type SystemFacts } from "./settings";
import type { PageSound } from "./sound";

/** What the Settings sheet's changes reach on the page. */
export interface SettingsPage {
  /** The player's settings, edited in place by the sheet. */
  readonly preferences: Preferences;
  /** How the player scopes, edited in place by the sheet. */
  readonly scopePrefs: ScopePreferences;
  readonly camera: HandCamera;
  readonly scope: ScopeInPlay;
  readonly sound: PageSound;
  /** What the system asks for, which Reduce Motion follows until the player chooses. */
  readonly motion: MediaQueryList;
  /** Camera capture to crosshair drawn, ms, for the bug report. */
  readonly latency: Samples;
  /** The renderer, once a game has made it. */
  host(): EngineHost | null;
  /** A game is being played: the camera open now is its own until it ends. */
  inGame(): boolean;
  /** Puts the player's settings into effect, everywhere one is read. */
  applyPreferences(): void;
  /** Draws the arcade afresh, for what it says of the settings (the best at this difficulty, Adjust Aim). */
  renderArcade(): void;
  /** Reset Everything: forgets everything, and starts again as on the first visit. */
  reset(): void;
}

export function settingsHost(page: SettingsPage): SettingsHost {
  const { camera } = page;
  return {
    preferences: page.preferences,
    scope: page.scopePrefs,
    scopeGames: () => playableGames().filter((game) => game.uses?.scope),
    touch: () => touchOnly(),
    systemReducesMotion: () => page.motion.matches,
    changed: (key) => {
      if (key === "scope") {
        saveScopePreferences(page.scopePrefs);
        page.scope.changed();
        return;
      }
      savePreferences(page.preferences);
      page.applyPreferences();
      if (document.body.dataset.view === "arcade") page.renderArcade();
    },
    audition: () => page.sound.audio.play("ui_tap"),
    currentCamera: () => {
      // The choice made, unless that camera has gone: then the one in use.
      const chosen = chosenCamera();
      if (chosen && (!camera.cameras.length || camera.cameras.some((listed) => listed.deviceId === chosen))) return chosen;
      return camera.inUse() ?? chosen ?? remembered();
    },
    chooseCamera: (deviceId) => {
      chooseCamera(deviceId);
      // At the arcade the choice is for the next Play: a camera still open
      // from before is let go, so that one opens the chosen camera.
      if (!page.inGame() && camera.camera && camera.camera.deviceId !== deviceId) camera.release();
    },
    hasSavedAim: () => hasSavedAim(),
    forgetSavedAim: () => {
      forgetSavedAims();
      page.renderArcade();
    },
    reset: () => page.reset(),
    systemInfo: async () => systemFacts(page.host(), camera, page.latency),
    eyeTest: (listener, video) => runEyeTest(camera, listener, video, () => page.scope.readFacesForRound()),
  };
}

/** What a bug report needs to know: the browser, the graphics, the timings. Nothing personal. */
function systemFacts(host: EngineHost | null, camera: HandCamera, latency: Samples): SystemFacts {
  let gpu = host?.gpu ?? null;
  if (!gpu) {
    // No game yet: ask a throwaway context, and let it go at once.
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (gl) {
      gpu = gpuName(gl);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
  const run = host?.stats.summary() ?? null;
  const frames = run && run.frames > 0 ? run : null;
  const tracker = camera.tracker;
  const toCrosshair = latency.summary();
  return {
    version: VERSION,
    userAgent: navigator.userAgent,
    gpu,
    tracker: tracker ? { where: tracker.where, delegate: tracker.delegate } : null,
    frames: frames ? { interval: frames.interval, work: frames.work } : null,
    latency: toCrosshair.p50 > 0 ? toCrosshair : null,
    quality: host ? { tier: host.quality.tier, scale: host.quality.scale } : null,
    screen: {
      width: screen.width,
      height: screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
    },
  };
}
