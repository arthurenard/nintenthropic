/**
 * The app: first run, the arcade, and a game's whole life - the camera's
 * question, getting ready with real progress, the aim check in the game's own
 * world, play, pause, results - with calm words for anything that goes wrong.
 */
import type { AudioEngine } from "../audio/index";
import { browserStore, loadAim, saveAim, type CameraIdentity } from "../calibration/storage";
import { DownloadError, Progress, siteUrl } from "../engine/fetch";
import { IDLE_AIM, WebGLUnavailable } from "../engine/common";
import type { EngineHost } from "../engine/host";
import { seededRandom } from "../engine/random";
import { Samples } from "../engine/stats";
import { gpuName } from "../engine/tier";
import type { Aim, Game, GameContext, GameEntry, GameStats, InputKind, InputSource, Settings } from "../engine/types";
import { COMING_SOON, GAMES } from "../games/index";
import { AimController } from "../input/aim";
import { HandInput } from "../input/handInput";
import type { Matrix } from "../input/homography";
import { MouseInput, TouchInput } from "../input/pointer";
import type { ScriptedHands } from "../input/script";
import { CameraError, cameraPermission, chooseCamera, chosenCamera, openCamera, remembered, type Camera, type CameraTrouble } from "../tracking/camera";
import { ModelError } from "../tracking/errors";
import type { Tracker } from "../tracking/tracker";
import type { HandSource } from "../tracking/types";
import { $, announce, element, icon, replay, setText, toast } from "../ui/dom";
import { formatScore } from "../ui/format";
import { AimCheckView } from "./aimCheckView";
import { Crosshair } from "./crosshair";
import { FireToPlay, HandWatch, type HandWatchEvent } from "./handWatch";
import { Hud } from "./hud";
import { watchKonami } from "./konami";
import { Pip } from "./pip";
import { Yielding, type Spot } from "./yielding";
import {
  DEFAULT_PREFERENCES,
  controlClass,
  forgetEverything,
  forgetSavedAims,
  hasSavedAim,
  loadPreferences,
  prefs,
  readBest,
  savePreferences,
  tipsSeen,
  type PersistentSet,
  type Preferences,
} from "./prefs";
import { difficultyLabel, recordRound, shareResult, showResults, type Result } from "./results";
import { SettingsSheet, VERSION, type SettingsHost, type SystemFacts } from "./settings";
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
  result: Result | null;
  /** Play Again with a fold of the thumb, while the results are up. */
  fire: FireToPlay | null;
  /** Timers that belong to this round's results, cleared when it moves on. */
  timers: number[];
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

