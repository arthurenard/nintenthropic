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
import type { Aim, Game, GameContext, GameEntry, GameStats, InputKind, InputSource, Settings } from "../engine/types";
import { COMING_SOON, GAMES } from "../games/index";
import { HandInput } from "../input/handInput";
import type { Matrix } from "../input/homography";
import { MouseInput, TouchInput } from "../input/pointer";
import type { ScriptedHands } from "../input/script";
import { CameraError, cameraPermission, openCamera, type Camera, type CameraTrouble } from "../tracking/camera";
import { ModelError } from "../tracking/errors";
import type { Tracker } from "../tracking/tracker";
import type { HandSource } from "../tracking/types";
import { $, announce, element, icon, setText, toast } from "../ui/dom";
import { AimCheckView } from "./aimCheckView";
import { Crosshair } from "./crosshair";
import { Hud } from "./hud";
import { watchKonami } from "./konami";
import { Pip } from "./pip";
import { Yielding, type Spot } from "./yielding";
import { prefs } from "./prefs";
import { shareResult, showResults, type Result } from "./results";
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
  control: InputKind;
  input: InputSource & { reset(): void };
  hand: HandInput | null;
  check: AimCheckView | null;
  phase: Phase;
  paused: boolean;
  camera: CameraIdentity | null;
  unsubscribe: () => void;
  lostSince: number | null;
  result: Result | null;
}

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

/** Silence, until the sound engine arrives with the first gesture. */
function silence(muted: boolean): Pick<AudioEngine, "play" | "loop" | "setFilter" | "setMuted" | "muted"> {
  let quiet = muted;
  return {
    get muted() {
      return quiet;
    },
    play() {},
    loop: () => () => {},
    setFilter() {},
    setMuted(value: boolean) {
      quiet = value;
    },
  };
}

const touchOnly = () => matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;

/** Is any aim saved in this browser? (Which camera it is for is known only once one opens.) */
function anySavedAim(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith("handy.aim.")) return true;
  } catch {
    // no storage, nothing saved
  }
  return false;
}

export class App {
  readonly hud: Hud;
  private readonly crosshair = new Crosshair($<HTMLCanvasElement>("crosshair"), () => this.settings.reducedMotion);
  private readonly pip = new Pip();
  private readonly yielding = new Yielding($("stage"), ["pip", "check-card", "check-meter", "hud-score", "cylinder", "hint"]);
  /** How the last aim check ended, for the tests. */
  private lastCheck: { score: number | null; shots: number; ended: "ready" | "anyway" } | null = null;
  private readonly settings: Settings;
  private host: EngineHost | null = null;
  private audio: Pick<AudioEngine, "play" | "loop" | "setFilter" | "setMuted" | "muted"> = silence(prefs.muted);
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

