/**
 * Grip Prix's page: which screen shows, and what moves between them.
 *
 *   start → you → (wheel check) → lobby → race → results → lobby ...
 *
 * The screens are written against `Services` (services.ts) and the contract's
 * `Session`; this is the one place that knows the order. A room (a Session)
 * is opened at the start screen, so a wrong code is found before anyone
 * has set anything up; the player's name and controls go to it from the You
 * screen; and from then on the room's own phase (lobby, racing, results)
 * says which screen to show.
 */
import { loadPreferences, prefs } from "../../app/prefs";
import type { MusicKind } from "../audio";
import { GRIP_PRIX } from "../../games/index";
import { $, announce } from "../../ui/dom";
import { backdropCss } from "../../ui/backdrop";
import {
  PLAYER_COLOURS,
  type DriverControl,
  type KartView,
  type LobbyState,
  type LocalPlayerSetup,
  type RacerSetup,
  type Session,
  type SessionClosed,
} from "../contract";
import { CheckScreen } from "./check";
import { LobbyScreen, type ScreenChoice } from "./lobby";
import { loadYou, saveYou, wheelChecked, type You } from "./prefs";
import { RaceScreen, type RaceFailure } from "./race";
import { ResultsScreen } from "./results";
import { kartOf, localPlayers } from "./roster";
import { CameraFailure, SessionFailure, type Services, type SessionOptions, type SoundReport, type WheelControl } from "./services";
import { SoundControls } from "./soundui";
import { StartScreen, type StartChoice } from "./start";
import { AwakeWhileRacing } from "./wake";
import { closeTrouble, showTrouble, type Fix, type TroubleKind } from "./troubles";
import { YouScreen } from "./you";

export type ScreenName = "start" | "you" | "check" | "lobby" | "race" | "results";

export interface KartAppOptions {
  /** `?net=local`: several tabs of one browser as the network (development, tests). */
  net?: "local";
  /** `?join=CODE`: go straight to joining this room. */
  join?: string | null;
  /** The page's address as a friend on the network opens it (for the lobby's code and link); the page's own by default. */
  page?: () => string;
}

/** How long the finish stays in view before the results cover it, ms. */
const FINISH_HOLD = 1500;

/** What `KartApp.snapshot` says. */
export interface KartAppSnapshot {
  screen: ScreenName;
  role: Session["role"] | null;
  device: string | null;
  lobby: LobbyState | null;
  race: { tick: number; phase: string; time: number; countdown: number; laps: number; trackId: string; karts: readonly KartView[] } | null;
  views: number[];
  mine: (number | null)[];
  /** What the sound is doing (a test cannot hear it). */
  sound: SoundReport;
}

export class KartApp {
  private readonly startScreen: StartScreen;
  private readonly youScreen: YouScreen;
  private readonly checkScreen: CheckScreen;
  private readonly lobbyScreen: LobbyScreen;
  private readonly raceScreen: RaceScreen;
  private readonly resultsScreen: ResultsScreen;

  private screen: ScreenName = "start";
  private session: Session | null = null;
  private intent: StartChoice = "practice";
  private you: You = loadYou();
  private controls: DriverControl[] = [];
  /** Where this player chose to watch, or null: wherever the host says (the room's `display`). */
  private choice: ScreenChoice | null = null;
  /** The race the race screen shows, so a restart (a new race in the same phase) is noticed. */
  private raceId: number | undefined;
  private readonly wake = new AwakeWhileRacing();
  private readonly soundControls: SoundControls;
  /** How many were in the lobby, and how many ready, when it last changed: a join, a leave or a tick has its sound. */
  private crowd = { count: 0, ready: 0 };
  /** The You screen (and the wheel check) are done: the room's phase now says what to show. */
  private ready = false;
  /** Counts attempts to open a room, so a slow one that was given up on is dropped. */
  private attempt = 0;
  private finishTimer = 0;
  private racers: readonly RacerSetup[] = [];
  private unlisten: (() => void)[] = [];

