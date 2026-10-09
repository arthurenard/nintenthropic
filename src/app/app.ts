/**
 * The app: first run, the arcade, and a game's whole life - the camera's
 * question, getting ready with real progress, the aim check in the game's own
 * world, play, pause, results - with calm words for anything that goes wrong.
 */
import type { AudioEngine } from "../audio/index";
import { browserStore, loadAim, saveAim, type CameraIdentity } from "../calibration/storage";
import { DownloadError, Progress } from "../engine/fetch";
import { IDLE_AIM, WebGLUnavailable } from "../engine/common";
import type { EngineHost } from "../engine/host";
import { seededRandom } from "../engine/random";
import { Samples } from "../engine/stats";
import { gpuName } from "../engine/tier";
import type { Aim, Game, GameContext, GameEntry, GameStats, InputKind, InputSource, Settings } from "../engine/types";
import { ARCADE, GRIP_PRIX, playable, playableGames } from "../games/index";
import { AimController } from "../input/aim";
import { HandInput } from "../input/handInput";
import type { Matrix } from "../input/homography";
import { MouseInput, TouchInput } from "../input/pointer";
import { EYE_SCOPE, EyeScope, FACE_EVERY, ScopeControl, scopeKeys, scopeMouse, type EyeView } from "../input/scope";
import type { ScriptedHands } from "../input/script";
import { CameraError, cameraPermission, chooseCamera, chosenCamera, listCameras, openCamera, remembered, type Camera, type CameraInfo, type CameraTrouble } from "../tracking/camera";
import { ModelError } from "../tracking/errors";
import type { Tracker } from "../tracking/tracker";
import type { HandSource } from "../tracking/types";
import { $, announce, icon, replay, setText, toast } from "../ui/dom";
import { formatScore } from "../ui/format";
import { AimCheckView } from "./aimCheckView";
import { HeroArt, pickGame, posterInto, Shelf, shooters } from "./arcade";
import { Crosshair } from "./crosshair";
import { FireToPlay, HandWatch, type HandWatchEvent } from "./handWatch";
import { switchCamera } from "./cameraSwitch";
import { Hud } from "./hud";
import { watchKonami } from "./konami";
import { gestureInto, Landing } from "./landing";
import { Pip } from "./pip";
import { Yielding, type Spot } from "./yielding";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_SCOPE,
  controlClass,
  forgetEverything,
  forgetSavedAims,
  hasSavedAim,
  loadEyeProfile,
  loadPreferences,
  loadScopePreferences,
  prefs,
  readBest,
  saveEyeProfile,
  savePreferences,
  saveScopePreferences,
  tipsSeen,
  type PersistentSet,
  type Preferences,
  type ScopePreferences,
} from "./prefs";
import { difficultyLabel, recordRound, shareResult, showResults, type Result } from "./results";
import { hashFor, parseRoute, type Route } from "./route";
import { SettingsSheet, VERSION, type EyeTestState, type SettingsHost, type SystemFacts } from "./settings";
import { LoadingSheet, closeSheet, closeSheets, openSheet, showTrouble, type Fix, type Trouble } from "./sheets";

export interface AppOptions {
  /** A scripted hand instead of the camera and tracker (dev and test builds only). */
  scripted?: ScriptedHands | null;
  /** Trouble to simulate, for screenshots of every error (dev and test builds only). */
  fail?: string | null;
  /** Where the hand tracker runs: a worker unless told otherwise. */
  trackerWhere?: "auto" | "worker" | "page";
  /** Which delegate the tracker tries first. */
  trackerDelegate?: "GPU" | "CPU";
}

type Phase = "loading" | "check" | "play" | "over";

interface Session {
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
  /** When a camera frame last reached the page, performance.now() ms. */
  frameAt: number;
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

/** No new camera frame for this long, with the camera running, is a camera that has stopped, ms. */
const CAMERA_STALL = 3000;
/** How long after the results arrive the world stops drawing under them, ms. */
const RESULTS_SETTLE = 2000;
/** How long the results listen for a fold of the thumb before the camera rests, ms. */
const FIRE_LISTENS = 60_000;

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

type Sound = Pick<AudioEngine, "play" | "loop" | "setFilter" | "setMuted" | "muted" | "setVolume" | "volume">;

/** Silence, until the sound engine arrives with the first gesture. */
function silence(muted: boolean): Sound {
  let quiet = muted;
  let level = 1;
  return {
    get muted() {
      return quiet;
    },
    get volume() {
      return level;
    },
    play() {},
    loop: () => () => {},
    setFilter() {},
    setMuted(value: boolean) {
      quiet = value;
    },
    setVolume(value: number) {
      level = value;
    },
  };
}

const touchOnly = () => matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
/** Any touch screen at all (a hybrid laptop too): the Scope button is for a player with no Shift to hand. */
const touchCapable = () => matchMedia("(any-pointer: coarse)").matches;
/** The face out of view this long, ms, before the player has scoped: the page says so, for this long after. */
const FACE_AWAY = 6000;
const FACE_AWAY_SAID = 8000;

export class App {
  readonly hud: Hud;
  private readonly crosshair = new Crosshair($<HTMLCanvasElement>("crosshair"), () => this.settings.reducedMotion);
  private readonly pip = new Pip();
  private readonly yielding = new Yielding($("stage"), ["pip", "check-card", "check-meter", "hud-score", "cylinder", "magazine", "heat", "clock", "hint", "eye-meter"]);
  /** How the last aim check ended, for the tests. */
  private lastCheck: { score: number | null; shots: number; ended: "ready" | "anyway" } | null = null;
  private readonly settings: Settings;
  /** The player's choices in Settings, as saved; `settings` is what the game reads. */
  private readonly preferences: Preferences = loadPreferences();
  private readonly tips: PersistentSet = tipsSeen();
  /** How the player scopes, in the games with a scope (Settings' Scope group). */
  private readonly scopePrefs: ScopePreferences = loadScopePreferences();
  private readonly settingsSheet: SettingsSheet;
  private host: EngineHost | null = null;
  private audio: Sound = silence(prefs.muted);
  private audioReady: Promise<void> | null = null;
  private tracker: Tracker | null = null;
  private camera: Camera | null = null;
  /** The cameras the browser lists (Switch Camera shows when there are two or more). */
  private cameras: CameraInfo[] = [];
  /** A switch to another camera is under way: the gap with no camera is not a camera that has gone. */
  private switching = false;
  private session: Session | null = null;
  private control: InputKind;
  private generation = 0;
  private busy = false;
  private muted = prefs.muted;
  /** The game chosen in the arcade: the hero, and the one Play plays. */
  private selected: GameEntry;
  /** The games the arcade lists: the shooters (Grip Prix is a page of its own, a tile of the landing). */
  private readonly shooting: GameEntry[];
  private readonly shelf: Shelf;
  private readonly hero: HeroArt;
  private readonly landing: Landing;
  /** Where the page is, as its address says: the landing, or the arcade on a game. */
  private route: Route;
  private readonly motion = matchMedia("(prefers-reduced-motion: reduce)");
  /** Camera capture to crosshair drawn, ms: for the performance report. */
  private readonly latency = new Samples(600);
  private lastDrawnCapture = 0;
  /** Frames are being read from the camera (or the script). */
  private tracking = false;
  /** The small loop that watches for the hand while the world is held. */
  private holdLoop = 0;

  constructor(private readonly options: AppOptions = {}) {
    this.settings = {
      duration: 60,
      reducedMotion: this.preferences.reduceMotion ?? this.motion.matches,
      reducedFlashing: this.preferences.reduceFlashing,
      difficulty: this.preferences.difficulty,
      aimAssist: this.preferences.aimAssist,
      unlocks: prefs.unlocks,
      tipsSeen: this.tips,
      scope: { eye: false, button: this.scopePrefs.button },
    };
    // Reduce Motion follows the system until the player chooses for themselves.
    this.motion.addEventListener("change", () => this.applyMotion());
    this.hud = new Hud(() => this.settings.reducedMotion);
    this.hud.onGameOver = (stats) => this.roundOver(stats);
    // A game's own reticle (a scope's picture) in place of the page's crosshair.
    this.hud.onCrosshair = (style) => {
      this.crosshair.hiddenByGame = style === "none";
      if (style === "none") this.crosshair.clear();
    };
    // A fallen player has no gun: a crosshair over the death scene read as
    // one still to be fired.
    this.hud.onPlayerDown = () => {
      this.crosshair.visible = false;
      this.crosshair.clear();
      // The death plays out as it is: no waiting for a hand that has nothing left to do.
      if (this.session) this.session.down = true;
      this.hud.pageHint(null);
    };
    this.control = options.scripted ? "hand" : touchOnly() && prefs.control === "mouse" ? "touch" : prefs.control;
    this.shooting = shooters(ARCADE);
    this.route = parseRoute(location, this.shooting);
    this.selected = pickGame(this.shooting, this.route.space === "arcade" ? this.route.game : null, prefs.game)!;
    this.shelf = new Shelf($("shelf"), this.shooting, (game, how) => this.choose(game, how));
    this.hero = new HeroArt($("feature-frame"));
    this.landing = new Landing(this.shooting, GRIP_PRIX);
    this.settingsSheet = new SettingsSheet(this.settingsHost());
    this.applyPreferences();
    this.wire();
  }

