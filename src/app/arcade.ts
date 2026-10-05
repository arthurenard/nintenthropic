/**
 * The arcade's row of games: every game's poster as a card, the chosen one
 * marked, chosen by a click or - as a radio group, one tab stop - the arrow
 * keys. The cards sit under a heading per kind of game (Shooting, Racing),
 * side by side in the one row, and the arrow keys run on through them all.
 * The choice is remembered, and it is the page's address: a link to
 * `#dead-of-night` (or `?game=dead-of-night`) opens the arcade on that game,
 * so a player can pass a game on.
 */
import type { GameEntry } from "../engine/types";
import { siteUrl } from "../engine/fetch";
import { backdropCss } from "../ui/backdrop";
import { element } from "../ui/dom";

/** The headings the arcade lists games under, in order. */
export const CATEGORIES = [
  { id: "shooting", title: "Shooting" },
  { id: "racing", title: "Racing" },
] as const;

export type Category = (typeof CATEGORIES)[number]["id"];

/** Which heading a game is under: Shooting unless its entry says otherwise. */
export const categoryOf = (game: GameEntry): Category => game.category ?? "shooting";

/**
 * The games under their headings, in the headings' order and the arcade's
 * order within each. A heading with no game is left out. Flattened, this is
 * the order the row is walked in with the arrow keys.
 */
export function groupGames(games: readonly GameEntry[]): { id: Category; title: string; games: GameEntry[] }[] {
  return CATEGORIES.map(({ id, title }) => ({ id, title, games: games.filter((game) => categoryOf(game) === id) })).filter(
    (group) => group.games.length > 0,
  );
}

/** The game id an address's hash names ("#dead-of-night"), or "" for none or one that is not text. */
export function hashId(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/**
 * The game to open the arcade on: the one the address names (its hash, else
 * its ?game=), else the one chosen last, else the first that can be played.
 */
export function initialGame(
  arcade: readonly GameEntry[],
  from: { hash: string; search: string; remembered: string | null },
): GameEntry | undefined {
  const byId = (id: string | null | undefined) => (id ? arcade.find((game) => game.id === id) : undefined);
  const hash = hashId(from.hash);
  const query = new URLSearchParams(from.search).get("game");
  return byId(hash) ?? byId(query) ?? byId(from.remembered) ?? arcade.find((game) => typeof game.create === "function") ?? arcade[0];
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

export class Shelf {
  private readonly cards: HTMLButtonElement[];
  /** The games in the order the row shows them (grouped by heading): the order of the cards and of the arrow keys. */
  private readonly games: GameEntry[];
  private index = 0;

  constructor(
    group: HTMLElement,
    games: readonly GameEntry[],
    private readonly onChoose: (game: GameEntry, how: "click" | "key") => void,
  ) {
    const groups = groupGames(games);
    this.games = groups.flatMap((g) => g.games);
    this.cards = this.games.map((game) => this.card(game));
    // The row's width is shared out by how many cards there are and how many headings
    // (screens.css works out a card's width from them, and so the hero's height).
    const home = group.parentElement ?? group;
    home.style.setProperty("--all", String(this.cards.length));
    home.style.setProperty("--groups", String(groups.length));
    let at = 0;
    group.replaceChildren(
      ...groups.map((g) => {
        const section = element("div", "shelf-group");
        section.style.setProperty("--n", String(g.games.length));
        const cards = element("div", "shelf-cards");
        cards.append(...this.cards.slice(at, at + g.games.length));
        at += g.games.length;
        section.append(element("h2", "shelf-heading eyebrow", g.title), cards);
        return section;
      }),
    );
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

  /** Marks `game` as the chosen one (one tab stop: the chosen card). */
  show(game: GameEntry): void {
    const index = Math.max(0, this.games.indexOf(game));
    this.index = index;
    this.cards.forEach((card, i) => {
      const chosen = i === index;
      card.setAttribute("aria-checked", String(chosen));
      card.tabIndex = chosen ? 0 : -1;
    });
  }
}