  constructor(
    private readonly services: Services,
    private readonly options: KartAppOptions = {},
  ) {
    this.startScreen = new StartScreen({
      host: () => void this.open("host"),
      join: (code) => void this.open("join", code),
      practice: () => void this.open("practice"),
    });
    this.youScreen = new YouScreen({
      back: () => this.leave(),
      next: (you) => void this.youDone(you),
    });
    this.checkScreen = new CheckScreen(services, {
      back: () => this.openYou(),
      done: () => this.checkDone(),
    });
    this.lobbyScreen = new LobbyScreen(
      services,
      {
        start: () => this.session?.start(),
        leave: () => this.leave(),
        configure: (settings) => this.session?.configure(settings),
        screen: (choice) => {
          this.choice = choice;
          this.sendPlayers();
        },
      },
      () => options.page?.() ?? location.href,
      options.net,
    );
    this.raceScreen = new RaceScreen(services, {
      leave: () => this.leave(),
      restart: () => this.restart(),
      failed: (kind) => this.loadFailed(kind),
    });
    this.resultsScreen = new ResultsScreen({
      again: () => this.again(),
      lobby: () => this.backToLobby(),
    });
    this.soundControls = new SoundControls(services.sound);
  }

  /**
   * What the page is showing and how the race stands, as plain data: for the
   * end-to-end tests, which drive the karts by keyboard from outside. `mine`
   * is the kart of each player on this device.
   */
  snapshot(): KartAppSnapshot {
    const session = this.session;
    const lobby = session?.lobby() ?? null;
    const view = this.raceScreen.lastView;
    return {
      screen: this.screen,
      role: session?.role ?? null,
      device: session?.device ?? null,
      lobby,
      race: view ? { tick: view.tick, phase: view.phase, time: view.time, countdown: view.countdown, laps: view.laps, trackId: view.track.id, karts: view.karts } : null,
      views: session?.views() ?? [],
      mine: lobby && session ? localPlayers(lobby, session.device).map((player) => kartOf(lobby, player.slot)) : [],
      sound: this.services.sound.report(),
    };
  }

  boot(): void {
    // The page's colours come from the game's own light (games/index.ts), as the arcade's card does.
    // The start screen draws the meadow and the sun's glow apart, so the glow can lie over the hills and road too.
    const light = GRIP_PRIX.backdrop;
    const style = document.documentElement.style;
    style.setProperty("--world", backdropCss(light));
    if (light) {
      style.setProperty("--meadow", backdropCss({ sky: light.sky }));
      style.setProperty("--glow", backdropCss({ sky: [["transparent", 0]], glow: light.glow }));
    }
    // Reduced motion, the player's own choice in the arcade's Settings or else the system's.
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => document.documentElement.toggleAttribute("data-reduce-motion", loadPreferences().reduceMotion ?? motion.matches);
    motion.addEventListener("change", apply);
    apply();
    this.listenForSound();
    this.show("start");
    const code = this.options.join;
    if (code) {
      this.startScreen.setCode(code);
      void this.open("join", code);
    }
  }

  // --- sound -----------------------------------------------------------------------------------------------