  // --- the arcade -----------------------------------------------------------------

  boot(): void {
    this.renderArcade();
    this.setMuted(this.muted);
    for (const figure of document.querySelectorAll<HTMLElement>("#welcome [data-gesture]")) {
      gestureInto(figure, figure.dataset.gesture === "wheel" ? "wheel" : "pistol");
    }
    if (prefs.welcomed) this.arrive(this.route, { remembered: true });
    else this.showView("welcome");
    // The first screen needs neither three.js nor the tracker; fetch them
    // once it is up, so Play does not wait for them.
    const later = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
    later(() => {
      void import("../engine/host");
      void import("../tracking/tracker");
    });
  }

  private showView(name: "welcome" | "landing" | "arcade" | "game"): void {
    const opened = document.body.dataset.view !== name;
    for (const view of ["welcome", "landing", "arcade", "game"] as const) $(view).hidden = view !== name;
    // The bar is over the landing and the arcade; a game and the welcome have their own chrome.
    $("nav").hidden = name !== "landing" && name !== "arcade";
    document.body.dataset.view = name;
    if (name === "landing") this.landing.show();
    else this.landing.hide();
    if (name === "arcade") this.shelf.reveal(false);
    // A screen opens at its top, wherever the last one was scrolled to.
    if (opened && (name === "landing" || name === "arcade")) window.scrollTo(0, 0);
  }

  /** The address for a route: the page's own, with the game and the space it names changed and nothing else. */
  private addressFor(route: Route): string {
    const search = new URLSearchParams(location.search);
    search.delete("game");
    const query = search.toString();
    return `${location.pathname}${query ? `?${query}` : ""}${hashFor(route, this.selected)}`;
  }

  /**
   * Turns to a space. `remembered` is the page just opened: it stands where
   * the player last was, without taking the focus (except to give Grip Prix's
   * tile back to a player who is coming home from it).
   */
  private arrive(route: Route, { remembered = false }: { remembered?: boolean } = {}): void {
    this.route = route;
    if (route.space === "arcade") {
      const named = route.game ? this.shooting.find((game) => game.id === route.game) : undefined;
      if (named && named !== this.selected) {
        this.selected = named;
        replay($("feature-text"), "fresh");
      }
      prefs.game = this.selected.id;
      prefs.space = "arcade";
      this.renderArcade();
      this.showView("arcade");
      // The address names the game the arcade is on, whichever way it was reached.
      const address = this.addressFor(route);
      if (address !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, "", address);
      if (!remembered) $("play").focus({ preventScroll: true });
      return;
    }
    this.showView("landing");
    // Standing where the player was: sent to a tile by the address, back from Grip Prix, or back from the arcade.
    const tile = route.focus ?? (remembered && prefs.space !== "grip-prix" ? null : prefs.space);
    if (tile) this.landing.focus(tile);
  }

  /** A step in the browser's history to a space (the browser's Back comes back from it). */
  private navigate(route: Route): void {
    const address = this.addressFor(route);
    if (address !== `${location.pathname}${location.search}${location.hash}`) history.pushState(null, "", address);
    this.arrive(route);
  }

  private renderArcade(): void {
    this.sayWhoReadsTheEye();
    const entry = this.selected;
    this.shelf.show(entry);
    setText("feature-title", entry.title);
    setText("feature-about", entry.about ?? entry.blurb);
    // The game's poster, full-bleed; its light stands in until it loads, or while there is none.
    this.hero.show(entry);
    // A game still to come is named and described, and cannot be played.
    const here = playable(entry);
    $("feature-actions").hidden = !here;
    $("start-control").hidden = !here;
    $("feature-soon").hidden = here;
    const label = $("control-label");
    const hand = this.control === "hand";
    label.replaceChildren(icon(hand ? "hand" : "mouse"), hand ? "Finger Pistol" : this.control === "touch" ? "Touch" : "Mouse or Trackpad");
    setText("switch-control", hand ? (touchOnly() ? "Use Touch" : "Use Mouse or Trackpad") : "Use Finger Pistol");
    $("switch-control").hidden = !!this.options.scripted;
    $("adjust").hidden = !(here && hand && hasSavedAim());
    $<HTMLButtonElement>("play").disabled = this.busy;
    this.syncDifficulty();
    this.renderBest();
  }

  /** The privacy sheet names the games that read an eye (for the scope), and says nothing of it when none does. */
  private sayWhoReadsTheEye(): void {
    const names = ARCADE.filter((game) => game.uses?.eye).map((game) => game.title);
    const line = $("privacy-eye");
    line.hidden = names.length === 0;
    if (!names.length) return;
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    setText(
      line,
      `In ${list} it also reads whether one of your eyes is closed, for the scope: only that, only in ${names.length > 1 ? "those games" : "that game"}, and in Settings’ Eye Test when you start it. Nothing leaves this computer.`,
    );
  }

  /** The best to beat with this control at this difficulty, under the Play button; nothing before there is one. */
  private renderBest(): void {
    const difficulty = this.preferences.difficulty;
    const best = playable(this.selected) ? readBest(this.selected.id, difficulty, controlClass(this.control)) : null;
    const line = $("home-best");
    line.hidden = !best;
    if (!best) return;
    const level = difficultyLabel(difficulty);
    setText(line, `${level ? `Your best on ${level}` : "Your best"}: ${formatScore(best.score)}${best.outcome ? ` · ${best.outcome}` : ""}`);
  }

