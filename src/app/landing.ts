/**
 * The landing: Handy's two families as two equal, cinematic tiles - the
 * Arcade (the finger-pistol shooters, their posters crossfading in the dark)
 * and Grip Prix (its sunny poster) - each with the one thing to do and a quiet
 * "How It Plays". This module fills the tiles from the games' own entries (so
 * a poster is named once, in games/index.ts), moves their art gently under a
 * mouse, and draws the two gestures in line art for the welcome and for How
 * It Plays.
 *
 * Everything here is dressing: a poster that is not there leaves its game's
 * backdrop in its place, and nothing waits for a picture.
 */
import type { GameEntry } from "../engine/types";
import { siteUrl } from "../engine/fetch";
import { backdropCss } from "../ui/backdrop";
import { $, element } from "../ui/dom";
import { posterInto } from "./arcade";
import type { Tile } from "./route";

export type GestureKind = "pistol" | "wheel";

/** Draws a gesture's line art and its steps (the templates in index.html) into a figure. */
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
    eyebrow: "Arcade",
    title: "Finger Pistol",
    gesture: "pistol",
    body: () =>
      "Point your finger at the screen like a gun. Fold your thumb to fire. Your camera sees your hand, and the picture never leaves this computer.",
  },
  "grip-prix": {
    eyebrow: "Grip Prix",
    title: "Grip the Wheel",
    gesture: "wheel",
    body: (grip) =>
      grip?.about ?? "Hold your fists up like a wheel and turn it. Race up to three friends, each on their own camera or all on one big screen.",
  },
};

export class Landing {
  private readonly collage: Collage;
  private readonly tiles: Record<Tile, HTMLElement> = { arcade: $("tile-arcade"), "grip-prix": $("tile-grip") };

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

  /** Stands on a tile's own button: where the player came from, or was sent to. */
  focus(tile: Tile): void {
    this.tiles[tile].querySelector<HTMLElement>(".tile-go")?.focus({ preventScroll: true });
    // Stacked on a phone, the tile may be below the fold: bring it into view.
    this.tiles[tile].scrollIntoView({ block: "nearest", behavior: motionReduced() ? "auto" : "smooth" });
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