export class App {
  readonly hud: Hud;
  private readonly crosshair = new Crosshair($<HTMLCanvasElement>("crosshair"), () => this.settings.reducedMotion);
  private readonly pip = new Pip();
  private readonly yielding = new Yielding($("stage"), ["pip", "check-card", "check-meter", "hud-score", "cylinder", "hint"]);
  /** How the last aim check ended, for the tests. */
  private lastCheck: { score: number | null; shots: number; ended: "ready" | "anyway" } | null = null;
  private readonly settings: Settings;
  /** The player's choices in Settings, as saved; `settings` is what the game reads. */
  private readonly preferences: Preferences = loadPreferences();
  private readonly tips: PersistentSet = tipsSeen();
  private readonly settingsSheet: SettingsSheet;
  private host: EngineHost | null = null;
  private audio: Sound = silence(prefs.muted);
  private audioReady: Promise<void> | null = null;
  private tracker: Tracker | null = null;
  private camera: Camera | null = null;
  private session: Session | null = null;
  private control: InputKind;
  private generation = 0;
  private busy = false;
  private muted = prefs.muted;
  private readonly entry: GameEntry = GAMES[0]!;
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
      unlocks: prefs.unlocks,
      tipsSeen: this.tips,
    };
    // Reduce Motion follows the system until the player chooses for themselves.
    this.motion.addEventListener("change", () => this.applyMotion());
    this.hud = new Hud(() => this.settings.reducedMotion);
    this.hud.onGameOver = (stats) => this.roundOver(stats);
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
    this.settingsSheet = new SettingsSheet(this.settingsHost());
    this.applyPreferences();
    this.wire();
  }

  // --- the arcade -----------------------------------------------------------------

  boot(): void {
    this.renderHome();
    this.setMuted(this.muted);
    this.showView(prefs.welcomed ? "home" : "welcome");
    // The first screen needs neither three.js nor the tracker; fetch them
    // once it is up, so Play does not wait for them.
    const later = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
    later(() => {
      void import("../engine/host");
      void import("../tracking/tracker");
    });
  }

  private showView(name: "welcome" | "home" | "game"): void {
    for (const view of ["welcome", "home", "game"] as const) $(view).hidden = view !== name;
    document.body.dataset.view = name;
  }

  private renderHome(): void {
    const entry = this.entry;
    setText("feature-title", entry.title);
    setText("feature-about", entry.about ?? entry.blurb);
    const art = $<HTMLImageElement>("feature-art");
    if (!art.getAttribute("src")) {
      art.onload = () => art.classList.add("loaded");
      art.onerror = () => (art.hidden = true); // the golden-hour placeholder stays
      art.src = siteUrl(entry.poster);
    }
    const soon = $("soon");
    if (!soon.children.length) {
      soon.append(
        ...COMING_SOON.map((game) => {
          const item = element("li");
          item.append(element("span", "title3", game.title), element("span", "subhead", game.blurb));
          return item;
        }),
      );
    }
    const label = $("control-label");
    const hand = this.control === "hand";
    label.replaceChildren(icon(hand ? "hand" : "mouse"), hand ? "Finger Pistol" : this.control === "touch" ? "Touch" : "Mouse or Trackpad");
    setText("switch-control", hand ? (touchOnly() ? "Use Touch" : "Use Mouse or Trackpad") : "Use Finger Pistol");
    $("switch-control").hidden = !!this.options.scripted;
    $("adjust").hidden = !(hand && hasSavedAim());
    $<HTMLButtonElement>("play").disabled = this.busy;
    this.syncDifficulty();
    this.renderBest();
  }

  /** The best to beat with this control at this difficulty, under the Play button; nothing before there is one. */
  private renderBest(): void {
    const difficulty = this.preferences.difficulty;
    const best = readBest(this.entry.id, difficulty, controlClass(this.control));
    const line = $("home-best");
    line.hidden = !best;
    if (!best) return;
    const level = difficultyLabel(difficulty);
    setText(line, `${level ? `Your best on ${level}` : "Your best"}: ${formatScore(best.score)}${best.outcome ? ` · ${best.outcome}` : ""}`);
  }

  private setControl(control: InputKind): void {
    this.control = control;
    if (control !== "touch") prefs.control = control;
    else prefs.control = "mouse";
    this.renderHome();
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
  private async cameraReady(): Promise<InputKind | null> {
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
    if (this.busy) return;
    this.busy = true;
    this.renderHome();
    const run = ++this.generation;
    const stale = () => run !== this.generation;
    let loading: LoadingSheet | null = null;
    let game: Game | null = null;
    try {
      await this.wakeAudio();
      if (this.control === "hand" && !this.options.scripted && !this.camera) {
        const control = await this.cameraReady();
        if (control === null || stale()) return;
        if (control !== "hand") this.setControl(control);
      }
      const host = await this.ensureHost();
      if (stale()) return;
      const control = this.control;
      const hand = control === "hand";
      this.openGameView(control);
      const firstTime = hand && !this.options.scripted && !this.tracker && !prefs.downloaded;
      loading = new LoadingSheet(firstTime);
      const sheet = loading;
      const progress = new Progress((fraction) => sheet.set(fraction));

      const work: Promise<unknown>[] = [];
      if (hand && !this.options.scripted) {
        if (!this.camera) work.push(tagged("camera", this.openCamera()));
        if (!this.tracker) {
          const wasm = progress.part("wasm", 12);
          const model = progress.part("model", 8);
          work.push(
            tagged(
              "tracker",
              this.options.fail === "model"
                ? Promise.reject(new ModelError())
                : import("../tracking/tracker")
                    .then(({ loadTracker }) => loadTracker({ wasm, model }, { where: this.options.trackerWhere ?? "auto", prefer: this.options.trackerDelegate ?? "GPU" }))
                    .then((tracker) => {
                      if (stale()) tracker.dispose();
                      else this.tracker = tracker;
                    }),
            ),
          );
        }
      }
      const gamePart = progress.part("game", hand && !this.tracker && !this.options.scripted ? 10 : 1);
      const context = this.context(host, control);
      const loaded = tagged(
        "game",
        (async () => {
          const created = await this.entry.create();
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
      this.begin(ready, context, adjust);
    } catch (error) {
      loading?.close();
      if (stale()) return;
      this.fail(error);
    } finally {
      if (run === this.generation) this.busy = false;
      this.renderHome();
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
    if (!session || session.control !== "hand") return;
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
    this.showView("home");
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

  private openGameView(control: InputKind): void {
    const view = $("game");
    view.dataset.phase = "loading";
    view.dataset.ready = "false";
    view.dataset.input = control;
    view.setAttribute("aria-label", this.entry.title);
    $("world").setAttribute("aria-label", this.entry.title);
    const curtain = $<HTMLImageElement>("curtain-art");
    if (!curtain.getAttribute("src")) {
      curtain.onerror = () => (curtain.hidden = true); // the placeholder's light stays
      curtain.src = siteUrl(this.entry.poster);
    }
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

  private begin(game: Game, context: GameContext, adjust: boolean): void {
    const host = this.host!;
    const control = context.input ?? "hand";
    const stage = $("stage");
    const viewport = () => ({ width: stage.clientWidth, height: stage.clientHeight });
    let input: InputSource & { reset(): void };
    let hand: HandInput | null = null;
    if (control === "hand") {
      hand = new HandInput(this.handSource(), viewport);
      input = hand;
    } else {
      input = control === "touch" ? new TouchInput(stage) : new MouseInput(stage);
      this.pip.hide();
    }
    const session: Session = {
      entry: this.entry,
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
      result: null,
      fire: null,
      timers: [],
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
    if (hand) this.startTracking();
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
      const saved = adjust ? null : loadAim(browserStore(), camera);
      session.phase = "check";
      session.check = new AimCheckView({
        stage: session.game.calibration,
        input: hand,
        saved,
        viewport: () => ({ width: stage.clientWidth, height: stage.clientHeight }),
        reducedMotion: () => this.settings.reducedMotion,
        onDone: (mapping, score) => {
          this.lastCheck = { score, shots: session.check?.check.shots ?? 0, ended: "ready" };
          if (!saveAim(browserStore(), camera, mapping)) toast("This window can’t save your aim. It works until you close it.");
          this.play(session, mapping);
        },
        onPlayAnyway: (mapping) => {
          const check = session.check?.check;
          this.lastCheck = { score: check?.measure.score ?? null, shots: check?.shots ?? 0, ended: "anyway" };
          this.play(session, mapping);
        },
      });
      // The check judges its shots; the game sees them too, to answer with
      // the gun's sound and smoke (it scores nothing before start()).
      host.aim = (now) => hand.sample(now);
      announce(`${session.entry.title}. Aim setup. Shoot the lit target: point at it, then fold your thumb to fire.`);
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
      this.hud.pageHint(session.lostSince !== null && now - session.lostSince > 600 ? "Show your hand to the camera." : null);
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
    if (session.control !== "hand" || session.troubled || session.paused) return false;
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
    const stage = $("stage");
    session.input = control === "touch" ? new TouchInput(stage) : new MouseInput(stage);
    session.hand = null;
    session.camera = null;
    session.control = control;
    session.context.input = control;
    session.troubled = false;
    session.lostSince = null;
    this.pip.hide();
    this.showHold(null);
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

  /** Back to the arcade. */
  back(): void {
    this.generation++;
    this.busy = false;
    this.endSession();
    this.releaseCamera();
    closeSheets();
    this.showView("home");
    this.renderHome();
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
    this.crosshair.visible = false;
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
      this.showView("home");
      $("play").focus();
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
    $("loading").addEventListener("cancel", (event) => {
      event.preventDefault();
      this.back();
    });

    window.addEventListener("keydown", (event) => this.key(event));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
    });
    window.addEventListener("pagehide", () => this.releaseCamera());
    watchKonami(
      () => document.body.dataset.view === "home" && !document.querySelector("dialog[open]"),
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
      systemReducesMotion: () => this.motion.matches,
      changed: () => {
        savePreferences(this.preferences);
        this.applyPreferences();
        if (document.body.dataset.view === "home") this.renderHome();
      },
      audition: () => this.audio.play("ui_tap"),
      currentCamera: () => chosenCamera() ?? this.camera?.deviceId ?? remembered(),
      chooseCamera: (deviceId) => {
        chooseCamera(deviceId);
        // At the arcade the choice is for the next Play: a camera still open
        // from before is let go, so that one opens the chosen camera.
        if (!this.session && this.camera && this.camera.deviceId !== deviceId) this.releaseCamera();
      },
      hasSavedAim: () => hasSavedAim(),
      forgetSavedAim: () => {
        forgetSavedAims();
        this.renderHome();
      },
      reset: () => this.resetEverything(),
      systemInfo: async () => this.systemFacts(),
    };
  }

  /** Reset Handy: everything it keeps is forgotten, and it starts again as on the first visit. */
  private resetEverything(): void {
    if (this.session) this.back();
    closeSheets();
    this.releaseCamera();
    Object.assign(this.preferences, { ...DEFAULT_PREFERENCES, crosshair: { ...DEFAULT_PREFERENCES.crosshair } });
    this.tips.forgetInMemory();
    this.settings.unlocks.clear();
    this.control = "hand";
    this.setMuted(false);
    this.applyPreferences();
    // Last, so nothing written on the way survives it.
    forgetEverything();
    this.renderHome();
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
      tipsSeen: [...this.settings.tipsSeen],
      preferences: { ...this.preferences, crosshair: { ...this.preferences.crosshair } },
      smoothing: this.session?.hand?.controller.smoothing ?? null,
      showCameraInPlay: this.pip.showInPlay,
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
