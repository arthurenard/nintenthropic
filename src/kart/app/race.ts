/**
 * The race screen: the world full-window with each viewport's HUD (the
 * renderer's), a pause button in the corner, and for every wheel player on
 * this device a small picture of their wheel. On the host's or the guest's
 * own screen the renderer draws; a guest who chose the host's big screen has
 * no viewport here, so this device shows a controller instead: the large
 * wheel picture and their place, lap and item, big enough to read from a phone
 * propped up a long arm's length away.
 *
 * Every animation frame it asks the session for the race (`session.frame`),
 * which also samples this device's controls and, on the host, steps the sim.
 *
 * Pausing is the session's, like a console's: practice stops, and so does a
 * room watched on the host's screen ("Paused" on every device, then a 3-2-1);
 * a screen whose race is its own only covers itself and the race goes on.
 *
 * As each of this device's wheel players crosses the line, their camera takes
 * a few stills and keeps the one that caught them celebrating: their
 * finish-line photo (finishPhotos.ts says when and which), for the results here
 * and, through the session, everywhere else in the room.
 */
import { WebGLUnavailable } from "../../engine/common";
import type { DriverControl, EdgeWay, ItemKind, KartView, LobbyPlayer, LobbyState, RaceRenderer, RaceView, Session } from "../contract";
import { $, element, setText, toast } from "../../ui/dom";
import { layoutViews } from "../render/layout";
import { EDGE_WORDS, EdgeHint } from "./edgeHint";
import { PHOTO_GAP, recordDuck, taunts, tricksFor } from "./eggs";
import { FinishShutter, PhotoBurst, reaction } from "./finishPhotos";
import { itemWords, lapLabel, list, ordinal } from "./format";
import { FrameRate } from "./graphicsui";
import { HandsFirst, type TrackerCounts } from "./handsFirst";
import { LoadingScreen, raceWords } from "./loading";
import { loadFinishPhoto, saveFinishPhoto } from "./prefs";
import { hostName, kartOf } from "./roster";
import type { Disposable, RaceSound, Services, Still } from "./services";
import { colourDot, Switch } from "./ui";

export type RaceFailure = "load" | "webgl";

export interface RaceHooks {
  leave(): void;
  restart(): void;
  /** The renderer could not start or load the race. */
  failed(kind: RaceFailure): void;
  /** A finish-line photo of one of this device's players is ready (their kart, the race it was, the JPEG). */
  photo?(shot: { kart: number; race: number; photo: string }): void;
}

export interface RaceContext {
  session: Session;
  /** This device's controls, in the order of `players`. */
  controls: DriverControl[];
  /** This device's players in the lobby. */
  players: LobbyPlayer[];
}

/**
 * Hands gone this long, ms, before "Show Both Hands" appears (a flicker does not count). Shorter than the wheel check's
 * LOST_FOR because it counts from the wheel's own "lost", which has already waited 0.3 s with no hand in view
 * (input/wheel.ts, `noHands.mode`): the pill comes about 0.6 s after the hands go.
 */
const LOST_FOR = 300;
/** Hands gone this long, ms, before the host's big screen is told (it says it in their viewport). */
const REPORT_AFTER = 1500;
/** A viewport is taunted at most once in this long, ms. */
const TAUNT_GAP = 2500;