  constructor(private readonly options: AppOptions = {}) {
    this.settings = {
      duration: 60,
      reducedMotion: this.motion.matches,
      reducedFlashing: false,
      difficulty: "standard",
      unlocks: prefs.unlocks,
      tipsSeen: new Set(),
    };
    this.motion.addEventListener("change", () => (this.settings.reducedMotion = this.motion.matches));
    this.hud = new Hud(() => this.settings.reducedMotion);
    this.hud.onGameOver = (stats) => this.gameOver(stats);
    // A fallen player has no gun: a crosshair over the death scene read as
    // one still to be fired.
    this.hud.onPlayerDown = () => {
      this.crosshair.visible = false;
      this.crosshair.clear();
    };
    this.control = options.scripted ? "hand" : touchOnly() && prefs.control === "mouse" ? "touch" : prefs.control;
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
    $("adjust").hidden = !(hand && anySavedAim());
    $<HTMLButtonElement>("play").disabled = this.busy;
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
    this.audioReady ??= import("../audio/index").then(({ createAudioBus }) => createAudioBus({ muted: this.muted })).then(
      (audio) => {
        this.audio = audio;
        audio.setMuted(this.muted);
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
      const loaded = tagged(
        "game",
        (async () => {
          const created = await this.entry.create();
          game = created;
          if (this.options.fail === "game") throw new DownloadError("game", 404);
          await created.load(this.context(host, control), gamePart);
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
      this.begin(ready, control, adjust);
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
      if (this.session && this.session.phase !== "over") {
        this.endSession();
        this.trouble("stopped");
      }
    });
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
    else if (part === "tracker" || cause instanceof ModelError) this.trouble("model");
    else this.trouble("game");
  }

  private trouble(kind: Trouble): void {
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
    showTrouble(kind, fixes);
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

  private begin(game: Game, control: InputKind, adjust: boolean): void {
    const host = this.host!;
    const stage = $("stage");
    const viewport = () => ({ width: stage.clientWidth, height: stage.clientHeight });
    let input: InputSource & { reset(): void };
    let hand: HandInput | null = null;
    let unsubscribe = () => {};
    let camera: CameraIdentity | null = null;
    if (control === "hand") {
      const source = this.handSource();
      hand = new HandInput(source, viewport);
      input = hand;
      unsubscribe = source.subscribe((frame) => this.pip.draw(frame, performance.now()));
      this.startTracking();
      this.pip.show(!this.options.scripted);
      camera = this.camera
        ? { deviceId: this.camera.deviceId, width: this.camera.width, height: this.camera.height }
        : { deviceId: "script", width: 1280, height: 720 };
    } else {
      input = control === "touch" ? new TouchInput(stage) : new MouseInput(stage);
      this.pip.hide();
    }
    const session: Session = {
      entry: this.entry,
      game,
      control,
      input,
      hand,
      check: null,
      phase: "loading",
      paused: false,
      camera,
      unsubscribe,
      lostSince: null,
      result: null,
    };
    this.session = session;
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
    if (this.session !== session) return;
    session.check?.dispose();
    session.check = null;
    if (mapping && session.hand) session.hand.setMapping(mapping);
    session.phase = "play";
    $("game").dataset.phase = "play";
    session.game.start();
    this.host!.aim = (now) => session.input.sample(now);
    this.crosshair.visible = true;
    if (session.control !== "hand") {
      this.hud.hint(session.control === "touch" ? "Tap to fire." : "Click to fire.");
      window.setTimeout(() => this.session === session && this.hud.hint(null), 3500);
    }
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
    // A hand lost in play is said at once, and stays said until it is back.
    if (session.phase === "play" && session.control === "hand") {
      if (!aim.tracking) session.lostSince ??= now;
      else session.lostSince = null;
      this.hud.pageHint(session.lostSince !== null && now - session.lostSince > 600 ? "Show your hand to the camera." : null);
    }
  }

  private startTracking(): void {
    if (this.options.scripted) this.options.scripted.start();
    else if (this.tracker && this.camera) this.tracker.start(this.camera.video);
  }

  private stopTracking(): void {
    if (this.options.scripted) this.options.scripted.stop();
    else this.tracker?.stop();
  }

  pause(): void {
    const session = this.session;
    if (!session || session.paused || session.phase === "over" || session.phase === "loading") return;
    session.paused = true;
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
    this.host?.resume();
    $("game").focus();
  }

  private gameOver(stats: GameStats): void {
    const session = this.session;
    if (!session || session.phase === "over") return;
    session.phase = "over";
    $("game").dataset.phase = "over";
    this.crosshair.visible = false;
    this.hud.pageHint(null);
    this.stopTracking();
    // The world plays out its last moment before the card arrives.
    window.setTimeout(() => {
      if (this.session !== session) return;
      session.result = showResults(session.entry, stats, this.settings.reducedMotion);
    }, this.settings.reducedMotion ? 400 : 1200);
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
    session.check?.dispose();
    session.check = null;
    session.result = null;
    session.lostSince = null;
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
    if (session.paused) {
      session.paused = false;
      this.host!.resume();
    }
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
    $("privacy-done").onclick = () => closeSheet("privacy");
    for (const id of ["mute", "sheet-mute"]) $(id).onclick = () => this.setMuted(!this.muted);
    $("pause").onclick = () => this.pause();
    $("resume").onclick = () => this.resume();
    $("restart").onclick = () => this.restart();
    $("adjust-aim").onclick = () => this.restart(true);
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
    if (!session || document.body.dataset.view !== "game" || session.phase === "over") return;
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

  // --- for the tests and the performance report -----------------------------------------------

  /** A snapshot of the app's state (dev and test builds read it). */
  snapshot() {
    const session = this.session;
    const check = session?.check?.check;
    return {
      view: document.body.dataset.view,
      phase: session?.phase ?? null,
      paused: session?.paused ?? false,
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
    };
  }

  /** Starts the timing figures afresh, for a measurement window. */
  resetStats(): void {
    this.host?.stats.reset();
    this.tracker?.resetStats();
    this.latency.clear();
  }

  /** The current session's pieces, for the tests' own measurements. */
  get internals() {
    return { session: this.session, host: this.host, tracker: this.tracker, camera: this.camera };
  }
}
