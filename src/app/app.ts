/**
 * The arcade's page: the landing, the arcade and a game's view, and the
 * address that says which is shown (#finger-guns, #high-noon). The App owns
 * every piece of the page and hands each the few others it needs. It draws
 * the arcade, answers the page's own buttons and keys, and starts a game -
 * the camera's question and the loading bar (gettingReady.ts) - then hands it
 * to the round (round.ts) until the player comes back to the arcade, with
 * calm words for anything that goes wrong on the way.
 *
 * The other pieces: the camera and the tracker (handCamera.ts), the scope and
 * the eye (scopeInPlay.ts), the sound (sound.ts), and what Settings changes
 * (settingsHost.ts).
 */
import { WebGLUnavailable } from "../engine/common";
import { Progress } from "../engine/fetch";
import type { EngineHost } from "../engine/host";
import type { GameEntry, InputKind, Settings } from "../engine/types";
import { ARCADE, GRIP_PRIX, playable } from "../games/index";
import { AimController } from "../input/aim";
import { $, replay, toast } from "../ui/dom";
import { thisDevice, touchOnly } from "../ui/touch";
import { HeroArt, pickGame, posterInto, Shelf, shooters } from "./arcade";
import { drawArcade } from "./arcadeScreen";
import { Crosshair } from "./crosshair";
import { wireGameView } from "./gameControls";
import { askForCamera, gameContext, loadForPlay, whatWentWrong } from "./gettingReady";
import { HandCamera, type HandCameraOptions } from "./handCamera";
import { Hud } from "./hud";
import { watchKonami } from "./konami";
import { Landing } from "./landing";
import { Pip } from "./pip";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_SCOPE,
  forgetEverything,
  loadPreferences,
  loadScopePreferences,
  prefs,
  tipsSeen,
  type PersistentSet,
  type Preferences,
  type ScopePreferences,
} from "./prefs";
import { RoundController } from "./round";
import { hashFor, parseRoute, type Route } from "./route";
import { ScopeInPlay } from "./scopeInPlay";
import { SettingsSheet } from "./settings";
import { settingsHost } from "./settingsHost";
import { LoadingSheet, closeSheet, closeSheets, openSheet, showTrouble, type Fix, type Trouble } from "./sheets";
import { PageSound } from "./sound";
import { Yielding } from "./yielding";

export interface AppOptions extends HandCameraOptions {
  /** Trouble to simulate, for screenshots of every error (dev and test builds only): the camera's, `webgl`, `model` or `game`. */
  fail?: string | null;
}

export class App {
  readonly hud: Hud;
  private readonly crosshair = new Crosshair($<HTMLCanvasElement>("crosshair"), () => this.settings.reducedMotion);
  private readonly pip = new Pip();
  private readonly yielding = new Yielding($("stage"), ["pip", "check-card", "check-meter", "hud-score", "cylinder", "magazine", "heat", "clock", "hint", "eye-meter"]);
  private readonly settings: Settings;
  /** The player's choices in Settings, as saved; `settings` is what the game reads. */
  private readonly preferences: Preferences = loadPreferences();
  private readonly tips: PersistentSet = tipsSeen();
  /** How the player scopes, in the games with a scope (Settings' Scope group). */
  private readonly scopePrefs: ScopePreferences = loadScopePreferences();
  private readonly sound = new PageSound(() => this.preferences.volume);
  private readonly camera: HandCamera;
  private readonly scope: ScopeInPlay;
  /** The game in play, from its first round to the way back to the arcade. */
  private readonly round: RoundController;
  private readonly settingsSheet: SettingsSheet;
  /** The renderer, made with the first game: three.js arrives only then. */
  private host: EngineHost | null = null;
  private control: InputKind;
  private generation = 0;
  private busy = false;
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
  /** The loading sheet of a game getting ready: put away with it, before it has even shown, by Cancel or Back. */
  private loadingSheet: LoadingSheet | null = null;

