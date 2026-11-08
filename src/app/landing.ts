/**
 * The landing: the two families of Nintenthropic as a carousel of two cinematic
 * tiles - Grip Prix (its sunny poster) and Finger Guns (the finger-pistol shooters,
 * their posters crossfading in the dark). The tile in focus leads, about 80% of the
 * row, with the one thing to do and a quiet "How It Plays"; the other is a slim
 * peek, about 20%, that takes the lead when the mouse rests on it, when it is
 * tapped or swiped to, when the arrow keys move to it, or when the keyboard tabs
 * into it. Grip Prix leads first. This module fills the tiles from the games' own
 * entries (so a poster is named once, in games/index.ts), moves the lead, moves
 * their art gently under a mouse, and lists each gesture's steps for How It Plays.
 *
 * Everything here is dressing: a poster that is not there leaves its game's
 * backdrop in its place, and nothing waits for a picture.
 */
import type { GameEntry } from "../engine/types";
import { siteUrl } from "../engine/fetch";
import { backdropCss } from "../ui/backdrop";
import { $, element } from "../ui/dom";
import { thisDevice } from "../ui/touch";
import { posterInto } from "./arcade";
import type { Tile } from "./route";

export type GestureKind = "pistol" | "wheel";

/** Puts a gesture's steps (the templates in index.html) into a figure. */
export function gestureInto(figure: Element, kind: GestureKind, replace = false): void {
  const art = $<HTMLTemplateElement>(`gesture-${kind}`).content.cloneNode(true);
  if (replace) figure.replaceChildren(art);
  else figure.append(art);
}

/** Reduce Motion, the player's or the system's: the page keeps one attribute for both (app.ts applyMotion). */
const motionReduced = (): boolean => document.documentElement.hasAttribute("data-reduce-motion");

/** How long one poster holds the tile before the next fades in, ms. */
const DWELL = 6500;
/** The Grip Prix badge: the game's icon, shown only if the picture is there. */
const KART_ICON = "assets/kart/icon.png";
/** How long the mouse rests on the slim tile before it opens, ms: long enough that crossing it on the way elsewhere does not. */
const HOVER_INTENT = 160;
/** How far a finger travels sideways, px, before a touch is a swipe through the carousel rather than a tap. */
const SWIPE = 36;
/** The carousel's tiles in their order on the page, left to right. */
const ORDER: readonly Tile[] = ["grip-prix", "arcade"];

/**
 * The posters of several games, one fading into the next in a tile. A poster
 * that has not loaded is skipped; with Reduce Motion, or one poster, nothing moves.
 */
export class Collage {
  private readonly images: HTMLImageElement[] = [];
  private at = 0;
  private layer = 0;
  private timer = 0;

  constructor(
    private readonly box: HTMLElement,
    games: readonly GameEntry[],
  ) {
    box.style.setProperty("--poster-fallback", backdropCss(games[0]?.backdrop));
    for (const game of games) {
      const image = element("img");
      image.alt = "";
      image.decoding = "async";
      image.dataset.game = game.id;
      image.onload = () => {
        image.classList.add("loaded");
        this.begin(false);
      };
      image.onerror = () => {
        const at = this.images.indexOf(image);
        if (at >= 0) this.images.splice(at, 1);
        image.remove();
        this.begin(false);
      };
      this.images.push(image);
      box.append(image);
      image.src = siteUrl(game.poster);
    }
    // The first poster is the one that opens the tile; if it is slow, the next to arrive does.
    window.setTimeout(() => this.begin(true), 2000);
  }

  /** Shows the first poster that is ready, once the ones before it have arrived (or failed), or `late`. */
  private begin(late: boolean): void {
    if (this.box.querySelector("img.on")) return;
    const first = this.images.find((image) => image.classList.contains("loaded"));
    if (!first) return;
    const before = this.images.slice(0, this.images.indexOf(first));
    if (late || before.every((image) => image.classList.contains("loaded"))) this.show(first);
  }