  /**
   * Browsers start audio only after a gesture: the page's first click or key
   * press wakes the sound. After it every button answers with a sound of the
   * interface's, and M turns sound off and on, as it does in the arcade.
   */
  private listenForSound(): void {
    const { sound } = this.services;
    for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, () => sound.wake(), { capture: true, once: true });
    document.addEventListener(
      "click",
      (event) => {
        const button = (event.target as Element | null)?.closest?.("button");
        if (!button || button.disabled || button.closest(".sound-control")) return;
        const back = button.classList.contains("back") || ["pause-leave", "results-lobby"].includes(button.id);
        const go = ["lobby-start", "results-again"].includes(button.id);
        sound.play(go ? "ui-start" : back ? "ui-back" : "ui-select");
      },
      true,
    );
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() !== "m" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      this.soundControls.toggle();
    });
  }

  /** The music of a screen: the menus' tune, the lobby's (the same tune), and none in a race, which has its own. */
  private music(screen: ScreenName): void {
    const tunes: Record<Exclude<ScreenName, "results">, MusicKind | null> = { start: "menu", you: "menu", check: "menu", lobby: "lobby", race: null };
    // The results choose theirs when they know whether the player won.
    if (screen !== "results") this.services.sound.music(tunes[screen]);
  }

  // --- screens -------------------------------------------------------------------------------------------

  private show(screen: ScreenName): void {
    this.screen = screen;
    for (const name of ["start", "you", "check", "lobby", "race", "results"] as const) $(`screen-${name}`).hidden = name !== screen;
    document.body.dataset.screen = screen;
    this.music(screen);
    // A phone propped up as a wheel is not touched for minutes: its screen stays on from the wheel check to the end.
    if (screen === "start" || screen === "you") this.wake.release();
    else this.wake.hold();
    window.scrollTo(0, 0);
    const title = { start: "Grip Prix", you: "Who’s Driving?", check: "Wheel Check", lobby: "Lobby", race: "Race", results: "Results" }[screen];
    document.title = screen === "start" ? "Grip Prix" : `${title} · Grip Prix`;
    if (screen === "race") announce("The race is on.");
  }

  // --- opening a room ---------------------------------------------------------------------------------------

  private get sessionOptions(): SessionOptions {
    return this.options.net ? { net: this.options.net } : {};
  }

  /** Opens (or joins, or starts alone) a room, then moves on to You. */
  private async open(kind: StartChoice, code?: string): Promise<void> {
    const attempt = ++this.attempt;
    this.startScreen.setBusy(kind);
    try {
      const options = this.sessionOptions;
      const session =
        kind === "host" ? await this.services.host(options) : kind === "join" ? await this.services.join(code!, options) : await this.services.solo(options);
      if (attempt !== this.attempt) {
        session.leave();
        return;
      }
      this.startScreen.setBusy(null);
      this.attach(session, kind);
      this.openYou();
    } catch (error) {
      if (attempt !== this.attempt) return;
      this.startScreen.setBusy(null);
      const reason = error instanceof SessionFailure ? error.reason : "network";
      this.closedStart(kind, reason, code);
    }
  }

  private attach(session: Session, kind: StartChoice): void {
    this.detach();
    this.session = session;
    this.intent = kind;
    this.ready = false;
    this.choice = null;
    this.unlisten = [session.onLobby((lobby) => this.lobbyChanged(lobby)), session.onClosed((reason) => this.closed(reason))];
  }

  private detach(): void {
    for (const stop of this.unlisten) stop();
    this.unlisten = [];
  }

  // --- you, the camera, the check --------------------------------------------------------------------------------

  private openYou(): void {
    this.checkScreen.stop();
    this.services.camera.stop();
    this.ready = false;
    this.youScreen.open(this.you, this.intent);
    this.show("you");
  }

  private async youDone(you: You): Promise<void> {
    if (!this.session) return;
    this.you = you;
    saveYou(you);
    this.makeControls();
    this.sendPlayers();
    if (you.drive !== "wheel") {
      this.session.setReady(true);
      this.enterLobby();
      return;
    }
    this.youScreen.setBusy(true);
    const on = await this.cameraOn(you.second ? 4 : 2);
    this.youScreen.setBusy(false);
    if (!this.session) {
      // Left while the camera was starting: it must not stay on with nobody to use it.
      this.services.camera.stop();
      return;
    }
    if (!on) return;
    this.show("check");
    const lobby = this.session.lobby();
    const mine = localPlayers(lobby, this.session.device);
    const names = you.second ? [you.name, you.secondName] : [you.name];
    this.session.setReady(false);
    this.checkScreen.start(
      (this.controls as WheelControl[]).map((control, i) => ({
        name: names[i] ?? "",
        colour: mine[i]?.colour ?? PLAYER_COLOURS[i % PLAYER_COLOURS.length]!,
        control,
      })),
      wheelChecked(),
    );
  }

  private checkDone(): void {
    this.session?.setReady(true);
    this.enterLobby();
  }

  /** The wheel players' controls, or the keyboard's or the pad's: one per player on this device. */
  private makeControls(): void {
    this.disposeControls();
    const { controls } = this.services;
    const you = this.you;
    if (you.drive === "wheel") {
      const base = { steering: you.steering };
      this.controls = you.second ? [controls.wheel({ ...base, half: "left" }), controls.wheel({ ...base, half: "right" })] : [controls.wheel(base)];
    } else {
      this.controls = [you.drive === "keyboard" ? controls.keyboard() : controls.gamepad()];
    }
  }

  private disposeControls(): void {
    for (const control of this.controls) control.dispose();
    this.controls = [];
  }

  /** Tells the room who is playing on this device (again, when the screen choice changes). */
  private sendPlayers(): void {
    const session = this.session;
    if (!session || !this.controls.length) return;
    const names = this.you.drive === "wheel" && this.you.second ? [this.you.name, this.you.secondName] : [this.you.name];
    const screen = session.role === "guest" ? (this.choice ?? "auto") : "here";
    const second = (i: number): boolean => i === 1;
    const players: LocalPlayerSetup[] = this.controls.map((control, i) => ({
      name: names[i] ?? this.you.name,
      control,
      screen,
      character: second(i) ? this.you.secondCharacter : this.you.character,
      golden: second(i) ? this.you.secondGolden : this.you.golden,
    }));
    session.setLocalPlayers(players);
    // A change of screen does not undo being ready.
    if (this.ready) session.setReady(true);
  }

  /** Before the browser asks for the camera, say why; then start it. False: the player is not going on with the wheel (yet). */
  private async cameraOn(hands: 2 | 4): Promise<boolean> {
    const { camera } = this.services;
    const permission = await camera.permission();
    if (permission === "denied") return this.cameraTrouble("camera-denied");
    if (permission === "prompt" && !prefs.cameraOpened) {
      const answer = await this.prime();
      if (answer === "keyboard") {
        this.useKeyboard();
        return false;
      }
      if (answer === "stay") return false;
    }
    try {
      await camera.start(hands, (fraction) => this.youScreen.setBusy(true, fraction));
      prefs.cameraOpened = true;
      return true;
    } catch (error) {
      const trouble = error instanceof CameraFailure ? error.trouble : "busy";
      return this.cameraTrouble(`camera-${trouble}` as TroubleKind);
    }
  }

  private prime(): Promise<"go" | "keyboard" | "stay"> {
    return new Promise((resolve) => {
      const sheet = $<HTMLDialogElement>("prime");
      const done = (answer: "go" | "keyboard" | "stay") => {
        sheet.oncancel = null;
        sheet.onclose = null;
        if (sheet.open) sheet.close();
        resolve(answer);
      };
      $("prime-continue").onclick = () => done("go");
      $("prime-keys").onclick = () => done("keyboard");
      sheet.onclose = () => done("stay");
      sheet.showModal();
      $("prime-continue").focus();
    });
  }

  /** The camera would not start: say why, and offer another try or the keyboard. Always false. */
  private cameraTrouble(kind: TroubleKind): false {
    const again: Fix = { label: "Try Again", run: () => void this.youDone(this.you) };
    const keys: Fix = { label: "Drive With Keyboard", run: () => this.useKeyboard() };
    showTrouble(kind, kind === "camera-insecure" ? [keys, { label: "Back", run: () => this.openYou() }] : [again, keys]);
    return false;
  }

  /** Drives with the keyboard instead: no camera, no check. */
  private useKeyboard(): void {
    this.you = { ...this.you, drive: "keyboard", second: false };
    saveYou(this.you);
    this.services.camera.stop();
    this.makeControls();
    this.sendPlayers();
    this.session?.setReady(true);
    this.enterLobby();
  }

  // --- the room's phases ----------------------------------------------------------------------------------------------

  private enterLobby(): void {
    const session = this.session;
    if (!session) return;
    this.ready = true;
    const lobby = session.lobby();
    if (lobby.phase === "racing") this.enterRace(lobby);
    else {
      this.showLobby(lobby);
    }
  }

  private showLobby(lobby = this.session?.lobby()): void {
    if (!lobby || !this.session) return;
    window.clearTimeout(this.finishTimer);
    this.raceScreen.end();
    this.crowd = { count: lobby.players.length, ready: lobby.players.filter((player) => player.ready).length };
    this.show("lobby");
    this.lobbyScreen.render(lobby, this.session, this.where(lobby));
  }

  /** Where this player's race shows, as the lobby says it: their own choice, else the host's. */
  private where(lobby: LobbyState): ScreenChoice {
    return this.choice ?? (lobby.settings.display === "host" ? "host" : "here");
  }

  private lobbyChanged(lobby: LobbyState): void {
    // Still choosing a name or setting up the wheel: the room's phases are not ours yet.
    if (!this.ready || !this.session) return;
    switch (lobby.phase) {
      case "racing":
        // A first start, or a restart: the same phase, a different race.
        if (this.screen !== "race" || lobby.race !== this.raceId) this.enterRace(lobby);
        break;
      case "results":
        if (this.screen === "race") this.finishRace(lobby);
        break;
      case "lobby":
        if (this.screen === "race" || this.screen === "results") this.showLobby(lobby);
        break;
    }
    if (this.screen === "lobby") {
      this.lobbyScreen.render(lobby, this.session, this.where(lobby));
      this.hearTheRoom(lobby);
    }
  }

  /** A friend joins, leaves, or is ready: each has its sound in the lobby. */
  private hearTheRoom(lobby: LobbyState): void {
    const count = lobby.players.length;
    const ready = lobby.players.filter((player) => player.ready).length;
    const { sound } = this.services;
    if (count > this.crowd.count) sound.play("ui-join");
    else if (count < this.crowd.count) sound.play("ui-leave");
    else if (ready > this.crowd.ready) sound.play("ui-ready");
    this.crowd = { count, ready };
  }

  private enterRace(lobby: LobbyState): void {
    const session = this.session;
    if (!session) return;
    window.clearTimeout(this.finishTimer);
    this.raceId = lobby.race;
    const mine = localPlayers(lobby, session.device);
    this.show("race");
    this.raceScreen.begin({ session, controls: this.controls.slice(0, mine.length), players: mine });
  }

  /** The race is over: its last moment stays in view a beat, then the results. */
  private finishRace(lobby: LobbyState): void {
    window.clearTimeout(this.finishTimer);
    this.finishTimer = window.setTimeout(() => this.showResults(lobby), FINISH_HOLD);
  }

  private showResults(lobby: LobbyState): void {
    const session = this.session;
    const result = lobby.result ?? session?.lobby().result;
    if (!session || !result) return;
    this.racers = this.raceScreen.lastView?.racers ?? this.racers;
    this.raceScreen.end();
    const track = this.services.tracks.find((candidate) => candidate.id === lobby.settings.track);
    this.resultsScreen.render({ result, lobby, session, racers: this.racers, laps: lobby.settings.laps, trackName: track?.name ?? "" });
    this.show("results");
    // A win has its own tune.
    const mine = new Set(localPlayers(lobby, session.device).map((player) => kartOf(lobby, player.slot)));
    const first = result.standings.find((row) => row.place === 1);
    this.services.sound.music(first && mine.has(first.kart) ? "results-win" : "results");
  }

  /** Restart (the host's pause sheet): this race again from the countdown, the same people. */
  private restart(): void {
    const session = this.session;
    if (!session || session.role === "guest") return;
    window.clearTimeout(this.finishTimer);
    session.restart();
  }

  /** Race again (the host's): back to the lobby and straight off. If the room is not ready to, the lobby is where we wait. */
  private again(): void {
    const session = this.session;
    if (!session || session.role === "guest") return;
    window.clearTimeout(this.finishTimer);
    session.backToLobby();
    session.start();
    if (session.lobby().phase !== "racing") this.showLobby();
  }

  private backToLobby(): void {
    const session = this.session;
    if (!session) return;
    if (session.role !== "guest") session.backToLobby();
    this.showLobby();
  }

  private loadFailed(kind: RaceFailure): void {
    const session = this.session;
    showTrouble(kind, [
      { label: "Try Again", run: () => session && this.enterRace(session.lobby()) },
      { label: "Leave Race", run: () => this.leave() },
    ]);
  }

  // --- leaving, and the room closing ----------------------------------------------------------------------------------

  /** The player leaves: the room is let go, the camera and controls too, and it is the start screen again. */
  private leave(): void {
    this.attempt++;
    this.teardown();
    this.showStart();
  }

  private teardown(): void {
    window.clearTimeout(this.finishTimer);
    this.checkScreen.stop();
    this.raceScreen.end();
    this.detach();
    const session = this.session;
    this.session = null;
    this.ready = false;
    session?.leave();
    this.disposeControls();
    this.services.camera.stop();
  }

  private showStart(): void {
    closeTrouble();
    this.startScreen.setBusy(null);
    this.startScreen.setCode("");
    // A link's ?join= is spent once we are back here: a refresh starts fresh.
    const url = new URL(location.href);
    if (url.searchParams.has("join")) {
      url.searchParams.delete("join");
      history.replaceState(history.state, "", url);
    }
    this.show("start");
  }

  /** The room ended under us. */
  private closed(reason: SessionClosed): void {
    this.attempt++;
    this.teardown();
    if (reason === "left") {
      this.showStart();
      return;
    }
    this.closedStart(this.intent, reason);
  }

  /** Back at the start, with a sheet saying what happened and the way on. */
  private closedStart(kind: StartChoice, reason: SessionClosed, code?: string): void {
    this.show("start");
    this.startScreen.setBusy(null);
    const toStart: Fix = { label: "Back to Start", run: () => this.showStart() };
    switch (reason) {
      case "not-found":
        showTrouble("not-found", [
          {
            label: "Try Again",
            run: () => {
              this.showStart();
              if (code) this.startScreen.setCode(code);
              this.startScreen.focusCode();
            },
          },
        ]);
        break;
      case "full":
        showTrouble("full", [toStart, { label: "Host a Race", run: () => void this.open("host") }]);
        break;
      case "host-left":
        showTrouble("host-left", [toStart]);
        break;
      case "started":
        showTrouble("started", [toStart]);
        break;
      case "version":
        showTrouble("version", [{ label: "Reload", run: () => location.reload() }, toStart]);
        break;
      default:
        showTrouble("network", [kind === "host" ? { label: "Try Again", run: () => void this.open("host") } : toStart, ...(kind === "host" ? [toStart] : [])]);
    }
  }
}