export class RaceScreen {
  private ctx: RaceContext | null = null;
  private running = false;
  private raf = 0;
  private last = 0;
  /** The pause sheet is open and the whole room is stopped behind it: closing it resumes. */
  private stopped = false;
  /** The sheet is closing because the player is leaving or restarting, not resuming. */
  private leaving = false;
  private mode: "pending" | "world" | "controller" | "failed" = "pending";
  private canvas: HTMLCanvasElement | null = null;
  private renderer: RaceRenderer | null = null;
  /** The race's engines and music, on a screen that shows the race (a device that is only a wheel makes none). */
  private sound: RaceSound | null = null;
  /** The sound is held still: the pause sheet is open, or the host has stopped the race. */
  private hushed = false;
  private loaded = false;
  private watch: ResizeObserver | null = null;
  private previews: Disposable[] = [];
  private lostSince: (number | null)[] = [];
  /** "Move Left" and the like, for each of this device's wheels: their hands are nearing the edge of the camera's view. */
  private edges: EdgeHint[] = [];
  private reported = "";
  private shownViews = "";
  /** What the renderer was last told each kart drives with (as a key), and the lobby that was worked out from. */
  private shownKinds = "";
  private kindsFor: LobbyState | null = null;
  /** The race stage's size, CSS px, as `fit` last measured it (the pills are laid out against it every frame, and a measure each frame would flush the page's layout). */
  private stage = { w: 0, h: 0 };
  /** The race's resolution while the hand tracker beside it is short of the GPU (handsFirst.ts). */
  private readonly handsFirst = new HandsFirst();
  private veilKey = "";
  private pillsKey = "";
  /** The easter eggs: the last event looked at, the tick it was on, the finishes so far, and the photo finish's still. */
  private eggEvent = -1;
  private eggTick = 0;
  private finishes: { place: number; time: number }[] = [];
  private still: string | null = null;
  /** How many times the drone has carried each kart back to the road (the results tease about it). */
  private rescues = new Map<number, number>();
  /** When this device's wheel players' finish-line photos are taken, and their karts (worked out once a lobby). */
  private readonly shutter = new FinishShutter();
  private cameraKarts: number[] = [];
  private cameraFor: LobbyState | null = null;
  /** The bursts of stills being taken after the line, by kart (they outlive `end` for the moment they need). */
  private bursts = new Map<number, { burst: PhotoBurst<Still>; control: DriverControl; session: Session; race: number }>();
  /** When each viewport's kart was last taunted, ms. */
  private taunted = new Map<number, number>();
  private cards: { place: HTMLElement; lap: HTMLElement; item: HTMLElement; slot: number }[] = [];
  private banner = "";
  private view: RaceView | null = null;
  private readonly sheet = $<HTMLDialogElement>("pause-sheet");
  private readonly loadingUi = new LoadingScreen();
  /** The small frame-rate readout, when the pause sheet's Frame Rate switch has it on. */
  private readonly rate = new FrameRate($("race-fps"));
  /** The pause sheet's Finish Photo switch (for a device with a wheel player): kept, and true for the photo still to come. */
  private readonly photoSwitch = new Switch($<HTMLButtonElement>("pause-photo"), (on) => saveFinishPhoto(on));

  /** The readout on or off (the pause sheet's switch, and the setting as it was kept). */
  showFrameRate(on: boolean): void {
    this.rate.show(on);
  }