  /**
   * A game chosen in the row: it becomes the hero, is remembered, and is the
   * page's address (#dead-of-night), so the link passes the game on. In a
   * narrow window, where the hero is above the row, a click brings it into view.
   */
  private choose(game: GameEntry, how: "click" | "key" | "link" = "click"): void {
    const changed = game !== this.selected;
    this.selected = game;
    prefs.game = game.id;
    if (location.hash !== `#${game.id}`) history.replaceState(history.state, "", `#${game.id}`);
    if (changed) {
      replay($("feature-text"), "fresh");
      this.renderArcade();
    }
    this.shelf.reveal(!this.settings.reducedMotion);
    if (how === "click" && $("feature").getBoundingClientRect().top < 0) {
      $("feature").scrollIntoView({ behavior: this.settings.reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }

  private setControl(control: InputKind): void {
    this.control = control;
    if (control !== "touch") prefs.control = control;
    else prefs.control = "mouse";
    this.renderArcade();
  }

  // --- sound ---------------------------------------------------------------------------

  /**
   * Browsers start audio only after a gesture, so the sound engine is made on
   * the page's first click or key press (and at the latest on Play). Made
   * once; the interface's sounds start synthesising at once, off the page.
   * Its code is fetched then too: the first screen does not wait for it.
   */
  private wakeAudio(): Promise<void> {
    const volume = () => this.preferences.volume;
    this.audioReady ??= import("../audio/index").then(({ createAudioBus }) => createAudioBus({ muted: this.muted, volume: volume() })).then(
      (audio) => {
        this.audio = audio;
        audio.setMuted(this.muted);
        audio.setVolume(volume());
      },
      (error: unknown) => console.warn("Sound is unavailable.", error),
    );
    return this.audioReady;
  }

  private setMuted(muted: boolean): void {
    this.muted = muted;
    prefs.muted = muted;
    this.audio.setMuted(muted);
    for (const id of ["mute", "sheet-mute"]) {
      $(id).setAttribute("aria-pressed", String(muted));
      $(id).setAttribute("aria-label", muted ? "Unmute" : "Mute");
    }
  }

  // --- starting a game -----------------------------------------------------------------

  /** Before the browser asks for the camera, say why. Resolves the control to use, or null to stay. */
  private async cameraReady(eye: boolean): Promise<InputKind | null> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.trouble("insecure");
      return null;
    }
    const permission = await cameraPermission();
    if (permission === "denied") {
      this.trouble("denied");
      return null;
    }
    if (permission === "granted" || prefs.cameraOpened) return "hand";
    setText(
      "prime-body",
      eye
        ? "Handy needs your camera to see your hand, and in this game whether one eye is closed. The picture stays on this computer."
        : "Handy needs your camera to see your hand. The picture stays on this computer.",
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

  /** The renderer, made on the first game: three.js arrives only then. */
  private async ensureHost(): Promise<EngineHost> {
    if (this.options.fail === "webgl") throw new WebGLUnavailable();
    if (!this.host) {
      const { EngineHost } = await import("../engine/host");
      this.host = new EngineHost($<HTMLCanvasElement>("world"));
      this.host.onContextLost = () => {
        this.endSession();
        this.trouble("context");
      };
    }
    return this.host;
  }

  async start({ adjust = false }: { adjust?: boolean } = {}): Promise<void> {
    const entry = this.selected;
    if (this.busy || !playable(entry)) return;
    this.busy = true;
    this.renderArcade();
    const run = ++this.generation;
    const stale = () => run !== this.generation;
    let loading: LoadingSheet | null = null;
    let game: Game | null = null;
    try {
      await this.wakeAudio();
      if (this.control === "hand" && !this.options.scripted && !this.camera) {
        const control = await this.cameraReady(this.readsEye(entry, "hand"));
        if (control === null || stale()) return;
        if (control !== "hand") this.setControl(control);
      }
      const host = await this.ensureHost();
      if (stale()) return;
      const control = this.control;
      const hand = control === "hand";
      this.openGameView(entry, control);
      // The face landmarker, the first time a game that reads the eye is played with the hand.
      const eye = this.readsEye(entry, control) && !this.options.scripted;
      const firstTime = hand && !this.options.scripted && ((!this.tracker && !prefs.downloaded) || (eye && !this.tracker?.hasFace));
      loading = new LoadingSheet(firstTime);
      const sheet = loading;
      const progress = new Progress((fraction) => sheet.set(fraction));

      const work: Promise<unknown>[] = [];
      if (hand && !this.options.scripted) {
        if (!this.camera) work.push(tagged("camera", this.openCamera()));
        if (!this.tracker) {
          const wasm = progress.part("wasm", 12);
          const model = progress.part("model", 8);
          const face = eye ? progress.part("face", 4) : undefined;
          work.push(
            tagged(
              "tracker",
              this.options.fail === "model"
                ? Promise.reject(new ModelError())
                : import("../tracking/tracker")
                    .then(({ loadTracker }) =>
                      loadTracker(
                        { wasm, model, ...(face ? { face } : {}) },
                        { where: this.options.trackerWhere ?? "auto", prefer: this.options.trackerDelegate ?? "GPU", face: eye },
                      ),
                    )
                    .then((tracker) => {
                      if (stale()) tracker.dispose();
                      else this.tracker = tracker;
                    }),
            ),
          );
        } else if (eye && !this.tracker.hasFace) {
          // The eye is a help, not a need: a face that will not load leaves Shift to scope.
          work.push(this.tracker.addFace(progress.part("face", 4)).catch((error: unknown) => console.warn("The face landmarker did not load.", error)));
        }
      }
      const gamePart = progress.part("game", hand && !this.tracker && !this.options.scripted ? 10 : 1);
      const context = this.context(host, control);
      const loaded = tagged(
        "game",
        (async () => {
          const created = await entry.create();
          game = created;
          if (this.options.fail === "game") throw new DownloadError("game", 404);
          await created.load(context, gamePart);
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
      const ready = await loaded;
      if (stale()) {
        ready.dispose();
        return;
      }
      loading.close();
      if (hand && !this.options.scripted) prefs.downloaded = true;
      this.begin(entry, ready, context, adjust);
    } catch (error) {
      loading?.close();
      if (stale()) return;
      this.fail(error);
    } finally {
      if (run === this.generation) this.busy = false;
      this.renderArcade();
    }
  }

  private async openCamera(): Promise<void> {
    const failure = this.options.fail;
    if (failure?.startsWith("camera-")) throw new CameraError(failure.slice(7) as CameraTrouble);
    const camera = await openCamera($<HTMLVideoElement>("camera"));
    prefs.cameraOpened = true;
    this.camera = camera;
    camera.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.camera !== camera) return;
      this.camera = null;
      this.cameraEnded();
    });
  }

  /**
   * The camera went (unplugged, or taken by the system) during a game. The
   * round is not lost with it: it freezes under a sheet that offers the
   * camera again, the mouse, or the arcade. On the results there is nothing
   * to freeze, only a fold of the thumb that can no longer be seen.
   */
  private cameraEnded(): void {
    const session = this.session;
    if (!session || session.control !== "hand" || this.switching) return;
    if (session.phase === "over") this.stopListening(session, true);
    else if (session.phase === "check" || session.phase === "play") this.cameraTrouble(session, "stopped");
  }

  private context(host: EngineHost, control: InputKind): GameContext {
    return {
      renderer: host.renderer,
      canvas: host.canvas,
      audio: this.audio,
      hud: this.hud,
      assets: host.assets,
      settings: this.settings,
      quality: host.quality,
      random: seededRandom((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0),
      clock: () => new Date(),
      input: control,
    };
  }

  private fail(error: unknown): void {
    const part = error instanceof Stage ? error.part : null;
    const cause = error instanceof Stage ? error.error : error;
    console.error("Handy could not start the game.", cause);
    this.endSession();
    this.showView("arcade");
    if (cause instanceof WebGLUnavailable) this.trouble("webgl");
    else if (cause instanceof CameraError) this.trouble(cause.trouble);
    // Anything else that failed with the browser offline was a download (a
    // file, or a piece of the page's own code): say so, it is the one fix
    // that matters. The mouse helps only if it was the hand's download.
    else if (navigator.onLine === false) {
      this.trouble("offline", { secondary: part === "tracker" ? "Use Mouse or Trackpad" : "Choose a Game" });
    } else if (part === "tracker" || cause instanceof ModelError) this.trouble("model");
    else this.trouble("game");
  }

  private trouble(kind: Trouble, choices?: { secondary?: Fix | null; tertiary?: Fix | null }): void {
    const fixes: Record<Fix, () => void> = {
      "Try Again": () => void this.start(),
      "Use Mouse or Trackpad": () => {
        this.releaseCamera();
        this.setControl(touchOnly() ? "touch" : "mouse");
        void this.start();
      },
      "Choose a Game": () => this.back(),
      Reload: () => location.reload(),
    };
    showTrouble(kind, fixes, choices);
  }

  // --- a game's life ---------------------------------------------------------------------

  private openGameView(entry: GameEntry, control: InputKind): void {
    const view = $("game");
    view.dataset.phase = "loading";
    view.dataset.ready = "false";
    view.dataset.input = control;
    view.dataset.game = entry.id;
    view.setAttribute("aria-label", entry.title);
    $("world").setAttribute("aria-label", entry.title);
    // The stage's shape the game's art can hold: never taller than 1 : min, never wider than max : 1.
    const stage = $("stage");
    stage.style.setProperty("--min-aspect", String(entry.stage?.minAspect ?? 1.1));
    if (entry.stage?.maxAspect) stage.style.setProperty("--max-aspect", String(entry.stage.maxAspect));
    else stage.style.removeProperty("--max-aspect");
    // While the game gets ready, its poster (or its light) waits behind the loading sheet.
    posterInto($("curtain"), $<HTMLImageElement>("curtain-art"), entry);
    this.hud.reset(this.settings.unlocks.has("golden"));
    this.crosshair.visible = false;
    this.crosshair.clear();
    this.showView("game");
    window.scrollTo({ top: 0 });
    view.focus();
  }

  private handSource(): HandSource {
    return this.options.scripted ?? this.tracker!;
  }

  /** Which camera is playing: its aim is saved and found by this. */
  private cameraIdentity(): CameraIdentity | null {
    if (this.options.scripted) return { deviceId: this.options.scripted.deviceId, width: 1280, height: 720 };
    return this.camera ? { deviceId: this.camera.deviceId, width: this.camera.width, height: this.camera.height } : null;
  }

  private begin(entry: GameEntry, game: Game, context: GameContext, adjust: boolean): void {
    const host = this.host!;
    const control = context.input ?? "hand";
    const stage = $("stage");
    const viewport = () => ({ width: stage.clientWidth, height: stage.clientHeight });
    let input: InputSource & { reset(): void };
    let hand: HandInput | null = null;
    // The scope, in a game with one: Shift, the right button or the Scope
    // button, and - with the hand, in a game that reads it - the eye.
    const uses = entry.uses ?? {};
    const scope = uses.scope ? new ScopeControl(this.scopePrefs.button, control === "hand" && uses.eye ? this.newEye() : null) : null;
    if (scope) {
      scope.useEye = this.scopePrefs.eye;
      scope.onChange = () => $("scope-button").setAttribute("aria-pressed", String(scope.buttons));
    }
    if (control === "hand") {
      hand = new HandInput(this.handSource(), viewport, undefined, scope);
      input = hand;
    } else {
      input = control === "touch" ? new TouchInput(stage, scope) : new MouseInput(stage, scope);
      this.pip.hide();
    }
    const session: Session = {
      entry,
      game,
      context,
      control,
      input,
      hand,
      check: null,
      phase: "loading",
      paused: false,
      held: false,
      troubled: false,
      down: false,
      idle: false,
      watch: new HandWatch(performance.now()),
      frameAt: performance.now(),
      camera: hand ? this.cameraIdentity() : null,
      unsubscribe: () => {},
      lostSince: null,
      noteUntil: 0,
      result: null,
      fire: null,
      timers: [],
      scope,
      // Shift scopes in every game with a scope; the right button too, with the hand (a pointer does it itself).
      stopScopeKeys: scope ? scopeKeys(scope) : () => {},
      stopScopeMouse: scope && control === "hand" ? scopeMouse(scope, stage) : () => {},
      scoped: false,
      faceAway: null,
    };
    if (hand) {
      const source = this.handSource();
      session.unsubscribe = source.subscribe((frame) => {
        session.frameAt = performance.now();
        this.pip.draw(frame, session.frameAt);
      });
      this.pip.show(!this.options.scripted);
    }
    this.session = session;
    this.scopeFor(session);
    if (hand) this.startTracking();
    void this.refreshCameras();
    host.setGame(game);
    host.onFrame = ({ now, aim }) => this.frame(session, now, aim);
    this.round(session, adjust);
    host.start();
    requestAnimationFrame(() => ($("game").dataset.ready = "true"));
  }

  /** A round of the session's game: the aim check first with the hand, then play. */
  private round(session: Session, adjust: boolean): void {
    const host = this.host!;
    const hand = session.hand;
    const camera = session.camera;
    if (hand && camera) {
      const stage = $("stage");
      const saved = adjust ? null : loadAim(browserStore(), camera, session.entry.id);
      session.phase = "check";
      session.check = new AimCheckView({
        stage: session.game.calibration,
        input: hand,
        saved,
        viewport: () => ({ width: stage.clientWidth, height: stage.clientHeight }),
        reducedMotion: () => this.settings.reducedMotion,
        onDone: (mapping, score) => {
          this.lastCheck = { score, shots: session.check?.check.shots ?? 0, ended: "ready" };
          if (!saveAim(browserStore(), camera, mapping, Date.now(), session.entry.id)) toast("This window can’t save your aim. It works until you close it.");
          this.play(session, mapping);
        },
        onPlayAnyway: (mapping) => {
          const check = session.check?.check;
          this.lastCheck = { score: check?.measure.score ?? null, shots: check?.shots ?? 0, ended: "anyway" };
          this.play(session, mapping);
          // The crosshair has not been shown yet: it appears with the game, and the hint says what it is.
          if (this.session !== session || session.phase !== "play") return;
          // Said as the page's own hint (see frame): the game's first tips, on the game's line, would take the words away at once.
          session.noteUntil = performance.now() + 3500;
        },
      });
      // The check judges its shots; the game sees them too, to answer with
      // the gun's sound and smoke (it scores nothing before start()). While
      // the aim is learned the game is told it rests on the lit target (see
      // AimCheckView.aimFor): nothing it draws follows the unfinished aim.
      host.aim = (now) => {
        const aim = hand.sample(now);
        return session.check ? session.check.aimFor(aim) : aim;
      };
      announce(`${session.entry.title}. Aim setup. ${session.check.spoken}`);
    } else {
      host.aim = (now) => session.input.sample(now);
      this.play(session, null);
    }
    $("game").dataset.phase = session.phase;
  }

  private play(session: Session, mapping: Matrix | null): void {
    // Once: the check's ready moment may end after the round already began
    // (the player switched to the mouse under it).
    if (this.session !== session || session.phase === "play") return;
    session.check?.dispose();
    session.check = null;
    if (mapping && session.hand) session.hand.setMapping(mapping);
    session.phase = "play";
    $("game").dataset.phase = "play";
    session.game.start();
    session.watch.watch(performance.now());
    this.host!.aim = (now) => session.input.sample(now);
    this.crosshair.visible = true;
    if (session.control !== "hand") this.pointerHint(session);
  }

  /** How a pointer fires, said for the first seconds with it. */
  private pointerHint(session: Session): void {
    this.hud.hint(session.control === "touch" ? "Tap to fire." : "Click to fire.");
    window.setTimeout(() => this.session === session && this.hud.hint(null), 3500);
  }

  /** Every animation frame, after the game has drawn. */
  private frame(session: Session, now: number, aim: Aim): void {
    if (session.phase === "check" && session.check) {
      session.check.frame();
      this.crosshair.visible = session.check.showsCrosshair;
    }
    const stage = $("stage");
    const [width, height] = [stage.clientWidth, stage.clientHeight];
    const lit = session.check && !session.check.done ? session.check.check.lit : null;
    const target = lit ? { x: lit.x * width, y: lit.y * height, r: lit.radius * Math.min(width, height) } : null;
    this.crosshair.draw(aim, now, target);
    // The corners' chrome steps aside for what the player is aiming at.
    const spots: Spot[] = [];
    if (this.crosshair.visible && aim.tracking && !aim.offscreen) spots.push({ x: aim.x * width, y: aim.y * height, r: 28 });
    if (target) spots.push(target);
    this.yielding.update(spots);
    this.watchEye(session, now, aim);
    // How long a camera frame takes to reach the crosshair: from its capture
    // to the moment the crosshair is drawn from it (the screen shows that
    // frame at the next vsync). Measured on the clock, not the frame's own
    // timestamp, which is taken before a frame's work begins.
    if (aim.tracking && aim.capturedAt !== this.lastDrawnCapture) {
      this.lastDrawnCapture = aim.capturedAt;
      if (aim.capturedAt > 0) this.latency.push(performance.now() - aim.capturedAt);
    }
    if (this.cameraStopped(session, now)) return;
    if (session.phase === "play" && session.control === "hand" && !session.down) {
      // A hand lost in play is said after a moment - unless it left the
      // picture across an edge, which is the reload - and a hand gone for
      // longer holds the round until it is back (see handWatch.ts).
      if (!aim.tracking && !aim.offscreen) session.lostSince ??= now;
      else session.lostSince = null;
      const note = now < session.noteUntil ? "The crosshair now follows your finger." : null;
      this.hud.pageHint(session.lostSince !== null && now - session.lostSince > 600 ? "Show your hand to the camera." : (this.faceAwayHint(session, now) ?? note));
      const event = session.watch.update(now, aim.tracking);
      if (event) this.onWatch(session, event);
    }
  }

  // --- the round held for the hand -------------------------------------------------------

  /** What the hand watch decided: hold the round, ask for the hand, count, carry on. */
  private onWatch(session: Session, event: HandWatchEvent): void {
    switch (event.type) {
      case "hold":
        this.hold(session);
        this.showHold("lost");
        announce("Show your hand to carry on. The round waits for you.");
        break;
      case "ask":
        this.showHold("lost");
        announce("Show your hand to carry on.");
        break;
      case "count":
        this.showHold("count", event.beat);
        if (event.beat === 3) announce("Get ready.");
        break;
      case "go":
        this.release(session);
        break;
    }
  }

  /**
   * Freezes the round - the world stops, as for a pause - while the camera
   * goes on looking for the hand. The corners' chrome stays, the preview
   * grows so the player can see themselves, and a small loop watches for the
   * hand, since the world's own loop is stopped.
   */
  private hold(session: Session): void {
    session.held = true;
    session.lostSince = null;
    this.host?.pause();
    this.crosshair.visible = false;
    this.crosshair.clear();
    this.hud.pageHint(null);
    this.yielding.reset();
    if (!this.holdLoop) this.holdLoop = requestAnimationFrame(this.holdTick);
  }

  private readonly holdTick = (now: number): void => {
    const session = this.session;
    if (!session || !session.held || session.paused || session.troubled) {
      this.holdLoop = 0;
      return;
    }
    this.holdLoop = requestAnimationFrame(this.holdTick);
    if (this.cameraStopped(session, now)) return;
    const event = session.watch.update(now, session.input.sample(now).tracking);
    if (event) this.onWatch(session, event);
  };

  /** The hand is back and the count is done: the round carries on. */
  private release(session: Session): void {
    session.held = false;
    this.showHold(null);
    // Nothing held from before: no stale fold fires as the world starts.
    session.input.reset();
    this.crosshair.visible = !session.down;
    this.host?.resume();
  }

  /** The hold on screen: nothing, the dimmed world alone, the card asking for the hand, or a beat of the count. */
  private showHold(state: "wait" | "lost" | "count" | null, beat = 0): void {
    const game = $("game");
    if (state) game.dataset.hold = state;
    else delete game.dataset.hold;
    if (state === "count") {
      const numeral = $("hold-beat");
      setText(numeral, String(beat));
      numeral.className = "";
      replay(numeral, this.settings.reducedMotion ? "beat-calm" : "beat");
    }
  }

  private stopHold(session: Session): void {
    session.held = false;
    cancelAnimationFrame(this.holdLoop);
    this.holdLoop = 0;
    this.showHold(null);
  }

  // --- the camera stopping mid-game ----------------------------------------------------------

  /** When a camera frame last arrived: counted by the tracker as frames arrive, before it reads them. */
  private lastCameraFrame(session: Session): number {
    return Math.max(session.frameAt, this.options.scripted ? 0 : (this.tracker?.frameAt ?? 0));
  }

  /**
   * A hand game whose camera is gone, or running but silent for three
   * seconds (asleep, covered by the system, a driver that gave up), cannot
   * be played: said at once, with the round frozen. Returns whether it was.
   */
  private cameraStopped(session: Session, now: number): boolean {
    if (session.control !== "hand" || session.troubled || session.paused || this.switching) return false;
    if (session.phase !== "check" && session.phase !== "play") return false;
    if (!this.options.scripted && !this.camera) {
      this.cameraTrouble(session, "stopped");
      return true;
    }
    if (this.tracking && now - this.lastCameraFrame(session) > CAMERA_STALL) {
      this.cameraTrouble(session, "stalled");
      return true;
    }
    return false;
  }

  /** The round frozen under the camera's trouble, with the fixes that keep it. */
  private cameraTrouble(session: Session, kind: Trouble): void {
    this.stopHold(session);
    session.troubled = true;
    session.paused = false; // the sheet replaces the pause menu, if it was up
    this.host?.pause();
    this.stopTracking();
    this.crosshair.visible = false;
    this.crosshair.clear();
    this.hud.pageHint(null);
    this.pip.calm();
    this.showHold("wait");
    const fixes: Record<Fix, () => void> = {
      "Try Again": () => void this.reopenCamera(session),
      "Use Mouse or Trackpad": () => this.continueWithPointer(session),
      "Choose a Game": () => this.back(),
      Reload: () => location.reload(),
    };
    // The sheet is a dialog: opening it says its title and words to a screen reader.
    showTrouble(kind, fixes, { secondary: "Use Mouse or Trackpad", tertiary: "Choose a Game" });
  }

  /**
   * Try Again, mid-game: the camera once more. The same camera keeps the
   * round and its aim - back through the wait for the hand and the count;
   * another camera needs its own aim, so the round starts afresh with the
   * aim check.
   */
  private async reopenCamera(session: Session): Promise<void> {
    if (this.session !== session) return;
    const before = session.camera;
    this.releaseCamera();
    try {
      if (!this.options.scripted) await this.openCamera();
    } catch (error) {
      if (this.session !== session) return;
      console.warn("The camera could not be opened again.", error);
      this.cameraTrouble(session, error instanceof CameraError ? error.trouble : "busy");
      return;
    }
    if (this.session !== session) return;
    session.troubled = false;
    const now = this.cameraIdentity();
    if (before && now && (now.deviceId !== before.deviceId || now.width !== before.width || now.height !== before.height)) {
      session.camera = now;
      this.again(session, false);
      return;
    }
    this.startTracking();
    if (session.phase === "play" && !session.down) {
      this.hold(session);
      session.watch.hold(performance.now());
      this.showHold("wait");
    } else {
      this.showHold(null);
      this.crosshair.visible = session.phase === "play" && !session.down;
      this.host?.resume();
    }
    $("game").focus();
  }

  /**
   * Use Mouse or Trackpad, mid-game: the same round goes on with the
   * pointer. The camera is put away, the preview goes, and the game's hints
   * now speak of clicks. An aim check still running has nothing left to
   * check: the round begins.
   */
  private continueWithPointer(session: Session): void {
    if (this.session !== session) return;
    const control: InputKind = touchOnly() ? "touch" : "mouse";
    this.setControl(control);
    this.stopTracking();
    this.releaseCamera();
    session.unsubscribe();
    session.unsubscribe = () => {};
    session.check?.dispose();
    session.input.dispose();
    // The pointer's own input takes the right button from here.
    session.stopScopeMouse();
    session.stopScopeMouse = () => {};
    const stage = $("stage");
    session.scope?.reset();
    session.input = control === "touch" ? new TouchInput(stage, session.scope) : new MouseInput(stage, session.scope);
    session.hand = null;
    session.camera = null;
    session.control = control;
    session.context.input = control;
    this.scopeFor(session);
    session.troubled = false;
    session.lostSince = null;
    this.pip.hide();
    this.showHold(null);
    this.showSwitch();
    $("game").dataset.input = control;
    if (session.phase === "check") {
      // The stage is cleared once: a check already done has cleared it.
      if (!session.check?.done) {
        session.game.calibration.light(null);
        session.game.calibration.done();
      }
      this.play(session, null);
    } else {
      this.crosshair.visible = !session.down;
      this.pointerHint(session);
    }
    this.host!.aim = (now) => session.input.sample(now);
    this.host?.resume();
    $("game").focus();
  }

  private startTracking(): void {
    if (this.options.scripted) this.options.scripted.start();
    else if (this.tracker && this.camera) this.tracker.start(this.camera.video);
    else return;
    this.tracking = true;
    // The camera gets its full grace from now to show a frame.
    if (this.session) this.session.frameAt = performance.now();
  }

  private stopTracking(): void {
    this.tracking = false;
    if (this.options.scripted) this.options.scripted.stop();
    else this.tracker?.stop();
  }

  /** Does this game read the eye when played this way, as the player has it set? */
  private readsEye(entry: GameEntry, control: InputKind): boolean {
    return control === "hand" && entry.uses?.scope === true && entry.uses.eye === true && this.scopePrefs.eye;
  }

  /** Reads the face on every `every`th camera frame, or not at all (0). */
  private readFaces(every: number): void {
    if (this.options.scripted) this.options.scripted.readFace(every);
    else this.tracker?.readFace(every);
  }

  /**
   * The session's scope as the player has it set now: held or toggled, the
   * eye read or not (and the face with it), the Scope button on a touch
   * screen, and what the game is told.
   */
  private scopeFor(session: Session): void {
    const scope = session.scope;
    const eye = scope !== null && scope.eye !== null && session.control === "hand" && this.scopePrefs.eye;
    if (scope) {
      scope.mode = this.scopePrefs.button;
      scope.useEye = eye;
    }
    // What the game tells the player: the eye only where the face landmarker is really there to read it.
    const faceHere = !!this.options.scripted || !!this.tracker?.hasFace;
    this.settings.scope = { eye: eye && faceHere, button: this.scopePrefs.button, touch: touchCapable() };
    if (eye && !this.options.scripted && this.tracker && !this.tracker.hasFace) {
      // Turned on mid-game, or it did not come with the hand: the face comes quietly, and is
      // read once it is here. A face that will not load leaves Shift to scope, and says so.
      this.tracker.addFace(() => {}).then(
        () => this.session === session && this.scopeFor(session),
        (error: unknown) => console.warn("The face landmarker did not load.", error),
      );
    }
    this.readFaces(eye ? FACE_EVERY : 0);
    // The Scope button: on a touch screen, with a pointer or with the hand (a touch screen has no Shift).
    const button = $("scope-button");
    button.hidden = !(scope && (session.control === "touch" || (session.control === "hand" && touchCapable())));
    button.setAttribute("aria-pressed", String(scope?.buttons ?? false));
  }

  /** The eye for a scope: this player's own eyes, as learned from their winks before. */
  private newEye(): EyeScope {
    const eye = new EyeScope(EYE_SCOPE, loadEyeProfile());
    eye.onLearn = (profile) => saveEyeProfile(profile);
    return eye;
  }

  /**
   * The eye's indicator in the HUD, every frame of play: whether the face is
   * seen and how far the eye has closed. And when the face stays out of view
   * - the hand across it, a head turned away, a camera that cannot see it -
   * before the player has looked through the scope at all, the page says so,
   * and says the way that always works.
   */
  private watchEye(session: Session, now: number, aim: Aim): void {
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
   * and goes.
   */
  private faceAwayHint(session: Session, now: number): string | null {
    if (session.faceAway === null || session.scoped) return null;
    const away = now - session.faceAway;
    if (away < FACE_AWAY || away > FACE_AWAY + FACE_AWAY_SAID) return null;
    const way = touchCapable() && session.control !== "mouse" ? "Scope" : "Shift";
    // A face landmarker that never came (nothing to see the eyes with) is told apart from a face out of view.
    const why = this.options.scripted || this.tracker?.hasFace ? "Your face isn’t in view." : "Your camera can’t read your eyes here.";
    return `${why} ${this.scopePrefs.button === "toggle" ? "Press" : "Hold"} ${way} to look through the scope.`;
  }

  pause(): void {
    const session = this.session;
    if (!session || session.paused || session.troubled || session.phase === "over" || session.phase === "loading") return;
    session.paused = true;
    // Paused while waiting for the hand: the menu takes the hold's place,
    // and Resume brings the wait back.
    this.stopHold(session);
    this.host?.pause();
    this.stopTracking();
    this.crosshair.clear();
    // A paused game is not looking for the hand: nothing asks for it.
    this.hud.pageHint(null);
    session.lostSince = null;
    this.pip.calm();
    $("adjust-aim").hidden = session.control !== "hand";
    this.showSwitch();
    void this.refreshCameras();
    setText("pause-title", "Paused");
    openSheet("pause-sheet");
    $("resume").focus();
    announce("Paused");
  }

  resume(): void {
    const session = this.session;
    closeSheet("pause-sheet");
    if (!session || !session.paused) return;
    session.paused = false;
    // Nothing held from before the pause: no stale fold fires on return.
    session.input.reset();
    this.startTracking();
    $("game").focus();
    // With the hand, play does not drop the player straight back into the
    // fight: it waits to see the hand, and counts them in. The mouse is
    // where it was, and the aim check and the fall have nothing to wait for.
    if (session.control === "hand" && session.phase === "play" && !session.down) {
      this.hold(session);
      session.watch.hold(performance.now());
      this.showHold("wait");
      return;
    }
    this.host?.resume();
  }

  private gameOver(stats: GameStats): void {
    const session = this.session;
    if (!session || session.phase === "over") return;
    this.stopHold(session);
    session.phase = "over";
    $("game").dataset.phase = "over";
    this.crosshair.visible = false;
    this.hud.pageHint(null);
    // With the hand, the camera goes on reading under the results, so a fold
    // of the thumb can play again.
    if (session.control !== "hand") this.stopTracking();
    // The world plays out its last moment before the card arrives.
    this.later(session, this.settings.reducedMotion ? 400 : 1200, () => {
      session.result = showResults(session.entry, stats, this.settings.reducedMotion);
      this.listenForFire(session);
      // Once the world has played out under the card, it stops drawing:
      // the last frame stays, and nothing is spent on a view no one plays.
      this.later(session, RESULTS_SETTLE, () => {
        this.host?.stop();
        session.idle = true;
      });
    });
  }

  /** A timer for this round's results, dropped if the round moves on first. */
  private later(session: Session, ms: number, run: () => void): void {
    const timer = window.setTimeout(() => {
      session.timers = session.timers.filter((t) => t !== timer);
      if (this.session === session && session.phase === "over") run();
    }, ms);
    session.timers.push(timer);
  }

  /**
   * Play Again with the hand: while the results are up, a deliberate fold
   * of the thumb presses it (see FireToPlay). The card says so, only to a
   * hand player; after a minute of no one playing the camera rests.
   */
  private listenForFire(session: Session): void {
    const hand = session.hand;
    const line = $("results-fire");
    if (!hand || !this.tracking) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    const fire = new FireToPlay(performance.now());
    session.fire = fire;
    hand.onReading = (reading) => {
      const shot = fire.observe(performance.now(), {
        seen: reading.position !== null,
        armed: reading.armed,
        travel: reading.travel,
        fired: reading.fired,
      });
      if (!shot || session.fire !== fire || !$<HTMLDialogElement>("results").open) return;
      this.stopListening(session, false);
      $("again").click();
    };
    this.later(session, FIRE_LISTENS, () => this.stopListening(session, true));
  }

  /** The results stop listening for a fold; `rest` puts the camera to rest too. */
  private stopListening(session: Session, rest: boolean): void {
    session.fire = null;
    if (session.hand) session.hand.onReading = null;
    $("results-fire").hidden = true;
    if (rest) this.stopTracking();
  }

  /** A new game of the same kind: through the aim check again, as every game is. */
  restart(adjust = false): void {
    const session = this.session;
    // A game whose stage can stand its targets up again (begin) plays its
    // next round on the same instance: no reload, no second wait. Any other
    // is made afresh.
    if (session && this.host && typeof session.game.calibration.begin === "function") {
      this.again(session, adjust);
      return;
    }
    this.endSession();
    void this.start({ adjust });
  }

  /** The next round on the same game: Play Again, Restart, Adjust Aim. */
  private again(session: Session, adjust: boolean): void {
    closeSheets();
    this.stopHold(session);
    for (const timer of session.timers.splice(0)) window.clearTimeout(timer);
    this.stopListening(session, false);
    session.check?.dispose();
    session.check = null;
    session.result = null;
    session.lostSince = null;
    session.troubled = false;
    session.down = false;
    session.idle = false;
    session.phase = "loading";
    session.input.reset();
    this.hud.reset(this.settings.unlocks.has("golden"));
    this.crosshair.visible = false;
    this.crosshair.clear();
    if (session.hand) this.pip.show(!this.options.scripted);
    // With the mouse there is no check to call begin(): the game hears of
    // its new round from begin() all the same, then start().
    if (!session.hand) session.game.calibration.begin?.();
    this.round(session, adjust);
    this.startTracking();
    // Whatever stopped the world - the pause menu, the camera's trouble, the
    // results left a while - it runs again for the new round.
    session.paused = false;
    this.host!.resume();
    $("game").focus();
  }

  /** Back to the arcade, on the game just played. */
  back(): void {
    this.generation++;
    this.busy = false;
    if (this.session) this.choose(this.session.entry, "link");
    this.endSession();
    this.releaseCamera();
    closeSheets();
    this.route = { space: "arcade", game: this.selected.id };
    this.showView("arcade");
    this.renderArcade();
    $("play").focus();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  private endSession(): void {
    const session = this.session;
    this.session = null;
    if (session) {
      this.stopHold(session);
      for (const timer of session.timers.splice(0)) window.clearTimeout(timer);
      this.stopListening(session, false);
      session.check?.dispose();
      session.stopScopeKeys();
      session.stopScopeMouse();
      session.unsubscribe();
      session.input.dispose();
      session.game.dispose();
    }
    if (this.host) {
      this.host.stop();
      this.host.onFrame = null;
      this.host.aim = () => IDLE_AIM;
      this.host.setGame(null);
    }
    this.stopTracking();
    this.readFaces(0);
    $("scope-button").hidden = true;
    this.crosshair.visible = false;
    this.crosshair.hiddenByGame = false;
    this.crosshair.clear();
    this.pip.hide();
    this.yielding.reset();
    this.hud.reset(this.settings.unlocks.has("golden"));
    closeSheets();
  }

  private releaseCamera(): void {
    this.camera?.stop();
    this.camera = null;
  }

  // --- Switch Camera ---------------------------------------------------------------------------

  /** The camera in use (the scripted hand plays a camera of its own). */
  private cameraInUse(): string | null {
    return this.options.scripted ? this.options.scripted.deviceId : (this.camera?.deviceId ?? null);
  }

  /** The cameras the browser lists now; Switch Camera shows while there is more than one to choose from. */
  private async refreshCameras(): Promise<void> {
    this.cameras = await listCameras();
    this.showSwitch();
  }

  /** The two Switch Camera controls - on the camera's picture, and in the pause menu - shown only for a hand player with two or more cameras. */
  private showSwitch(): void {
    const show = this.cameras.length >= 2 && this.session?.control === "hand";
    for (const id of ["switch-camera", "pause-switch-camera"]) {
      const button = $<HTMLButtonElement>(id);
      button.hidden = !show;
      button.disabled = this.switching;
    }
  }

  /**
   * Switch Camera: the next camera at once, the old one let go. The aim check
   * begins again for the new camera - from its saved aim when it has one -
   * and a round already begun starts afresh under it, as it does for any other
   * camera. The new camera is named, calmly.
   */
  private async changeCamera(): Promise<void> {
    const session = this.session;
    if (!session || session.control !== "hand" || session.troubled || this.switching) return;
    // In the aim check, or from the pause menu; not through the ready moment or the results.
    if (session.phase === "check" ? session.check?.done : !session.paused) return;
    this.switching = true;
    // A keyboard player pressing the button on the picture keeps it in hand, for the next camera.
    const keepFocus = document.activeElement === $("switch-camera");
    this.showSwitch();
    const scripted = this.options.scripted;
    const before = session.camera;
    this.stopTracking();
    const result = await switchCamera({
      cameras: () => listCameras(),
      inUse: () => this.cameraInUse(),
      release: () => this.releaseCamera(),
      open: async () => {
        if (scripted) return scripted.deviceId;
        await this.openCamera();
        return this.cameraInUse() ?? "";
      },
      choose: (deviceId) => {
        chooseCamera(deviceId);
        if (scripted) scripted.deviceId = deviceId;
      },
    });
    this.switching = false;
    this.showSwitch();
    if (this.session !== session) {
      // The player left while the camera was opening: it is not wanted now.
      this.releaseCamera();
      return;
    }
    void this.refreshCameras();
    // Tracking goes on, unless the round is paused (Resume starts it).
    const carryOn = () => {
      if (!session.paused) this.startTracking();
    };
    switch (result.kind) {
      case "none":
        carryOn();
        return;
      case "failed":
        this.cameraTrouble(session, result.trouble);
        return;
      case "kept":
        toast(`Couldn’t switch to ${result.wanted.label}. Another app may be using it.`, { icon: "exclamation" });
        carryOn();
        return;
      case "switched": {
        toast(result.camera.label, { icon: "camera" });
        const now = this.cameraIdentity();
        if (before && now && now.deviceId === before.deviceId && now.width === before.width && now.height === before.height) {
          carryOn(); // the same camera came back (the next one had gone): the round carries on
          return;
        }
        session.camera = now;
        this.again(session, false);
        if (keepFocus) $("switch-camera").focus();
        announce(`Switched to ${result.camera.label}. Aim setup. ${session.check?.spoken ?? ""}`);
      }
    }
  }

  // --- the page's own controls -------------------------------------------------------------

  private wire(): void {
    // The first gesture on the page makes the sound engine; every button
    // after it answers with the interface's soft tap, or a rising pair of
    // notes for the ones that set something going.
    for (const type of ["pointerdown", "keydown"] as const) {
      window.addEventListener(type, () => void this.wakeAudio(), { capture: true, once: true });
    }
    document.addEventListener(
      "click",
      (event) => {
        const button = (event.target as Element | null)?.closest?.("button");
        if (button && !button.disabled) this.audio.play(button.dataset.sound === "confirm" ? "ui_confirm" : "ui_tap");
      },
      true,
    );
    $("get-started").onclick = () => {
      prefs.welcomed = true;
      // The landing, unless the address was a link to a game: then that game. Where the button was, the focus goes on to the Arcade's.
      this.arrive(this.route);
      if (this.route.space === "landing" && !this.route.focus && !prefs.space) this.landing.focus("arcade");
    };
    $("play").onclick = () => void this.start();
    $("adjust").onclick = () => void this.start({ adjust: true });
    $("switch-control").onclick = () =>
      this.setControl(this.control === "hand" ? (touchOnly() ? "touch" : "mouse") : "hand");
    $("about").onclick = () => openSheet("privacy");
    $("settings-open").onclick = () => this.settingsSheet.show("home");
    $("pause-settings").onclick = () => this.settingsSheet.show("pause");
    $("privacy-done").onclick = () => closeSheet("privacy");
    for (const id of ["mute", "sheet-mute"]) $(id).onclick = () => this.setMuted(!this.muted);
    $("pause").onclick = () => this.pause();
    $("resume").onclick = () => this.resume();
    // A new round from the pause sheet plays at the difficulty chosen now.
    $("restart").onclick = () => {
      this.syncDifficulty(true);
      this.restart();
    };
    $("adjust-aim").onclick = () => {
      this.syncDifficulty(true);
      this.restart(true);
    };
    $("choose-game").onclick = () => this.back();
    $("choose").onclick = () => this.back();
    $("again").onclick = () => this.restart();
    $("loading-cancel").onclick = () => this.back();
    $("share").onclick = async () => {
      const result = this.session?.result;
      if (!result) return;
      const button = $<HTMLButtonElement>("share");
      button.disabled = true;
      try {
        await shareResult(result);
      } finally {
        button.disabled = false;
      }
    };
    $("fullscreen").onclick = () => {
      const request = document.fullscreenElement ? document.exitFullscreen() : $("game").requestFullscreen?.();
      request?.catch(() => toast("Full screen isn’t available here."));
    };
    // Esc on a sheet over the game: the pause sheet resumes; results and
    // trouble stay until the player chooses; loading goes back to the arcade.
    $("pause-sheet").addEventListener("cancel", (event) => {
      event.preventDefault();
      this.resume();
    });
    $("results").addEventListener("cancel", (event) => event.preventDefault());
    // A camera's trouble mid-game holds the round: it stays until the player chooses.
    $("alert").addEventListener("cancel", (event) => {
      if (this.session?.troubled) event.preventDefault();
    });
    $("hold-menu").onclick = () => this.pause();
    for (const id of ["switch-camera", "pause-switch-camera"]) $(id).onclick = () => void this.changeCamera();
    navigator.mediaDevices?.addEventListener?.("devicechange", () => void this.refreshCameras());
    // The touch screen's Scope button: held (or tapped, to toggle) with a thumb while the other hand aims.
    const scopeButton = $("scope-button");
    scopeButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.session?.scope?.press("touch");
      // Held as the thumb slides off it, until the thumb lifts.
      try {
        scopeButton.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer knows: nothing to hold on to.
      }
    });
    for (const type of ["pointerup", "pointercancel"] as const) {
      scopeButton.addEventListener(type, () => this.session?.scope?.release("touch"));
    }
    scopeButton.addEventListener("contextmenu", (event) => event.preventDefault());
    // From the keyboard it can only be pressed, not held: once, as a toggle does.
    scopeButton.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      this.session?.scope?.press("touch");
      this.session?.scope?.release("touch");
    });
    $("loading").addEventListener("cancel", (event) => {
      event.preventDefault();
      this.back();
    });

    window.addEventListener("keydown", (event) => this.key(event));
    // The browser's Back and Forward, a link to a game followed on the page, the address edited:
    // the page turns to the space the address names (in a game, or at the welcome, it stays where it is).
    const followAddress = () => {
      const view = document.body.dataset.view;
      if (view !== "landing" && view !== "arcade") return;
      this.arrive(parseRoute(location, this.shooting));
    };
    window.addEventListener("popstate", followAddress);
    window.addEventListener("hashchange", followAddress);
    // The bar's Handy is the way back to the landing (a link, so that it opens there from anywhere too).
    $("brand").addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      this.navigate({ space: "landing", focus: this.route.space === "arcade" ? "arcade" : null });
    });
    // Already in the arcade, its name in the bar does nothing.
    $("space-arcade").addEventListener("click", (event) => {
      if (document.body.dataset.view === "arcade") event.preventDefault();
    });
    // Grip Prix is a page of its own: leaving for it is remembered, so coming back finds its tile in hand.
    for (const id of ["space-grip", "tile-grip-go"]) $(id).addEventListener("click", () => (prefs.space = "grip-prix"));
    // How It Plays, under each tile.
    for (const button of document.querySelectorAll<HTMLElement>("[data-how]")) {
      button.addEventListener("click", () => {
        this.landing.how(button.dataset.how === "grip-prix" ? "grip-prix" : "arcade");
        openSheet("how");
      });
    }
    $("how-done").onclick = () => closeSheet("how");
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
    });
    window.addEventListener("pagehide", () => this.releaseCamera());
    watchKonami(
      () => ["landing", "arcade"].includes(document.body.dataset.view ?? "") && !document.querySelector("dialog[open]"),
      () => this.unlockGolden(),
    );
  }

  private key(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "m" && !event.repeat) {
      this.setMuted(!this.muted);
      toast(this.muted ? "Sound off." : "Sound on.", { icon: this.muted ? "speaker-off" : "speaker" });
      return;
    }
    const session = this.session;
    if (!session || document.body.dataset.view !== "game" || session.phase === "over" || session.troubled) return;
    // Space presses a focused button, as it always does.
    if (key === " " && target?.tagName === "BUTTON") return;
    if (event.repeat) return;
    if (key === "Escape") {
      // On the pause sheet Esc is the sheet's own cancel, which resumes.
      if (!session.paused) {
        event.preventDefault();
        this.pause();
      }
    } else if (key === "p" || key === " ") {
      event.preventDefault();
      if (session.paused) this.resume();
      else this.pause();
    }
  }

  private unlockGolden(): void {
    if (this.settings.unlocks.has("golden")) {
      toast("The Golden Revolver is already yours.", { icon: "star", tone: "gold" });
      return;
    }
    this.settings.unlocks.add("golden");
    prefs.unlocks = this.settings.unlocks;
    toast("Golden Revolver unlocked for this visit.", { icon: "star", tone: "gold" });
    this.audio.play("ui_confirm");
  }

  // --- settings, records and preferences ----------------------------------------------------

  /** Puts the player's settings into effect, everywhere one is read. */
  private applyPreferences(): void {
    const chosen = this.preferences;
    this.audio.setVolume(chosen.volume);
    this.crosshair.style = { ...chosen.crosshair };
    AimController.steadiness = chosen.steadiness;
    this.session?.hand?.controller.setSteadiness(chosen.steadiness);
    this.pip.showInPlay = chosen.cameraInPlay;
    this.settings.reducedFlashing = chosen.reduceFlashing;
    // Games read it live, on every shot: a change reaches the round in play.
    this.settings.aimAssist = chosen.aimAssist;
    this.applyMotion();
    this.syncDifficulty();
  }

  /** Reduced motion, the player's or else the system's, for the page's code and its styles alike. */
  private applyMotion(): void {
    const reduce = this.preferences.reduceMotion ?? this.motion.matches;
    this.settings.reducedMotion = reduce;
    document.documentElement.toggleAttribute("data-reduce-motion", reduce);
  }

  /**
   * The difficulty the game reads at start(). While a round is in play it
   * stays the one that round began with, so its record is kept under the
   * difficulty it was played at; a new choice takes over when the round ends
   * or a new one begins (`now`).
   */
  private syncDifficulty(now = false): void {
    if (now || this.session?.phase !== "play") this.settings.difficulty = this.preferences.difficulty;
  }

  /** The game has ended: its record is weighed and kept at once, then the results follow. */
  private roundOver(stats: GameStats): void {
    const session = this.session;
    if (session && session.phase !== "over") {
      recordRound(session.entry, stats, { difficulty: this.settings.difficulty, control: controlClass(session.control) });
    }
    this.gameOver(stats);
    this.syncDifficulty();
  }

  private settingsHost(): SettingsHost {
    return {
      preferences: this.preferences,
      scope: this.scopePrefs,
      scopeGames: () => playableGames().filter((game) => game.uses?.scope),
      touch: () => touchOnly(),
      systemReducesMotion: () => this.motion.matches,
      changed: (key) => {
        if (key === "scope") {
          saveScopePreferences(this.scopePrefs);
          if (this.session) this.scopeFor(this.session);
          else this.settings.scope = { eye: false, button: this.scopePrefs.button };
          return;
        }
        savePreferences(this.preferences);
        this.applyPreferences();
        if (document.body.dataset.view === "arcade") this.renderArcade();
      },
      audition: () => this.audio.play("ui_tap"),
      currentCamera: () => {
        // The choice made, unless that camera has gone: then the one in use.
        const chosen = chosenCamera();
        if (chosen && (!this.cameras.length || this.cameras.some((camera) => camera.deviceId === chosen))) return chosen;
        return this.cameraInUse() ?? chosen ?? remembered();
      },
      chooseCamera: (deviceId) => {
        chooseCamera(deviceId);
        // At the arcade the choice is for the next Play: a camera still open
        // from before is let go, so that one opens the chosen camera.
        if (!this.session && this.camera && this.camera.deviceId !== deviceId) this.releaseCamera();
      },
      hasSavedAim: () => hasSavedAim(),
      forgetSavedAim: () => {
        forgetSavedAims();
        this.renderArcade();
      },
      reset: () => this.resetEverything(),
      systemInfo: async () => this.systemFacts(),
      eyeTest: (listener, video) => this.eyeTest(listener, video),
    };
  }

  /**
   * The Eye Test (Settings): the camera and the face landmarker, for as long
   * as the sheet asks, so a player can see that their face is read and how
   * far each eye closes. Over a paused game they are already here; at the
   * arcade they are made for the test - the camera let go of afterwards, the
   * landmarker kept for the game that follows. It is also the "Close one
   * eye" step: a wink held here teaches the scope how far this player's eye
   * really closes (and is kept), in full rather than by halves.
   */
  private async eyeTest(listener: (state: EyeTestState) => void, video: HTMLVideoElement): Promise<(() => void) | null> {
    const scripted = this.options.scripted;
    const blocked = (message: string): null => {
      listener({ kind: "blocked", message });
      return null;
    };
    let own: Camera | null = null;
    if (!scripted) {
      if ((await cameraPermission()) === "denied") return blocked("Your browser is blocking the camera for this page. Allow it from the address bar, then Start again.");
      if (this.camera) {
        // The paused game's own camera: its picture, shown here too.
        video.srcObject = this.camera.stream;
        void video.play().catch(() => {});
      } else {
        try {
          own = await openCamera(video);
          prefs.cameraOpened = true;
        } catch (error) {
          const trouble = error instanceof CameraError ? error.trouble : "busy";
          return blocked(
            trouble === "denied"
              ? "Your browser is blocking the camera for this page. Allow it from the address bar, then Start again."
              : trouble === "missing"
                ? "No camera found. Connect one, then Start again."
                : trouble === "insecure"
                  ? "Your browser only shares the camera with secure pages."
                  : "Your camera is being used by another app. Close it, then Start again.",
          );
        }
      }
      if (!this.tracker?.hasFace) {
        const progress = new Progress((fraction) => listener({ kind: "getting-ready", fraction }));
        try {
          if (!this.tracker) {
            const { loadTracker } = await import("../tracking/tracker");
            const tracker = await loadTracker(
              { wasm: progress.part("wasm", 12), model: progress.part("model", 8), face: progress.part("face", 4) },
              { where: this.options.trackerWhere ?? "auto", prefer: this.options.trackerDelegate ?? "GPU", face: true },
            );
            this.tracker = tracker;
          }
          if (!this.tracker.hasFace) await this.tracker.addFace(progress.part("face", 4));
        } catch (error) {
          console.warn("The Eye Test could not get the face landmarker ready.", error);
        }
        if (!this.tracker?.hasFace) {
          own?.stop();
          video.srcObject = null;
          return blocked("Couldn’t get your face reading ready. Check your connection, then Start again.");
        }
      }
    }
    const tracker = this.tracker;
    const eye = new EyeScope({ ...EYE_SCOPE, learn: 1 }, loadEyeProfile());
    let learned = false;
    eye.onLearn = (taught) => {
      saveEyeProfile(taught);
      learned = true;
    };
    const say = () => listener({ kind: "reading", view: eye.view(performance.now()), learned });
    const source = scripted ?? tracker!;
    const off = source.subscribeFace?.((face) => {
      eye.read(face.eyes, face.capturedAt);
      say();
    });
    // Readings that stop coming (a face lost is a reading; a stalled camera is not) are seen as the face gone.
    const tick = window.setInterval(say, 250);
    if (scripted) {
      scripted.readFace(1);
      scripted.start();
    } else {
      tracker!.readFace(1);
      tracker!.start(video);
    }
    say();
    return () => {
      window.clearInterval(tick);
      off?.();
      if (scripted) scripted.stop();
      else tracker!.stop();
      // A paused game goes on as it was told: stopped, and reading the eye if it was to.
      this.readFaces(this.session?.scope?.useEye ? FACE_EVERY : 0);
      if (own) own.stop();
      else video.srcObject = null;
    };
  }

  /** Reset Handy: everything it keeps is forgotten, and it starts again as on the first visit. */
  private resetEverything(): void {
    if (this.session) this.back();
    closeSheets();
    this.releaseCamera();
    Object.assign(this.preferences, { ...DEFAULT_PREFERENCES, crosshair: { ...DEFAULT_PREFERENCES.crosshair } });
    Object.assign(this.scopePrefs, DEFAULT_SCOPE);
    this.tips.forgetInMemory();
    this.settings.unlocks.clear();
    this.control = "hand";
    this.setMuted(false);
    this.applyPreferences();
    // Last, so nothing written on the way survives it.
    forgetEverything();
    // As on the first visit: the landing is where Get Started goes.
    this.route = { space: "landing", focus: null };
    history.replaceState(history.state, "", this.addressFor(this.route));
    this.renderArcade();
    this.showView("welcome");
    $("get-started").focus();
  }

  /** What a bug report needs to know: the browser, the graphics, the timings. Nothing personal. */
  private systemFacts(): SystemFacts {
    const state = this.snapshot();
    let gpu = state.quality?.gpu ?? null;
    if (!gpu) {
      // No game yet: ask a throwaway context, and let it go at once.
      const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
      if (gl) {
        gpu = gpuName(gl);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    }
    const frames = state.frames && state.frames.frames > 0 ? state.frames : null;
    return {
      version: VERSION,
      userAgent: navigator.userAgent,
      gpu,
      tracker: state.tracker ? { where: state.tracker.where, delegate: state.tracker.delegate } : null,
      frames: frames ? { interval: frames.interval, work: frames.work } : null,
      latency: state.latency.p50 > 0 ? state.latency : null,
      quality: state.quality ? { tier: state.quality.tier, scale: state.quality.scale } : null,
      screen: {
        width: screen.width,
        height: screen.height,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
      },
    };
  }

  // --- for the tests and the performance report -----------------------------------------------

  /** A snapshot of the app's state (dev and test builds read it). */
  snapshot() {
    const session = this.session;
    const check = session?.check?.check;
    return {
      view: document.body.dataset.view,
      phase: session?.phase ?? null,
      paused: session?.paused ?? false,
      held: session?.held ?? false,
      troubled: session?.troubled ?? false,
      idle: session?.idle ?? false,
      hold: $("game").dataset.hold ?? null,
      running: this.host?.isRunning ?? false,
      tracking: this.tracking,
      input: session?.control ?? null,
      control: this.control,
      lit: check?.lit ?? null,
      score: check?.measure.score ?? null,
      shots: check?.shots ?? 0,
      checkDone: session?.check?.done ?? false,
      lastCheck: this.lastCheck,
      tracker: this.tracker ? { where: this.tracker.where, delegate: this.tracker.delegate, stats: this.tracker.stats() } : null,
      frames: this.host?.stats.summary() ?? null,
      latency: this.latency.summary(),
      quality: this.host ? { ...this.host.quality, gpu: this.host.gpu } : null,
      unlocks: [...this.settings.unlocks],
      // What the game reads, and what the player chose.
      difficulty: this.settings.difficulty,
      reducedMotion: this.settings.reducedMotion,
      reducedFlashing: this.settings.reducedFlashing,
      aimAssist: this.settings.aimAssist,
      tipsSeen: [...this.settings.tipsSeen],
      preferences: { ...this.preferences, crosshair: { ...this.preferences.crosshair } },
      smoothing: this.session?.hand?.controller.smoothing ?? null,
      showCameraInPlay: this.pip.showInPlay,
      game: this.session?.entry.id ?? this.selected.id,
      scope: session?.scope
        ? {
            active: session.scope.active(performance.now()),
            buttons: session.scope.buttons,
            eye: session.scope.useEye,
            mode: session.scope.mode,
            view: session.scope.eyeView(performance.now()),
          }
        : null,
      scopePreferences: { ...this.scopePrefs },
      crosshairHidden: this.crosshair.hiddenByGame,
      /** The page's crosshair is on screen (drawn whenever the hand is followed): never while an aim is being learned. */
      crosshairShown: this.crosshair.visible && !this.crosshair.hiddenByGame,
    };
  }

  /** Starts the timing figures afresh, for a measurement window. */
  resetStats(): void {
    this.host?.stats.reset();
    this.tracker?.resetStats();
    this.latency.clear();
  }

  /** As if the camera had been unplugged mid-game (dev and test builds). */
  unplugCamera(): void {
    if (this.options.scripted) this.options.scripted.stop();
    else this.releaseCamera();
    this.cameraEnded();
  }

  /** The current session's pieces, for the tests' own measurements. */
  get internals() {
    return { session: this.session, host: this.host, tracker: this.tracker, camera: this.camera };
  }
}