  private show(image: HTMLImageElement): void {
    this.at = Math.max(0, this.images.indexOf(image));
    // Over the one showing, which stays until this one is whole.
    image.style.zIndex = String(++this.layer);
    image.classList.remove("on");
    void image.offsetWidth; // drifts afresh
    image.classList.add("on");
    window.setTimeout(() => {
      for (const other of this.images) if (other !== image) other.classList.remove("on");
    }, 1800);
  }

  private next(): void {
    if (motionReduced() || document.hidden) return;
    const ready = this.images.filter((image) => image.classList.contains("loaded"));
    if (ready.length < 2) return;
    const current = ready.indexOf(this.images[this.at]!);
    this.show(ready[(current + 1) % ready.length]!);
  }

  start(): void {
    if (this.timer || this.images.length < 2) return;
    this.timer = window.setInterval(() => this.next(), DWELL);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }
}

/** What the sheet says for each tile's "How It Plays". */
const HOW: Record<Tile, { eyebrow: string; title: string; gesture: GestureKind; body: (grip?: GameEntry) => string }> = {
  arcade: {
    eyebrow: "Finger Guns",
    title: "Finger Pistol",
    gesture: "pistol",
    body: () =>
      `Point your finger at the screen like a gun. Fold your thumb to fire. Your camera sees your hand, and the picture never leaves ${thisDevice()}.`,
  },
  "grip-prix": {
    eyebrow: "Grip Prix",
    title: "Grip the Wheel",
    gesture: "wheel",
    body: (grip) =>
      grip?.about ?? "Hold your fists up like a wheel and turn it. Race up to three friends, all on one big screen or each on their own device.",
  },
};

export class Landing {
  private readonly collage: Collage;
  private readonly row = $("tiles");
  private readonly tiles: Record<Tile, HTMLElement> = { arcade: $("tile-arcade"), "grip-prix": $("tile-grip") };
  /** The tile in focus: large, its words and its Play in view. */
  private lead: Tile = "grip-prix";
  private hoverTimer = 0;
  /** A finger down on the row, while it may still become a swipe. */
  private touch: { id: number; x: number; y: number } | null = null;
  /** Until when a click is the tail of a swipe, not a tap (ms, performance.now()). */
  private swipedUntil = 0;

  constructor(
    shooters: readonly GameEntry[],
    private readonly grip: GameEntry | undefined,
  ) {
    this.collage = new Collage($("tile-arcade-art"), shooters);
    $("tile-arcade-eyebrow").textContent = `Shooting · ${shooters.length} ${shooters.length === 1 ? "Game" : "Games"}`;
    if (grip) {
      const art = $("tile-grip-art");
      const image = element("img");
      image.alt = "";
      image.decoding = "async";
      art.append(image);
      posterInto(art, image, grip);
      $("tile-grip-line").textContent = grip.blurb;
    }
    // Its icon, if it has been drawn: a badge, never a hole where one should be.
    const icon = $<HTMLImageElement>("tile-grip-icon");
    icon.onload = () => (icon.hidden = false);
    icon.onerror = () => (icon.hidden = true);
    icon.src = siteUrl(KART_ICON);
    for (const tile of Object.values(this.tiles)) this.lean(tile);
    this.carousel();
  }

  /**
   * Puts a tile in the lead: it opens to about 80% of the row and the other closes to its slim
   * peek. `animate` false is for arriving: the landing is simply there, on that tile.
   */
  bring(tile: Tile, animate = true): void {
    window.clearTimeout(this.hoverTimer);
    if (tile === this.lead) return;
    const leaving = this.tiles[this.lead];
    this.lead = tile;
    if (!animate) this.row.classList.add("still");
    this.row.dataset.lead = tile;
    for (const name of ORDER) this.tiles[name].classList.toggle("lead", name === tile);
    // The keyboard never stays on the words of a tile that has closed (Enter there would start the game no longer shown).
    if (leaving.contains(document.activeElement)) this.play(tile).focus({ preventScroll: true });
    if (!animate) {
      void this.row.offsetWidth; // laid out in place before the transitions come back
      requestAnimationFrame(() => this.row.classList.remove("still"));
    }
  }