  constructor(
    private readonly services: Services,
    private readonly hooks: RaceHooks,
  ) {
    $("race-pause").addEventListener("click", () => this.pause());
    $("pause-resume").addEventListener("click", () => this.sheet.close());
    $("pause-restart").addEventListener("click", () => {
      this.leaving = true;
      this.sheet.close();
      hooks.restart();
    });
    $("pause-leave").addEventListener("click", () => {
      this.leaving = true;
      this.sheet.close();
      hooks.leave();
    });
    // However the sheet closes (Resume, Escape, P), a room that was stopped for it picks the race up again.
    this.sheet.addEventListener("close", () => {
      if (this.stopped && !this.leaving) this.ctx?.session.resume();
      this.stopped = false;
      this.leaving = false;
    });
    window.addEventListener("keydown", (event) => this.key(event));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden || !this.running) return;
      // A tab put away while practising: the race waits, behind the sheet.
      if (this.ctx?.session.role === "solo") this.pause();
      // A hidden page gets no frames, and the frame is what quiets the engines: they would drone on behind the other tabs.
      this.hush(true);
    });
  }

  /** The last race view drawn: the results use its grid for names and colours. */
  get lastView(): RaceView | null {
    return this.view;
  }

  /** A picture of the finish if two karts crossed the line together for a top-three place (it outlives `end`, until the next race). */
  get photo(): string | null {
    return this.still;
  }

  /** Each kart's rescues by the drone in the race shown last (it outlives `end`, until the next race). */
  get rescued(): ReadonlyMap<number, number> {
    return this.rescues;
  }

  begin(ctx: RaceContext): void {
    this.end();
    this.ctx = ctx;
    this.running = true;
    this.mode = "pending";
    this.loaded = false;
    this.view = null;
    this.shownViews = "";
    this.shownKinds = "";
    this.kindsFor = null;
    this.veilKey = "";
    this.pillsKey = "";
    this.eggEvent = -1;
    this.eggTick = 0;
    this.finishes = [];
    this.still = null;
    this.rescues = new Map();
    this.taunted = new Map();
    this.shutter.reset();
    this.cameraFor = null;
    $("view-toasts").replaceChildren();
    this.reported = "";
    this.banner = "";
    this.hushed = false;
    this.sound = this.services.sound.race();
    this.last = 0;
    this.stopped = false;
    this.leaving = false;
    this.lostSince = ctx.controls.map(() => null);
    this.edges = ctx.controls.map(() => new EdgeHint());
    this.handsFirst.reset();
    $("controller").hidden = true;
    $("race-previews").replaceChildren();
    $("view-notes").replaceChildren();
    $("pause-veil").hidden = true;
    $("lost-hands").hidden = true;
    const lobby = ctx.session.lobby();
    this.loadingUi.begin(raceWords(lobby.settings, lobby.grandPrix), ctx.controls[0]?.kind ?? null);
    this.loading(true, 0);
    this.pauseNote();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  end(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    // A burst cut short keeps the best still it has.
    for (const kart of [...this.bursts.keys()]) this.develop(kart);
    this.loadingUi.end();
    this.leaving = true;
    if (this.sheet.open) this.sheet.close();
    this.watch?.disconnect();
    this.watch = null;
    this.sound?.dispose();
    this.sound = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas?.remove();
    this.canvas = null;
    for (const preview of this.previews) preview.dispose();
    this.previews = [];
    this.cards = [];
    $("race-previews").replaceChildren();
    $("controller-cards").replaceChildren();
    $("view-notes").replaceChildren();
    $("view-toasts").replaceChildren();
    $("kart-hud").replaceChildren();
    $("lost-hands").hidden = true;
    $("pause-veil").hidden = true;
    this.ctx = null;
  }

  // --- pausing ---------------------------------------------------------------------------------------

  pause(): void {
    const ctx = this.ctx;
    if (!this.running || !ctx || this.sheet.open) return;
    // Practice and a room watched on the host's screen stop for everyone; a screen of its own only covers itself.
    this.stopped = ctx.session.pause();
    this.pauseNote();
    this.tricks();
    // The Finish Photo switch, for a device whose players include one on the wheel (a camera to take it with).
    const camera = ctx.controls.some((control) => control.kind === "wheel");
    $("photo-row").hidden = !camera;
    $("photo-note").hidden = !camera;
    this.photoSwitch.on = loadFinishPhoto();
    this.sheet.showModal();
    $("pause-resume").focus();
  }

  private key(event: KeyboardEvent): void {
    if (!this.running || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    if (event.key === "Escape" && !this.sheet.open && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      this.pause();
    } else if ((event.key === "p" || event.key === "P") && !event.repeat) {
      if (this.sheet.open) this.sheet.close();
      else if (!document.querySelector("dialog[open]")) this.pause();
    } else if ((event.key === "f" || event.key === "F") && !event.repeat) {
      // The TV wants the whole screen. (Not a key any driver uses.)
      void this.fullScreen();
    }
  }

  /** Full screen on and off, where the browser lets a page have it. */
  private async fullScreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // A browser that says no (an iPhone's) just stays as it is.
    }
  }

  /** The race's sound held still (engines silent, music muffled), or let go again. */
  private hush(on: boolean): void {
    if (on === this.hushed) return;
    this.hushed = on;
    if (on) this.sound?.pause();
    else this.sound?.resume();
  }

  /** What the pause sheet tells you: whether the race waits, and what leaving does. */
  private pauseNote(): void {
    const session = this.ctx?.session;
    if (!session) return;
    $("pause-restart").hidden = session.role === "guest";
    const others = session.lobby().players.some((player) => player.device !== session.device);
    const waits = session.role === "solo" || this.stopped;
    const lines = [
      session.role === "solo" ? "The race waits for you." : waits ? "The race waits for you, and so does everyone." : "The race keeps going for everyone else.",
      session.role === "host" && others ? "Leaving ends the race for everyone." : "",
    ];
    setText("pause-note", lines.filter(Boolean).join(" "));
  }

  /** "Paused" on every other device while the host has the race stopped, then the 3-2-1 on all of them. */
  private veil(lobby: LobbyState): void {
    const session = this.ctx?.session;
    const pause = lobby.pause ?? null;
    const mine = pause !== null && pause.by === session?.device;
    // A guest who has heard nothing from the host for a few seconds: the race has not frozen for nothing, it waits.
    const waiting = pause === null && session?.role === "guest" && !session.link.connected;
    // On the device that paused, the sheet says it; the veil takes over for the 3-2-1.
    const show = waiting || (pause !== null && !(mine && pause.resume === null && this.sheet.open));
    const key = waiting ? "waiting" : show ? `${pause!.resume}|${mine}` : "";
    if (key === this.veilKey) return;
    this.veilKey = key;
    $("pause-veil").hidden = !show;
    if (!show) return;
    if (waiting) {
      $("pause-count").hidden = true;
      setText("pause-heading", `Waiting for ${hostName(lobby)}`);
      setText("pause-words", "The race carries on when the connection is back.");
      return;
    }
    const resuming = pause!.resume !== null;
    $("pause-count").hidden = !resuming;
    setText("pause-count", resuming ? String(pause!.resume) : "");
    setText("pause-heading", resuming ? "Get Ready" : "Paused");
    setText("pause-words", resuming ? "" : mine ? "" : `Waiting for ${hostName(lobby)} to resume.`);
  }

  // --- the frame -----------------------------------------------------------------------------------------

  private tick(now: number): void {
    const ctx = this.ctx;
    if (!ctx || this.mode === "failed") return;
    const seconds = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const view = ctx.session.frame(now);
    const lobby = ctx.session.lobby();
    const views = ctx.session.views();
    // (After the race is decided there are no more views, but a burst begun at the line goes on.)
    this.burstOn(now);
    this.hands(now, lobby, views);
    this.veil(lobby);
    if (!view) return;
    this.view = view;
    this.snapPhotos(view, lobby, now);
    if (this.mode === "pending") this.choose(view);
    // While the room is stopped the picture holds still, effects and cameras too.
    const dt = lobby.pause ? 0 : seconds;
    // The engines fall silent and the music is muffled behind the sheet, through the host's pause, and while the page is away.
    this.hush(this.sheet.open || !!lobby.pause || document.hidden);
    if (this.mode === "world" && this.renderer && this.loaded) {
      const key = views.join(",");
      if (key !== this.shownViews) {
        this.shownViews = key;
        this.renderer.setViews(views);
        this.fit();
      }
      this.teachItems(lobby);
      this.renderer.frame(view, dt);
      const hands = this.ctx?.controls.some((control) => control.kind === "wheel") ? (this.services.camera.counts?.() ?? null) : null;
      this.keepHands(now, hands);
      this.rate.tick(seconds, hands);
      this.eggs(view, lobby);
    }
    // Heard from the first frame, not from when the picture is ready: the lights count down meanwhile.
    if (this.mode === "world") this.sound?.frame(view, views, dt);
    if (this.mode === "controller") {
      this.readouts(view);
      this.eggs(view, lobby);
    }
  }

  /**
   * The hands come first: while the tracker reading this screen's wheel players drops camera frames, the race gives up
   * pixels until it keeps up (handsFirst.ts). A screen with no wheel player on it has nothing to make room for.
   */
  private keepHands(now: number, counts: TrackerCounts | null): void {
    const renderer = this.renderer;
    if (renderer?.limitResolution && counts && this.handsFirst.sample(counts, now / 1000)) renderer.limitResolution(this.handsFirst.ceiling);
  }

  /** The first view tells what this screen shows: the race, or only a controller. */
  private choose(view: RaceView): void {
    const ctx = this.ctx!;
    if (ctx.session.views().length === 0) {
      this.mode = "controller";
      // The race is heard where it is shown: a phone that is only a wheel stays quiet.
      this.sound?.dispose();
      this.sound = null;
      this.loading(false, 1);
      this.controller();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.className = "race-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "The race");
    let renderer: RaceRenderer;
    try {
      renderer = this.services.renderer(canvas, $("kart-hud"));
    } catch (error) {
      // No 3D on this browser right now (or the page ran out of it): say so, with the way back.
      this.mode = "failed";
      this.hooks.failed(error instanceof WebGLUnavailable ? "webgl" : "load");
      return;
    }
    this.mode = "world";
    // The sounds and the track's music are made beside the picture; the race does not wait for them.
    void this.sound?.load(view.track.theme);
    this.corners();
    $("race-stage").prepend(canvas);
    this.canvas = canvas;
    this.renderer = renderer;
    this.watch = new ResizeObserver(() => this.fit());
    this.watch.observe($("race-stage"));
    this.fit();
    renderer
      .load(view.track, view.racers, (fraction) => this.loading(true, fraction))
      .then(() => {
        if (this.renderer !== renderer) return;
        this.loaded = true;
        this.loading(false, 1);
      })
      .catch((error: unknown) => {
        // The drawing code is fetched with the load, so the browser that cannot draw says so here, not when the renderer is made.
        if (this.renderer === renderer) this.hooks.failed(error instanceof WebGLUnavailable ? "webgl" : "load");
      });
  }

  /** Tells the picture what each of this device's drivers drives with, so a viewport can teach the item in their words. */
  private teachItems(lobby: LobbyState): void {
    const ctx = this.ctx;
    if (!ctx || !this.renderer?.setControls) return;
    // The lobby is the same object until something in it changes: nothing to work out again.
    if (lobby === this.kindsFor) return;
    this.kindsFor = lobby;
    const kinds: Record<number, DriverControl["kind"]> = {};
    ctx.players.forEach((player, i) => {
      const control = ctx.controls[i];
      const kart = kartOf(lobby, player.slot);
      if (control && kart !== null) kinds[kart] = control.kind;
    });
    const key = JSON.stringify(kinds);
    if (key === this.shownKinds) return;
    this.shownKinds = key;
    this.renderer.setControls(kinds);
  }

  private fit(): void {
    if (!this.renderer) return;
    const box = $("race-stage").getBoundingClientRect();
    this.stage = { w: box.width, h: box.height };
    this.renderer.resize(Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height)), window.devicePixelRatio || 1);
  }

  private loading(on: boolean, fraction: number): void {
    this.loadingUi.progress(on, fraction);
  }

  // --- the small delights -------------------------------------------------------------------------------------

  /** The pause sheet's "Tricks": what this device's drivers can try, by what they drive with. */
  private tricks(): void {
    const kind = this.ctx?.controls[0]?.kind;
    $("pause-tricks").hidden = !kind;
    $("pause-tricks-list").replaceChildren(...(kind ? tricksFor(kind) : []).map((words) => element("li", undefined, words)));
  }

  /** The race's events once each: a duck found by one of ours, and the finishes that may make a photo finish. */
  private eggs(view: RaceView, lobby: LobbyState): void {
    // A new race (a restart) starts the numbering again.
    if (view.tick < this.eggTick - 5) {
      this.eggEvent = -1;
      this.finishes = [];
      this.rescues = new Map();
    }
    this.eggTick = view.tick;
    for (const event of view.events) {
      if (event.id <= this.eggEvent) continue;
      this.eggEvent = event.id;
      if (event.type === "duck") this.duckFound(event.kart, view, lobby);
      else if (event.type === "finish") this.finished(event.place, event.time);
      else if (event.type === "rescued") this.rescues.set(event.kart, (this.rescues.get(event.kart) ?? 0) + 1);
      else if (event.type === "hit") this.hit(event, view, performance.now());
    }
  }

  /** One of this device's players drove up to the duck: the first time on this track, they are told how many are found. */
  private duckFound(kart: number, view: RaceView, lobby: LobbyState): void {
    const ctx = this.ctx;
    const slot = lobby.karts[kart];
    if (!ctx || slot === undefined || !ctx.players.some((player) => player.slot === slot)) return;
    const words = recordDuck(view.track.id);
    if (!words) return;
    // In that player's viewport; a controller with no viewport says it on its own screen.
    if (!this.toastIn(kart, words, "check", 3500)) toast(words, { icon: "check", tone: "gold" });
  }

  /** A hit between people on this screen's karts: a word in the viewport of each it is about, one at a time. */
  private hit(event: { kart: number; by: number | null }, view: RaceView, now: number): void {
    const ctx = this.ctx;
    if (!ctx || this.mode !== "world") return;
    const players = new Map(view.racers.flatMap((racer) => (racer.player !== null ? [[racer.id, racer.name] as const] : [])));
    for (const taunt of taunts(event, players, ctx.session.views())) {
      // A volley of pucks is one taunt, not five.
      if (now - (this.taunted.get(taunt.kart) ?? -Infinity) < TAUNT_GAP) continue;
      this.taunted.set(taunt.kart, now);
      this.toastIn(taunt.kart, taunt.words, null, 2000);
    }
  }

  /** A pill high in the viewport that follows `kart`, for `ms`; false when no viewport here follows it. */
  private toastIn(kart: number, words: string, symbol: string | null, ms: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const views = ctx.session.views();
    const index = views.indexOf(kart);
    const box = $("race-stage").getBoundingClientRect();
    const rect = index >= 0 ? layoutViews(views.length, box.width, box.height).views[index] : undefined;
    if (!rect) return false;
    const pill = element("p", symbol ? "view-toast glass" : "view-toast quick glass");
    pill.setAttribute("role", "status");
    pill.style.left = `${Math.round(rect.x + rect.w / 2)}px`;
    pill.style.top = `${Math.round(rect.y + rect.h * 0.26)}px`;
    if (symbol) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", `#i-${symbol}`);
      icon.append(use);
      pill.append(icon);
    }
    pill.append(element("span", undefined, words));
    $("view-toasts").append(pill);
    window.setTimeout(() => pill.remove(), ms);
    return true;
  }

  /** A kart crossed the line: if it was right behind the one before, for a place in the top three, the screen takes the picture now. */
  private finished(place: number, time: number): void {
    const ahead = this.finishes.find((finish) => finish.place === place - 1);
    this.finishes.push({ place, time });
    if (!ahead || place - 1 > 3 || time - ahead.time > PHOTO_GAP || !this.canvas || this.mode !== "world" || !this.loaded) return;
    // Straight after the frame was drawn, which is the only moment a WebGL canvas can be read.
    try {
      this.still = this.canvas.toDataURL("image/jpeg", 0.8);
    } catch {
      this.still = null;
    }
  }

  // --- the finish-line photos ---------------------------------------------------------------------------------

  /** Every frame: a burst of stills for each of this device's wheel players whose kart has just crossed the line. */
  private snapPhotos(view: RaceView, lobby: LobbyState, now: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.services.photo) return;
    if (lobby !== this.cameraFor) {
      this.cameraFor = lobby;
      this.cameraKarts = ctx.players.flatMap((player, i) => {
        const kart = kartOf(lobby, player.slot);
        return kart !== null && ctx.controls[i]?.kind === "wheel" ? [kart] : [];
      });
    }
    if (this.cameraKarts.length === 0) return;
    for (const kart of this.shutter.due(view, this.cameraKarts)) {
      // Turned off in the pause sheet: no photo is taken at all.
      if (!loadFinishPhoto()) continue;
      const index = ctx.players.findIndex((player) => kartOf(lobby, player.slot) === kart);
      const control = ctx.controls[index];
      if (!control) continue;
      this.bursts.set(kart, { burst: new PhotoBurst<Still>(now), control, session: ctx.session, race: lobby.race ?? 0 });
    }
    // The first still at once, on the frame of the line.
    this.burstOn(now);
  }

  /** The bursts under way: each still that is due, the best kept; a finished burst is developed. */
  private burstOn(now: number): void {
    if (this.bursts.size === 0 || !this.services.photo) return;
    for (const [kart, { burst, control }] of this.bursts) {
      if (burst.due(now)) burst.offer(this.services.photo(control), reaction(control.wheel), now);
      if (burst.over) this.develop(kart);
    }
  }

  /** A burst's kept still made a JPEG and handed on: to the room, and to the results here. */
  private develop(kart: number): void {
    const taking = this.bursts.get(kart);
    this.bursts.delete(kart);
    const still = taking?.burst.best;
    if (!taking || !still) return;
    const { session, race } = taking;
    still.encode().then(
      (jpeg) => {
        if (!jpeg) return;
        session.sharePhoto?.(kart, jpeg);
        this.hooks.photo?.({ kart, race, photo: jpeg });
      },
      () => {
        // No photo this time: the results show their driver instead.
      },
    );
  }

  // --- the wheel's picture ------------------------------------------------------------------------------------

  /**
   * A small picture of each wheel player's wheel, in the corner. Three or
   * four players on one camera share one picture of it instead, the columns
   * marked in their colours: four slivers of the camera would read worse.
   */
  private corners(): void {
    const ctx = this.ctx!;
    const wheels = ctx.controls.filter((control) => control.kind === "wheel");
    if (wheels.length >= 3) {
      const box = element("div", "corner-preview shared");
      box.setAttribute("aria-hidden", "true");
      const view = element("div", "wheel-view wide");
      box.append(view);
      this.previews.push(
        this.services.previewColumns(
          view,
          ctx.controls.map((control, i) => ({ control, name: ctx.players[i]?.name ?? "", colour: ctx.players[i]?.colour ?? "#ffffff" })),
          "corner",
        ),
      );
      $("race-previews").replaceChildren(box);
      return;
    }
    const boxes = ctx.controls.map((control, i) => {
      if (control.kind !== "wheel") return null;
      const box = element("div", "corner-preview");
      box.style.setProperty("--colour", ctx.players[i]?.colour ?? "#fff");
      box.setAttribute("aria-hidden", "true");
      const view = element("div", "wheel-view");
      box.append(view);
      this.previews.push(this.services.preview(view, control, "corner"));
      return box;
    });
    $("race-previews").replaceChildren(...boxes.filter((box): box is HTMLDivElement => box !== null));
  }

  /** How long each of this device's wheels has had no hands in view, ms (0 when seen). */
  private lostFor(i: number, now: number): number {
    const since = this.lostSince[i];
    return since === null || since === undefined ? 0 : now - since;
  }

  /**
   * "Show Both Hands" while a wheel is lost: in that player's own viewport
   * (so on a shared screen everyone sees whose hands to show), and for a
   * player whose race is on the big screen, in their viewport there too, once
   * their device has told the host (the room's `handsLost`). A device that is
   * only a controller says it on its own screen.
   */
  private hands(now: number, lobby: LobbyState, views: readonly number[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.controls.forEach((control, i) => {
      const wheel = control.wheel;
      if (!wheel) return;
      this.lostSince[i] = wheel.mode === "lost" ? (this.lostSince[i] ?? now) : null;
      // Lost hands have their own note: the edge's gives way to it.
      this.edges[i]?.update(wheel.mode === "lost" ? null : (wheel.edge ?? null), now);
    });
    // Tell the room when it has gone on long enough to matter.
    const flags = ctx.controls.map((_, i) => this.lostFor(i, now) > REPORT_AFTER);
    const key = flags.join();
    if (key !== this.reported) {
      this.reported = key;
      ctx.session.setHandsLost(flags);
    }
    if (this.mode === "controller") {
      const lost = ctx.controls.flatMap((_, i) => (this.lostFor(i, now) > LOST_FOR ? [ctx.players[i]?.name ?? ""] : []));
      // With nobody's hands lost, the first whose hands are nearing the edge.
      const near = lost.length ? -1 : this.edges.findIndex((edge) => edge.shown !== null);
      const way = this.edges[near]?.shown ?? null;
      const pill = $("lost-hands");
      pill.hidden = lost.length === 0 && !way;
      pill.classList.toggle("edge-note", !lost.length && way !== null);
      pill.querySelector("use")?.setAttribute("href", way && !lost.length ? `#i-arrow-${way}` : "#i-hand");
      if (lost.length) setText("lost-hands-text", ctx.controls.length > 1 ? `${list(lost)}: Show Both Hands` : "Show Both Hands");
      else if (way) setText("lost-hands-text", ctx.controls.length > 1 ? `${ctx.players[near]?.name ?? ""}: ${EDGE_WORDS[way]}` : EDGE_WORDS[way]);
      return;
    }
    $("lost-hands").hidden = true;
    if (this.mode === "world") this.handPills(now, lobby, views);
  }

  /** The "Show Both Hands" pills, each centred high in the viewport of the player whose hands are gone. */
  private handPills(now: number, lobby: LobbyState, views: readonly number[]): void {
    const ctx = this.ctx!;
    // `fit` keeps the stage's size once the picture is up; while the race is still loading, it is measured here.
    if (!this.renderer) {
      const box = $("race-stage").getBoundingClientRect();
      this.stage = { w: box.width, h: box.height };
    }
    const layout = layoutViews(views.length, this.stage.w, this.stage.h);
    const pills: { x: number; y: number; text: string; way?: EdgeWay }[] = [];
    views.forEach((kart, i) => {
      const rect = layout.views[i];
      const slot = lobby.karts[kart];
      if (!rect || slot === undefined) return;
      const player = lobby.players.find((candidate) => candidate.slot === slot);
      const local = ctx.players.findIndex((candidate) => candidate.slot === slot);
      const lost = (local >= 0 && this.lostFor(local, now) > LOST_FOR) || player?.handsLost === true;
      const way = lost || local < 0 ? null : (this.edges[local]?.shown ?? null);
      if (!lost && !way) return;
      const words = way ? EDGE_WORDS[way] : "Show Both Hands";
      pills.push({
        x: Math.round(rect.x + rect.w / 2),
        y: Math.round(rect.y + rect.h * 0.16),
        text: views.length > 1 && player ? `${player.name}: ${words}` : words,
        ...(way ? { way } : {}),
      });
    });
    const key = JSON.stringify(pills);
    if (key === this.pillsKey) return;
    this.pillsKey = key;
    $("view-notes").replaceChildren(
      ...pills.map((pill) => {
        const note = element("p", pill.way ? "lost-hands edge-note glass view-note" : "lost-hands glass view-note");
        note.setAttribute("role", "status");
        note.style.left = `${pill.x}px`;
        note.style.top = `${pill.y}px`;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("aria-hidden", "true");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", pill.way ? `#i-arrow-${pill.way}` : "#i-hand");
        icon.append(use);
        note.append(icon, element("span", undefined, pill.text));
        return note;
      }),
    );
  }

  // --- the controller (a big-screen player's own device) ---------------------------------------------------------

  private controller(): void {
    const ctx = this.ctx!;
    $("controller").hidden = false;
    // Three or four on one camera: one picture of the whole camera above their cards, not a sliver in each.
    const together = ctx.controls.filter((control) => control.kind === "wheel").length >= 3;
    const shared = together ? element("figure", "controller-shared") : null;
    if (shared) {
      const view = element("div", "wheel-view wide");
      shared.append(view);
      this.previews.push(
        this.services.previewColumns(
          view,
          ctx.controls.map((control, i) => ({ control, name: ctx.players[i]?.name ?? "", colour: ctx.players[i]?.colour ?? "#ffffff" })),
          "large",
        ),
      );
    }
    const cards = ctx.controls.map((control, i) => {
      const player = ctx.players[i];
      const card = element("figure", "controller-card");
      if (player) card.style.setProperty("--colour", player.colour);
      const picture = element("div", "wheel-view");
      card.append(picture);
      if (control.kind === "wheel" && !together) this.previews.push(this.services.preview(picture, control, "large"));
      else picture.hidden = true;
      const words = element("figcaption", "controller-words");
      const who = element("p", "controller-who headline");
      if (player) who.append(colourDot(player.colour), player.name);
      const place = element("p", "controller-place num", "–");
      const lap = element("p", "controller-lap title3 secondary num", "");
      const item = element("p", "controller-item glass", "");
      words.append(who, place, lap, item);
      card.append(words);
      this.cards.push({ place, lap, item, slot: player?.slot ?? -1 });
      return card;
    });
    $("controller-cards").dataset.count = String(cards.length);
    $("controller-cards").replaceChildren(...(shared ? [shared] : []), ...cards);
  }

  private readouts(view: RaceView): void {
    const lobby = this.ctx?.session.lobby();
    if (!lobby) return;
    const mine: KartView[] = [];
    for (const card of this.cards) {
      const id = kartOf(lobby, card.slot);
      const kart = id === null ? undefined : view.karts.find((candidate) => candidate.id === id);
      if (!kart) continue;
      mine.push(kart);
      setText(card.place, ordinal(kart.place));
      setText(card.lap, kart.finished !== null ? "Finished" : lapLabel(kart.lap, view.laps));
      const words = itemWords(kart.item as ItemKind | null, kart.itemUses, kart.rolling);
      setText(card.item, words);
      card.item.dataset.held = kart.item && !kart.rolling ? "yes" : "no";
    }
    this.countdown(view, mine);
  }

  /**
   * The start lights on the phone too: the start boost is won by opening the
   * hands in the countdown and closing them on "1", and the player is looking at their wheel.
   */
  private countdown(view: RaceView, mine: readonly KartView[]): void {
    let text = "";
    if (view.phase === "countdown") text = view.countdown > 3 ? "Ready" : String(Math.max(1, Math.ceil(view.countdown)));
    else if (view.time < 1.2) text = "Go!";
    else if (mine.some((kart) => kart.wrongWay)) text = "Wrong Way";
    if (text === this.banner) return;
    this.banner = text;
    setText("controller-banner", text);
    $("controller-banner").dataset.kind = text === "Wrong Way" ? "warn" : text ? "count" : "";
  }
}
