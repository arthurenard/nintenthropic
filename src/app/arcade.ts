/**
 * The arcade: the finger-pistol shooters, one chosen to be the hero and the
 * rest in a row of posters below it - a radio group with one tab stop, the
 * arrow keys choosing - which scrolls and snaps where the row is wider than
 * the window. The choice is remembered, and it is the page's address
 * (route.ts): a link to `#dead-of-night` opens the arcade on that game.
 *
 * Grip Prix is not in the row. It is a page of its own, shown beside the
 * arcade on the landing, not a game to choose here.
 */
import type { GameEntry } from "../engine/types";
import { siteUrl } from "../engine/fetch";
import { backdropCss } from "../ui/backdrop";
import { element } from "../ui/dom";

/** Which kind of game: Shooting unless its entry says otherwise. */
export const categoryOf = (game: GameEntry): "shooting" | "racing" => game.category ?? "shooting";

/** The games the arcade lists: the shooters, in the arcade's order. */
export const shooters = (games: readonly GameEntry[]): GameEntry[] => games.filter((game) => categoryOf(game) === "shooting");

/**
 * The game to open the arcade on: the one the address named, else the one
 * chosen last, else the first that can be played. A name that is not in the
 * arcade (a game that has left it, Grip Prix) is passed over.
 */
export function pickGame(arcade: readonly GameEntry[], named: string | null, remembered: string | null): GameEntry | undefined {
  const byId = (id: string | null | undefined) => (id ? arcade.find((game) => game.id === id) : undefined);
  return byId(named) ?? byId(remembered) ?? arcade.find((game) => typeof game.create === "function") ?? arcade[0];
}

/** The next game along the row for a key, wrapping round, or null for a key that does not move. */
export function step(count: number, at: number, key: string): number | null {
  const to = ({ ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: count - 1 } as Record<string, number>)[key];
  return to === undefined ? null : (to + count) % count;
}

/** A game's poster in a box that shows its backdrop until the picture loads (or if it never does). */
export function posterInto(box: HTMLElement, image: HTMLImageElement, game: GameEntry): void {
  box.style.setProperty("--poster-fallback", backdropCss(game.backdrop));
  const src = siteUrl(game.poster);
  if (image.dataset.src === src) return;
  image.dataset.src = src;
  image.classList.remove("loaded");
  image.hidden = false;
  image.onload = () => image.classList.add("loaded");
  // No poster yet: the backdrop stays, and nothing pretends to be the game.
  image.onerror = () => (image.hidden = true);
  image.src = src;
}

/** How long a poster takes to give way to the next, ms (the CSS transition on .hero-art img). */
const CROSSFADE = 700;

/**
 * The hero's full-bleed picture. Another game's poster fades in over the
 * one before it, which goes only once the new one is whole: the picture
 * never dips to the backdrop between two games.
 */
export class HeroArt {
  private current: HTMLImageElement | null = null;
  private readonly layers = new Set<HTMLImageElement>();

  constructor(private readonly box: HTMLElement) {}

  show(game: GameEntry): void {
    this.box.style.setProperty("--poster-fallback", backdropCss(game.backdrop));
    const src = siteUrl(game.poster);
    if (this.current?.dataset.src === src) return;
    const image = element("img");
    image.alt = "";
    image.decoding = "async";
    image.dataset.src = src;
    this.current = image;
    this.layers.add(image);
    const retire = (others: HTMLImageElement[], fade: boolean) => {
      for (const other of others) {
        this.layers.delete(other);
        if (fade) other.classList.remove("loaded");
        window.setTimeout(() => other.remove(), CROSSFADE);
      }
    };
    image.onload = () => {
      image.classList.add("loaded");
      retire([...this.layers].filter((other) => other !== image), false);
    };
    image.onerror = () => {
      // No poster for this game: the others fade away to its backdrop, and nothing pretends to be the game.
      this.layers.delete(image);
      image.remove();
      if (this.current === image) {
        this.current = null;
        retire([...this.layers], true);
      }
    };
    this.box.append(image);
    image.src = src;
  }
}

export class Shelf {
  private readonly cards: HTMLButtonElement[];
  private index = 0;

  constructor(
    private readonly group: HTMLElement,
    /** The games in the order the row shows them: the order of the cards and of the arrow keys. */
    private readonly games: readonly GameEntry[],
    private readonly onChoose: (game: GameEntry, how: "click" | "key") => void,
  ) {
    this.cards = this.games.map((game) => this.card(game));
    // The row's width is shared out by how many cards there are (screens.css sizes a card from it).
    group.style.setProperty("--n", String(this.cards.length));
    group.replaceChildren(...this.cards);
    group.addEventListener("keydown", (event) => {
      const to = step(this.cards.length, this.index, event.key);
      if (to === null) return;
      event.preventDefault();
      this.cards[to]!.focus();
      this.choose(to, "key");
    });
  }

  private card(game: GameEntry): HTMLButtonElement {
    const card = element("button", "game-card");
    card.type = "button";
    card.setAttribute("role", "radio");
    card.dataset.game = game.id;
    const art = element("span", "game-card-art");
    const image = element("img");
    image.alt = "";
    image.decoding = "async";
    image.loading = "lazy";
    art.append(image);
    posterInto(art, image, game);
    const words = element("span", "game-card-words");
    words.append(element("span", "game-card-title", game.title));
    if (typeof game.create !== "function" && typeof game.page !== "string") words.append(element("span", "game-card-soon", "Coming Soon"));
    card.append(art, words);
    card.addEventListener("click", () => this.choose(this.cards.indexOf(card), "click"));
    return card;
  }

  private choose(index: number, how: "click" | "key"): void {
    const game = this.games[index];
    if (!game) return;
    const changed = index !== this.index;
    this.show(game);
    if (changed || how === "click") this.onChoose(game, how);
  }

  /** Marks `game` as the chosen one (one tab stop: the chosen card), and brings its card into the row's view. */
  show(game: GameEntry): void {
    const index = Math.max(0, this.games.indexOf(game));
    this.index = index;
    this.cards.forEach((card, i) => {
      const chosen = i === index;
      card.setAttribute("aria-checked", String(chosen));
      card.tabIndex = chosen ? 0 : -1;
    });
  }

  /** Scrolls the row, not the page, so the chosen card is whole in it (the row scrolls where it is wider than the window). */
  reveal(smooth: boolean): void {
    const card = this.cards[this.index];
    if (!card || this.group.scrollWidth <= this.group.clientWidth) return;
    const to = card.offsetLeft - (this.group.clientWidth - card.offsetWidth) / 2;
    this.group.scrollTo({ left: Math.max(0, to), behavior: smooth ? "smooth" : "auto" });
  }
}
