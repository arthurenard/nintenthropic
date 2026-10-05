/**
 * The race screen: the world full-window with each viewport's HUD (the
 * renderer's), a pause button in the corner, and for every wheel player on
 * this device a small picture of their wheel. On the host's or the guest's
 * own screen the renderer draws; a guest who chose the host's big screen has
 * no viewport here, so this device shows a controller instead: the large
 * wheel picture and their place and lap.
 *
 * Every animation frame it asks the session for the race (`session.frame`),
 * which also samples this device's controls and, on the host, steps the
 * sim. Solo practice pauses by simply not asking: the race waits.
 */
import type { DriverControl, LobbyPlayer, RaceRenderer, RaceView, Session } from "../contract";
import { $, element, setText } from "../../ui/dom";
import { lapLabel, ordinal } from "./format";
import { kartOf } from "./roster";
import type { Disposable, Services } from "./services";
import { colourDot, setBar } from "./ui";

export interface RaceHooks {
  leave(): void;
  restart(): void;
  /** The renderer could not load the race. */
  failed(): void;
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

export class RaceScreen {
  private ctx: RaceContext | null = null;
  private running = false;
  private raf = 0;
  private last = 0;
  private paused = false;
  private mode: "pending" | "world" | "controller" = "pending";
  private canvas: HTMLCanvasElement | null = null;
  private renderer: RaceRenderer | null = null;
  private loaded = false;
  private watch: ResizeObserver | null = null;
  private previews: Disposable[] = [];
  private lostSince: (number | null)[] = [];
  private shownViews = "";
  private cards: { place: HTMLElement; lap: HTMLElement; slot: number }[] = [];
  private view: RaceView | null = null;
  private readonly sheet = $<HTMLDialogElement>("pause-sheet");

  constructor(
    private readonly services: Services,
    private readonly hooks: RaceHooks,
  ) {
    $("race-pause").addEventListener("click", () => this.pause());
    $("pause-resume").addEventListener("click", () => this.sheet.close());
    $("pause-restart").addEventListener("click", () => {
      this.sheet.close();
      hooks.restart();
    });
    $("pause-leave").addEventListener("click", () => {
      this.sheet.close();
      hooks.leave();
    });
    this.sheet.addEventListener("close", () => (this.paused = false));
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

  begin(ctx: RaceContext): void {
    this.end();
    this.ctx = ctx;
    this.running = true;
    this.mode = "pending";
    this.loaded = false;
    this.view = null;
    this.shownViews = "";
    this.last = 0;
    this.lostSince = ctx.controls.map(() => null);
    $("controller").hidden = true;
    $("race-previews").replaceChildren();
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
    if (this.sheet.open) this.sheet.close();
    this.watch?.disconnect();
    this.watch = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas?.remove();
    this.canvas = null;
    for (const preview of this.previews) preview.dispose();
    this.previews = [];
    this.cards = [];
    $("race-previews").replaceChildren();
    $("controller-cards").replaceChildren();
    $("kart-hud").replaceChildren();
    $("lost-hands").hidden = true;
    this.ctx = null;
  }

  // --- pausing ---------------------------------------------------------------------------------------

  pause(): void {
    if (!this.running || this.sheet.open) return;
    this.paused = true;
    this.note();
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
    }
  }

  /** What the pause sheet tells you: whether the race waits, and what leaving does. */
  private note(): void {
    const session = this.ctx?.session;
    if (!session) return;
    $("pause-restart").hidden = session.role === "guest";
    const others = session.lobby().players.some((player) => player.device !== session.device);
    const lines = [
      session.role === "solo" ? "The race waits for you." : "The race keeps going for everyone else.",
      session.role === "host" && others ? "Leaving ends the race for everyone." : "",
    ];
    setText("pause-note", lines.filter(Boolean).join(" "));
  }

  // --- the frame -----------------------------------------------------------------------------------------

