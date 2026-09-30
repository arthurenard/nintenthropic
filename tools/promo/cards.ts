/**
 * The promo's three cards on black: the cold open (the app's own finger-pistol
 * illustration and a few words), the title, and the end card. Everything is
 * built from the app's markup and tokens; a card's `update(t)` sets what shows
 * at t seconds (opacity and a small rise, the way the app's sheets arrive).
 */
import page from "../../index.html?raw";

export interface Card {
  update(t: number): void;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
/** 0 before `from`, 1 after `to`, eased between. */
const ramp = (t: number, from: number, to: number) => easeOut((t - from) / (to - from));

function show(el: HTMLElement, opacity: number, rise = 0): void {
  el.style.opacity = String(opacity);
  el.style.transform = rise ? `translateY(${(1 - opacity) * rise}px)` : "";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

const HAND = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-hand" /></svg>`;

/** Mounts the app's icon sprites once (they are in index.html's markup). */
export function mountSymbols(): void {
  if (document.querySelector("svg.symbols")) return;
  const doc = new DOMParser().parseFromString(page, "text/html");
  const symbols = doc.querySelector("svg.symbols");
  if (symbols) document.body.append(document.importNode(symbols, true));
}

export function coldOpen(root: HTMLElement): Card {
  mountSymbols();
  const doc = new DOMParser().parseFromString(page, "text/html");
  const figure = document.importNode(doc.querySelector(".gesture")!, true) as HTMLElement;
  figure.querySelector(".gesture-steps")?.remove();
  const point = el("p", "", "Point.");
  const shoot = el("p", "", "Shoot.");
  const words = el("div", "words");
  words.append(point, shoot);
  const card = el("div", "card");
  card.append(figure, words);
  root.append(card);
  return {
    update(t) {
      show(figure, ramp(t, 0, 0.6));
      const inP = ramp(t, 0.35, 0.8);
      const outP = 1 - ramp(t, 1.02, 1.22);
      show(point, Math.min(inP, outP), 14);
      show(shoot, ramp(t, 1.1, 1.4), 14);
    },
  };
}

export function title(root: HTMLElement): Card {
  mountSymbols();
  const mark = el("h1", "mark", `${HAND}Handy`);
  const tagline = el("p", "tagline", "An arcade you play with your hand.");
  const card = el("div", "card");
  card.append(mark, tagline);
  root.append(card);
  return {
    update(t) {
      show(mark, ramp(t, 0.2, 0.9), 22);
      show(tagline, ramp(t, 0.7, 1.4), 16);
    },
  };
}

export function endCard(root: HTMLElement, games: { name: string; poster: string }[]): Card {
  mountSymbols();
  const mark = el("h1", "mark", `${HAND}Handy`);
  const row = el("div", "shelf-row");
  const figures = games.map((g) => {
    const f = el("figure", "", `<img alt="" src="${g.poster}" /><figcaption>${g.name}</figcaption>`);
    row.append(f);
    return f;
  });
  const promise = el("p", "promise", "Four games. One finger. Runs in your browser.");
  const privacy = el("p", "privacy", "Your camera never leaves your computer.");
  const card = el("div", "card");
  card.append(mark, row, promise, privacy);
  root.append(card);
  return {
    update(t) {
      show(mark, ramp(t, 0.15, 0.8), 18);
      figures.forEach((f, i) => show(f, ramp(t, 0.6 + i * 0.12, 1.2 + i * 0.12), 16));
      show(promise, ramp(t, 1.5, 2.1), 14);
      show(privacy, ramp(t, 2.3, 2.9), 12);
    },
  };
}