  constructor(private readonly options: AppOptions = {}) {
    this.settings = {
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
    this.camera = new HandCamera(options);
    this.scope = new ScopeInPlay(this.settings, this.scopePrefs, this.camera, this.hud, () => this.round.current);
    this.round = new RoundController(
      {
        host: () => this.host,
        hud: this.hud,
        crosshair: this.crosshair,
        pip: this.pip,
        yielding: this.yielding,
        settings: this.settings,
        camera: this.camera,
      },
      this.preferences,
      this.scope,
      {
        useControl: (control) => this.setControl(control),
        back: () => this.back(),
        restoreAddress: (entry) => this.pushAddress({ space: "arcade", game: entry.id }),
      },
    );
    this.camera.onEnded = () => this.round.cameraInPlay.ended();
    this.control = options.scripted ? "hand" : touchOnly() && prefs.control === "mouse" ? "touch" : prefs.control;
    this.shooting = shooters(ARCADE);
    this.route = parseRoute(location, this.shooting);
    this.selected = pickGame(this.shooting, this.route.space === "arcade" ? this.route.game : null, prefs.game)!;
    this.shelf = new Shelf($("shelf"), this.shooting, (game, how) => this.choose(game, how));
    this.hero = new HeroArt($("feature-frame"));
    this.landing = new Landing(this.shooting, GRIP_PRIX);
    this.settingsSheet = new SettingsSheet(
      settingsHost({
        preferences: this.preferences,
        scopePrefs: this.scopePrefs,
        camera: this.camera,
        scope: this.scope,
        sound: this.sound,
        motion: this.motion,
        latency: this.round.latency,
        host: () => this.host,
        inGame: () => this.round.current !== null,
        applyPreferences: () => this.applyPreferences(),
        renderArcade: () => this.renderArcade(),
        reset: () => this.resetEverything(),
      }),
    );
    this.applyPreferences();
    this.wire();
  }

  boot(): void {
    this.renderArcade();
    this.sound.setMuted(this.sound.muted);
    // Straight in: the landing, or the space or game the address names.
    this.arrive(this.route, { remembered: true });
    // The first screen needs neither three.js nor the tracker; fetch them
    // once it is up, so Play does not wait for them.
    const later = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
    later(() => {
      void import("../engine/host");
      void import("../tracking/tracker");
    });
  }

  // --- the screens and the address -----------------------------------------------------------

  private showView(name: "landing" | "arcade" | "game"): void {
    const opened = document.body.dataset.view !== name;
    for (const view of ["landing", "arcade", "game"] as const) $(view).hidden = view !== name;
    // The bar is over the landing and the arcade; a game has its own chrome.
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
      // Play waits under the keys; a touch screen has none, and Safari would ring it before the first tap.
      if (!remembered && !touchOnly()) $("play").focus({ preventScroll: true });
      return;
    }
    this.showView("landing");
    // Standing where the player was: sent to a tile by the address, back from Grip Prix, or back from the arcade.
    const tile = route.focus ?? (remembered && prefs.space !== "grip-prix" ? null : prefs.space);
    if (tile) this.landing.focus(tile);
  }

  /** A step in the browser's history to a space (the browser's Back comes back from it). */
  private navigate(route: Route): void {
    this.pushAddress(route);
    this.arrive(route);
  }

  /** A step in the browser's history to a route's address, unless the page is there already. */
  private pushAddress(route: Route): void {
    const address = this.addressFor(route);
    if (address !== `${location.pathname}${location.search}${location.hash}`) history.pushState(null, "", address);
  }

  // --- the arcade ------------------------------------------------------------------------------