  private tick(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    // Practice waits behind the sheet. A room cannot: the others are racing.
    if (this.paused && ctx.session.role === "solo") return;
    const view = ctx.session.frame(now);
    this.watchHands(now);
    if (!view) return;
    this.view = view;
    if (this.mode === "pending") this.choose(view);
    if (this.mode === "world" && this.renderer && this.loaded) {
      const views = ctx.session.views();
      const key = views.join(",");
      if (key !== this.shownViews) {
        this.shownViews = key;
        this.renderer.setViews(views);
        this.fit();
      }
      this.renderer.frame(view, dt);
    } else if (this.mode === "controller") {
      this.readouts(view);
    }
  }

  /** The first view tells what this screen shows: the race, or only a controller. */
  private choose(view: RaceView): void {
    const ctx = this.ctx!;
    if (ctx.session.views().length === 0) {
      this.mode = "controller";
      this.loading(false, 1);
      this.controller();
      return;
    }
    this.mode = "world";
    this.corners();
    const canvas = document.createElement("canvas");
    canvas.className = "race-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "The race");
    $("race-stage").prepend(canvas);
    this.canvas = canvas;
    this.renderer = this.services.renderer(canvas, $("kart-hud"));
    this.watch = new ResizeObserver(() => this.fit());
    this.watch.observe($("race-stage"));
    this.fit();
    const renderer = this.renderer;
    renderer
      .load(view.track, view.racers, (fraction) => this.loading(true, fraction))
      .then(() => {
        if (this.renderer !== renderer) return;
        this.loaded = true;
        this.loading(false, 1);
      })
      .catch(() => {
        if (this.renderer === renderer) this.hooks.failed();
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

  // --- the wheel's picture ------------------------------------------------------------------------------------

  /** A small picture of each wheel player's wheel, in the corner. */
  private corners(): void {
    const ctx = this.ctx!;
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

  /** "Show Both Hands" while a wheel is lost. */
  private watchHands(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const lost: string[] = [];
    ctx.controls.forEach((control, i) => {
      const wheel = control.wheel;
      if (!wheel) return;
      this.lostSince[i] = wheel.mode === "lost" ? (this.lostSince[i] ?? now) : null;
      const since = this.lostSince[i];
      if (since !== null && since !== undefined && now - since > LOST_FOR) lost.push(ctx.players[i]?.name ?? "");
    });
    const pill = $("lost-hands");
    pill.hidden = lost.length === 0;
    if (lost.length) {
      // With two players on a camera, say whose hands.
      const many = ctx.controls.filter((control) => control.kind === "wheel").length > 1;
      setText("lost-hands-text", many ? `${lost.join(" and ")}: Show Both Hands` : "Show Both Hands");
    }
  }

  // --- the controller (a big-screen player's own device) ---------------------------------------------------------

  private controller(): void {
    const ctx = this.ctx!;
    $("controller").hidden = false;
    const cards = ctx.controls.map((control, i) => {
      const player = ctx.players[i];
      const card = element("figure", "controller-card");
      const picture = element("div", "wheel-view");
      card.append(picture);
      if (control.kind === "wheel") this.previews.push(this.services.preview(picture, control, "large"));
      else picture.hidden = true;
      const words = element("figcaption", "controller-words");
      const who = element("p", "controller-who headline");
      if (player) who.append(colourDot(player.colour), player.name);
      const place = element("p", "large-title num", "–");
      const lap = element("p", "title3 secondary num", "");
      words.append(who, place, lap);
      card.append(words);
      this.cards.push({ place, lap, slot: player?.slot ?? -1 });
      return card;
    });
    $("controller-cards").dataset.count = String(cards.length);
    $("controller-cards").replaceChildren(...cards);
  }

  private readouts(view: RaceView): void {
    const lobby = this.ctx?.session.lobby();
    if (!lobby) return;
    for (const card of this.cards) {
      const id = kartOf(lobby, card.slot);
      const kart = id === null ? undefined : view.karts.find((candidate) => candidate.id === id);
      if (!kart) continue;
      setText(card.place, ordinal(kart.place));
      setText(card.lap, kart.finished !== null ? "Finished" : lapLabel(kart.lap, view.laps));
    }
  }
}