  /** The tile `step` places along from the one in the lead (no wrapping round: the row has ends). */
  private neighbour(step: 1 | -1): Tile | null {
    return ORDER[ORDER.indexOf(this.lead) + step] ?? null;
  }

  /** What moves the lead: the mouse resting, a tap, a swipe, the arrow keys, the keyboard's Tab. */
  private carousel(): void {
    for (const name of ORDER) {
      const tile = this.tiles[name];
      tile.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "mouse" || name === this.lead) return;
        window.clearTimeout(this.hoverTimer);
        this.hoverTimer = window.setTimeout(() => this.bring(name), HOVER_INTENT);
      });
      tile.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse") window.clearTimeout(this.hoverTimer);
      });
      // A tap or a click on the slim tile opens it; its Play is the leading tile's, a second tap away.
      tile.addEventListener("click", (event) => {
        if (name === this.lead) return;
        event.preventDefault();
        this.bring(name);
      });
      // The keyboard tabbing into a tile (or a sheet handing focus back to it) brings it to the lead.
      tile.addEventListener("focusin", () => this.bring(name));
    }
    this.row.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const next = this.neighbour(event.key === "ArrowRight" ? 1 : -1);
      if (!next) return;
      event.preventDefault();
      this.bring(next);
      this.play(next).focus({ preventScroll: true });
    });
    // A sideways swipe through the row moves the lead the way the finger went, as a carousel's does.
    this.row.addEventListener("pointerdown", (event) => {
      this.swipedUntil = 0;
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      this.touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    this.row.addEventListener("pointerup", (event) => {
      const touch = this.touch;
      this.touch = null;
      if (!touch || touch.id !== event.pointerId) return;
      const dx = event.clientX - touch.x;
      const dy = event.clientY - touch.y;
      if (Math.abs(dx) < SWIPE || Math.abs(dx) < 1.4 * Math.abs(dy)) return;
      this.swipedUntil = performance.now() + 400;
      const next = this.neighbour(dx < 0 ? 1 : -1);
      if (next) this.bring(next);
    });
    this.row.addEventListener("pointercancel", () => (this.touch = null));
    // A swipe that ends on a tile is not also a tap on it.
    this.row.addEventListener(
      "click",
      (event) => {
        if (performance.now() > this.swipedUntil) return;
        this.swipedUntil = 0;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }

  /** A tile's Play. */
  private play(tile: Tile): HTMLElement {
    return this.tiles[tile].querySelector<HTMLElement>(".tile-go")!;
  }

  /** The art of a tile leans a little toward the pointer, as if the tile had depth (a mouse only; CSS stills it for Reduce Motion). */
  private lean(tile: HTMLElement): void {
    tile.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      const box = tile.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      tile.style.setProperty("--dx", `${(-x * 16).toFixed(1)}px`);
      tile.style.setProperty("--dy", `${(-y * 12).toFixed(1)}px`);
    });
    tile.addEventListener("pointerleave", () => {
      tile.style.removeProperty("--dx");
      tile.style.removeProperty("--dy");
    });
  }

  /** The landing is in view: its posters begin to turn. */
  show(): void {
    this.collage.start();
  }

  hide(): void {
    this.collage.stop();
  }

  /** Stands on a tile's own button, that tile in the lead: where the player came from, or was sent to. */
  focus(tile: Tile): void {
    this.bring(tile, false);
    this.play(tile).focus({ preventScroll: true });
    // On a short window the row may be below the fold: bring it into view.
    this.tiles[tile].scrollIntoView({
      block: "nearest",
      behavior: motionReduced() ? "auto" : "smooth",
    });
  }

  /** The "How It Plays" sheet for a tile. */
  how(tile: Tile): void {
    const about = HOW[tile];
    $("how-eyebrow").textContent = about.eyebrow;
    $("how-title").textContent = about.title;
    $("how-body").textContent = about.body(this.grip);
    $("how").dataset.tile = tile;
    gestureInto($("how-figure"), about.gesture, true);
  }
}