  private renderArcade(): void {
    drawArcade(this.selected, this.shelf, this.hero, {
      control: this.control,
      busy: this.busy,
      scripted: !!this.options.scripted,
      difficulty: this.preferences.difficulty,
    });
    this.round.syncDifficulty();
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

  // --- starting a game -------------------------------------------------------------------------

  /** The renderer, made on the first game: three.js arrives only then. */
  private async ensureHost(): Promise<EngineHost> {
    if (this.options.fail === "webgl") throw new WebGLUnavailable();
    if (!this.host) {
      const { EngineHost } = await import("../engine/host");
      this.host = new EngineHost($<HTMLCanvasElement>("world"));
      this.host.onContextLost = () => {
        // A game's view with no game in it has no way out (its Pause and Esc
        // answer only a game): the page goes back to the arcade, and says why.
        if (document.body.dataset.view === "game") this.back();
        else this.round.end();
        this.trouble("context");
      };
    }
    return this.host;
  }

  /** Plays the game chosen in the arcade: the camera's question if it is needed, the loading bar, then its first round. */
  async start({ adjust = false }: { adjust?: boolean } = {}): Promise<void> {
    const entry = this.selected;
    if (this.busy || !playable(entry)) return;
    this.busy = true;
    this.renderArcade();
    const run = ++this.generation;
    const stale = () => run !== this.generation;
    const scripted = this.camera.scripted;
    let loading: LoadingSheet | null = null;
    try {
      await this.sound.wake();
      if (this.control === "hand" && !scripted && !this.camera.camera) {
        const control = await askForCamera(this.scope.readsEye(entry, "hand"), (kind) => this.trouble(kind));
        if (control === null || stale()) return;
        if (control !== "hand") this.setControl(control);
      }
      const host = await this.ensureHost();
      if (stale()) return;
      const control = this.control;
      const hand = control === "hand";
      this.openGameView(entry, control);
      // The face landmarker, the first time a game that reads the eye is played with the hand.
      const eye = this.scope.readsEye(entry, control) && !scripted;
      const firstTime = hand && !scripted && ((!this.camera.tracker && !prefs.downloaded) || (eye && !this.camera.tracker?.hasFace));
      loading = new LoadingSheet(firstTime);
      this.loadingSheet = loading;
      const sheet = loading;
      const context = gameContext(host, control, this.sound.audio, this.hud, this.settings);
      const ready = await loadForPlay({
        entry,
        context,
        withCamera: hand && !scripted,
        eye,
        camera: this.camera,
        progress: new Progress((fraction) => sheet.set(fraction)),
        stale,
        fail: this.options.fail,
      });
      if (stale()) {
        ready.dispose();
        return;
      }
      loading.close();
      if (hand && !scripted) prefs.downloaded = true;
      this.round.begin(entry, ready, context, adjust);
    } catch (error) {
      loading?.close();
      if (stale()) return;
      this.fail(error);
    } finally {
      if (run === this.generation) this.busy = false;
      if (this.loadingSheet === loading) this.loadingSheet = null;
      this.renderArcade();
    }
  }

  /** The game's view, made ready for this game while it loads behind its poster. */
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

  private fail(error: unknown): void {
    const told = whatWentWrong(error);
    console.error("Nintenthropic could not start the game.", told.cause);
    this.round.end();
    this.showView("arcade");
    this.trouble(told.trouble, told.choices);
  }

  private trouble(kind: Trouble, choices?: { secondary?: Fix | null; tertiary?: Fix | null }): void {
    const fixes: Record<Fix, () => void> = {
      "Try Again": () => void this.start(),
      "Use Mouse or Trackpad": () => {
        this.camera.release();
        this.setControl(touchOnly() ? "touch" : "mouse");
        void this.start();
      },
      "Choose a Game": () => this.back(),
      Reload: () => location.reload(),
    };
    showTrouble(kind, fixes, choices);
  }

  // --- in a game -------------------------------------------------------------------------------

  pause(): void {
    this.round.pause();
  }

  resume(): void {
    this.round.resume();
  }

  /** A new game of the same kind: through the aim check again, as every game is. */
  restart(adjust = false): void {
    const session = this.round.current;
    // A game whose stage can stand its targets up again (begin) plays its
    // next round on the same instance: no reload, no second wait. Any other
    // is made afresh.
    if (session && this.host && typeof session.game.calibration.begin === "function") {
      this.round.again(session, adjust);
      return;
    }
    this.round.end();
    void this.start({ adjust });
  }

  /** Back to the arcade, on the game just played. */
  back(): void {
    this.generation++;
    this.busy = false;
    // A sheet still waiting for its moment to show must not show over the arcade.
    this.loadingSheet?.close();
    this.loadingSheet = null;
    const played = this.round.current;
    if (played) this.choose(played.entry, "link");
    this.round.end();
    this.camera.release();
    closeSheets();
    this.route = { space: "arcade", game: this.selected.id };
    this.showView("arcade");
    this.renderArcade();
    $("play").focus();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  // --- the page's own controls -----------------------------------------------------------------

  private wire(): void {
    // The page's own words say where the picture stays: on a phone or a tablet, this device.
    for (const word of document.querySelectorAll(".this-device")) word.textContent = thisDevice();
    // The first gesture on the page makes the sound engine; every button
    // after it answers with the interface's soft tap, or a rising pair of
    // notes for the ones that set something going.
    for (const type of ["pointerdown", "keydown"] as const) {
      window.addEventListener(type, () => void this.sound.wake(), { capture: true, once: true });
    }
    document.addEventListener(
      "click",
      (event) => {
        const button = (event.target as Element | null)?.closest?.("button");
        if (button && !button.disabled) this.sound.audio.play(button.dataset.sound === "confirm" ? "ui_confirm" : "ui_tap");
      },
      true,
    );
    $("play").onclick = () => void this.start();
    $("adjust").onclick = () => void this.start({ adjust: true });
    $("switch-control").onclick = () =>
      this.setControl(this.control === "hand" ? (touchOnly() ? "touch" : "mouse") : "hand");
    $("about").onclick = () => openSheet("privacy");
    $("settings-open").onclick = () => this.settingsSheet.show("home");
    $("privacy-done").onclick = () => closeSheet("privacy");
    for (const id of ["mute", "sheet-mute"]) $(id).onclick = () => this.sound.setMuted(!this.sound.muted);
    wireGameView(this.round, this.scope, {
      restart: (adjust) => this.restart(adjust),
      back: () => this.back(),
      openSettings: () => this.settingsSheet.show("pause"),
    });
    window.addEventListener("keydown", (event) => this.key(event));
    // The browser's Back and Forward, a link to a game followed on the page, the address edited:
    // the page turns to the space the address names. In a game it stays where
    // it is and pauses, so Back is answered at once and never costs a round
    // (Choose a Game is on the sheet); Resume puts the game's address back.
    const followAddress = () => {
      const view = document.body.dataset.view;
      if (view === "game" && !this.round.current) {
        // Still getting ready, there is no round to keep: Back is Cancel, to where the address now says.
        const route = parseRoute(location, this.shooting);
        this.back();
        this.arrive(route);
        return;
      }
      if (view === "game") this.pause();
      if (view !== "landing" && view !== "arcade") return;
      this.arrive(parseRoute(location, this.shooting));
    };
    window.addEventListener("popstate", followAddress);
    window.addEventListener("hashchange", followAddress);
    // The bar's wordmark is the way back to the landing (a link, so that it opens there from anywhere too).
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
    window.addEventListener("pagehide", () => this.camera.release());
    watchKonami(
      () => ["landing", "arcade"].includes(document.body.dataset.view ?? "") && !document.querySelector("dialog[open]"),
      () => this.unlockGolden(),
    );
  }

  /** M mutes and unmutes, anywhere on the page (a game's own keys are gameControls.ts's). */
  private key(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "m" && !event.repeat) {
      const muted = !this.sound.muted;
      this.sound.setMuted(muted);
      toast(muted ? "Sound off." : "Sound on.", { icon: muted ? "speaker-off" : "speaker" });
    }
  }

  private unlockGolden(): void {
    if (this.settings.unlocks.has("golden")) {
      toast("Still gold.", { icon: "star", tone: "gold" });
      return;
    }
    this.settings.unlocks.add("golden");
    prefs.unlocks = this.settings.unlocks;
    // Every game's weapon is gilded, and only until the tab is closed (prefs.unlocks).
    toast("Golden guns, until you go.", { icon: "star", tone: "gold" });
    this.sound.audio.play("ui_gold");
  }

  // --- settings and preferences ----------------------------------------------------------------

  /** Puts the player's settings into effect, everywhere one is read. */
  private applyPreferences(): void {
    const chosen = this.preferences;
    this.sound.audio.setVolume(chosen.volume);
    this.crosshair.style = { ...chosen.crosshair };
    AimController.steadiness = chosen.steadiness;
    this.round.current?.hand?.controller.setSteadiness(chosen.steadiness);
    this.pip.showInPlay = chosen.cameraInPlay;
    this.settings.reducedFlashing = chosen.reduceFlashing;
    // Games read it live, on every shot: a change reaches the round in play.
    this.settings.aimAssist = chosen.aimAssist;
    this.applyMotion();
    this.round.syncDifficulty();
  }

  /** Reduced motion, the player's or else the system's, for the page's code and its styles alike. */
  private applyMotion(): void {
    const reduce = this.preferences.reduceMotion ?? this.motion.matches;
    this.settings.reducedMotion = reduce;
    document.documentElement.toggleAttribute("data-reduce-motion", reduce);
  }

  /** Reset Everything: everything it keeps is forgotten, and it starts again as on the first visit. */
  private resetEverything(): void {
    if (this.round.current) this.back();
    closeSheets();
    this.camera.release();
    Object.assign(this.preferences, { ...DEFAULT_PREFERENCES, crosshair: { ...DEFAULT_PREFERENCES.crosshair } });
    Object.assign(this.scopePrefs, DEFAULT_SCOPE);
    this.tips.forgetInMemory();
    this.settings.unlocks.clear();
    this.control = "hand";
    this.sound.setMuted(false);
    this.applyPreferences();
    // Last, so nothing written on the way survives it.
    forgetEverything();
    // As on the first visit: the landing, standing on Finger Guns.
    this.route = { space: "landing", focus: null };
    history.replaceState(history.state, "", this.addressFor(this.route));
    this.renderArcade();
    this.arrive(this.route);
    this.landing.focus("arcade");
  }

  // --- for the tests and the performance report ------------------------------------------------

  /** A snapshot of the app's state (dev and test builds read it). */
  snapshot() {
    const session = this.round.current;
    const check = session?.check?.check;
    const tracker = this.camera.tracker;
    return {
      view: document.body.dataset.view,
      phase: session?.phase ?? null,
      paused: session?.paused ?? false,
      held: session?.held ?? false,
      troubled: session?.troubled ?? false,
      idle: session?.idle ?? false,
      hold: $("game").dataset.hold ?? null,
      running: this.host?.isRunning ?? false,
      tracking: this.camera.tracking,
      input: session?.control ?? null,
      control: this.control,
      lit: check?.lit ?? null,
      score: check?.measure.score ?? null,
      shots: check?.shots ?? 0,
      checkDone: session?.check?.done ?? false,
      lastCheck: this.round.lastCheck,
      tracker: tracker ? { where: tracker.where, delegate: tracker.delegate, stats: tracker.stats() } : null,
      frames: this.host?.stats.summary() ?? null,
      latency: this.round.latency.summary(),
      quality: this.host ? { ...this.host.quality, gpu: this.host.gpu } : null,
      unlocks: [...this.settings.unlocks],
      // What the game reads, and what the player chose.
      difficulty: this.settings.difficulty,
      reducedMotion: this.settings.reducedMotion,
      reducedFlashing: this.settings.reducedFlashing,
      aimAssist: this.settings.aimAssist,
      tipsSeen: [...this.settings.tipsSeen],
      preferences: { ...this.preferences, crosshair: { ...this.preferences.crosshair } },
      smoothing: session?.hand?.controller.smoothing ?? null,
      showCameraInPlay: this.pip.showInPlay,
      game: session?.entry.id ?? this.selected.id,
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
    this.camera.tracker?.resetStats();
    this.round.latency.clear();
  }

  /** As if the camera had been unplugged mid-game (dev and test builds). */
  unplugCamera(): void {
    const scripted = this.camera.scripted;
    if (scripted) scripted.stop();
    else this.camera.release();
    this.round.cameraInPlay.ended();
  }

  /** The current session's pieces, for the tests' own measurements. */
  get internals() {
    return { session: this.round.current, host: this.host, tracker: this.camera.tracker, camera: this.camera.camera };
  }
}
