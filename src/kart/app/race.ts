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
 */
import { WebGLUnavailable } from "../../engine/common";
import type { DriverControl, ItemKind, KartView, LobbyPlayer, LobbyState, RaceRenderer, RaceView, Session } from "../contract";
import { $, element, setText, toast } from "../../ui/dom";
import { layoutViews } from "../render/layout";
import { PHOTO_GAP, recordDuck, tricksFor } from "./eggs";
import { itemWords, lapLabel, list, ordinal } from "./format";
import { hostName, kartOf } from "./roster";
import type { Disposable, RaceSound, Services } from "./services";
import { colourDot, setBar } from "./ui";

export type RaceFailure = "load" | "webgl";

export interface RaceHooks {
  leave(): void;
  restart(): void;
  /** The renderer could not start or load the race. */
  failed(kind: RaceFailure): void;
}

export interface RaceContext {
  session: Session;
  /** This device's controls, in the order of `players`. */
  controls: DriverControl[];
  /** This device's players in the lobby. */
  players: LobbyPlayer[];
}

/** Hands gone this long, ms, before "Show Both Hands" appears (a flicker does not count). */
const LOST_FOR = 300;
/** Hands gone this long, ms, before the host's big screen is told (it says it in their viewport). */
const REPORT_AFTER = 1500;

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
  private reported = "";
  private shownViews = "";
  private veilKey = "";
  private notesKey = "";
  /** The easter eggs: the last event looked at, the tick it was on, the finishes so far, and the photo finish's still. */
  private eggEvent = -1;
  private eggTick = 0;
  private finishes: { place: number; time: number }[] = [];
  private still: string | null = null;
  private cards: { place: HTMLElement; lap: HTMLElement; item: HTMLElement; slot: number }[] = [];
  private banner = "";
  private view: RaceView | null = null;
  private readonly sheet = $<HTMLDialogElement>("pause-sheet");

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
      // A tab put away while practising: the race waits, behind the sheet.
      if (document.hidden && this.running && this.ctx?.session.role === "solo") this.pause();
    });
  }

  get active(): boolean {
    return this.running;
  }

  /** The last race view drawn: the results use its grid for names and colours. */
  get lastView(): RaceView | null {
    return this.view;
  }

  /** A picture of the finish if two karts crossed the line together for a top-three place (it outlives `end`, until the next race). */
  get photo(): string | null {
    return this.still;
  }

  begin(ctx: RaceContext): void {
    this.end();
    this.ctx = ctx;
    this.running = true;
    this.mode = "pending";
    this.loaded = false;
    this.view = null;
    this.shownViews = "";
    this.veilKey = "";
    this.notesKey = "";
    this.eggEvent = -1;
    this.eggTick = 0;
    this.finishes = [];
    this.still = null;
    $("view-toasts").replaceChildren();
    this.reported = "";
    this.banner = "";
    this.hushed = false;
    this.sound = this.services.sound.race();
    this.last = 0;
    this.stopped = false;
    this.leaving = false;
    this.lostSince = ctx.controls.map(() => null);
    $("controller").hidden = true;
    $("race-previews").replaceChildren();
    $("view-notes").replaceChildren();
    $("pause-veil").hidden = true;
    $("lost-hands").hidden = true;
    this.loading(true, 0);
    this.note();
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
    this.note();
    this.tricks();
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

  /** What the pause sheet tells you: whether the race waits, and what leaving does. */
  private note(): void {
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
    const pause = lobby.pause ?? null;
    const mine = pause !== null && pause.by === this.ctx?.session.device;
    // On the device that paused, the sheet says it; the veil takes over for the 3-2-1.
    const show = pause !== null && !(mine && pause.resume === null && this.sheet.open);
    const key = show ? `${pause!.resume}|${mine}` : "";
    if (key === this.veilKey) return;
    this.veilKey = key;
    $("pause-veil").hidden = !show;
    if (!show) return;
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
    this.hands(now, lobby);
    this.veil(lobby);
    if (!view) return;
    this.view = view;
    if (this.mode === "pending") this.choose(view);
    // While the room is stopped the picture holds still, effects and cameras too.
    const dt = lobby.pause ? 0 : seconds;
    // The engines fall silent and the music is muffled behind the sheet, and through the host's pause.
    const hush = this.sheet.open || !!lobby.pause;
    if (hush !== this.hushed) {
      this.hushed = hush;
      if (hush) this.sound?.pause();
      else this.sound?.resume();
    }
    if (this.mode === "world" && this.renderer && this.loaded) {
      const views = ctx.session.views();
      const key = views.join(",");
      if (key !== this.shownViews) {
        this.shownViews = key;
        this.renderer.setViews(views);
        this.fit();
      }
      this.renderer.frame(view, dt);
      this.eggs(view, lobby);
    }
    // Heard from the first frame, not from when the picture is ready: the lights count down meanwhile.
    if (this.mode === "world") this.sound?.frame(view, ctx.session.views(), dt);
    if (this.mode === "controller") {
      this.readouts(view);
      this.eggs(view, lobby);
    }
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
      .catch(() => {
        if (this.renderer === renderer) this.hooks.failed("load");
      });
  }

  private fit(): void {
    if (!this.renderer) return;
    const box = $("race-stage").getBoundingClientRect();
    this.renderer.resize(Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height)), window.devicePixelRatio || 1);
  }

  private loading(on: boolean, fraction: number): void {
    $("race-loading").hidden = !on;
    setBar($("race-loading-bar"), fraction);
    const percent = Math.round(fraction * 100);
    setText("race-loading-title", percent > 0 && on ? `Getting ready… ${percent}%` : "Getting ready…");
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
    }
    this.eggTick = view.tick;
    for (const event of view.events) {
      if (event.id <= this.eggEvent) continue;
      this.eggEvent = event.id;
      if (event.type === "duck") this.duckFound(event.kart, view, lobby);
      else if (event.type === "finish") this.finished(event.place, event.time);
    }
  }

  /** One of this device's players drove up to the duck: the first time on this track, they are told how many are found. */
  private duckFound(kart: number, view: RaceView, lobby: LobbyState): void {
    const ctx = this.ctx;
    const slot = lobby.karts[kart];
    if (!ctx || slot === undefined || !ctx.players.some((player) => player.slot === slot)) return;
    const words = recordDuck(view.track.id);
    if (!words) return;
    const index = ctx.session.views().indexOf(kart);
    const box = $("race-stage").getBoundingClientRect();
    const rect = index >= 0 ? layoutViews(ctx.session.views().length, box.width, box.height).views[index] : undefined;
    // In that player's viewport; a controller with no viewport says it on its own screen.
    if (!rect) {
      toast(words, { icon: "check", tone: "gold" });
      return;
    }
    const pill = element("p", "view-toast glass");
    pill.setAttribute("role", "status");
    pill.style.left = `${Math.round(rect.x + rect.w / 2)}px`;
    pill.style.top = `${Math.round(rect.y + rect.h * 0.26)}px`;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-check");
    icon.append(use);
    pill.append(icon, element("span", undefined, words));
    $("view-toasts").append(pill);
    window.setTimeout(() => pill.remove(), 3500);
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
  private hands(now: number, lobby: LobbyState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.controls.forEach((control, i) => {
      const wheel = control.wheel;
      if (!wheel) return;
      this.lostSince[i] = wheel.mode === "lost" ? (this.lostSince[i] ?? now) : null;
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
      const pill = $("lost-hands");
      pill.hidden = lost.length === 0;
      if (lost.length) setText("lost-hands-text", ctx.controls.length > 1 ? `${list(lost)}: Show Both Hands` : "Show Both Hands");
      return;
    }
    $("lost-hands").hidden = true;
    if (this.mode === "world") this.notes(now, lobby);
  }

  /** The "Show Both Hands" pills, each centred high in the viewport of the player whose hands are gone. */
  private notes(now: number, lobby: LobbyState): void {
    const ctx = this.ctx!;
    const views = ctx.session.views();
    const box = $("race-stage").getBoundingClientRect();
    const layout = layoutViews(views.length, box.width, box.height);
    const pills: { x: number; y: number; text: string }[] = [];
    views.forEach((kart, i) => {
      const rect = layout.views[i];
      const slot = lobby.karts[kart];
      if (!rect || slot === undefined) return;
      const player = lobby.players.find((candidate) => candidate.slot === slot);
      const local = ctx.players.findIndex((candidate) => candidate.slot === slot);
      const lost = (local >= 0 && this.lostFor(local, now) > LOST_FOR) || player?.handsLost === true;
      if (!lost) return;
      pills.push({
        x: Math.round(rect.x + rect.w / 2),
        y: Math.round(rect.y + rect.h * 0.16),
        text: views.length > 1 && player ? `${player.name}: Show Both Hands` : "Show Both Hands",
      });
    });
    const key = JSON.stringify(pills);
    if (key === this.notesKey) return;
    this.notesKey = key;
    $("view-notes").replaceChildren(
      ...pills.map((pill) => {
        const note = element("p", "lost-hands glass view-note");
        note.setAttribute("role", "status");
        note.style.left = `${pill.x}px`;
        note.style.top = `${pill.y}px`;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("aria-hidden", "true");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#i-hand");
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
