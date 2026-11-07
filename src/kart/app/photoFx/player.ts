/**
 * The animated look on the results' photo cards: each card gets a colour wash, a frame with the track's stamp, and a
 * canvas the track's effects play on (effects.ts). One loop drives all the canvases, at most 30 times a second, and only
 * while a card is on screen and the page is showing: nothing runs on a hidden results screen. With Reduce Motion, each
 * card shows its effects' best frame, still.
 */
import { drawFx } from "./effects";
import { flourishFor, LOOP, type Look } from "./looks";
import { stampText } from "./compose";

/** The longest a frame may be skipped for, ms: a 30 fps cap. */
const FRAME_MS = 30;
/** The most the canvas is sharper than the page, in pixels per px: the effects are soft, and four cards must be cheap. */
const MAX_SCALE = 1.25;

export interface FxCard {
  look: Look;
  place: number;
  field: number;
  placeLabel: string;
}

/** One card's layers; `resize` after the card changes size, `dispose` when it goes. */
export interface FxHandle {
  resize(width: number, height: number): void;
  dispose(): void;
}

interface Entry {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  card: FxCard;
  width: number;
  height: number;
  scale: number;
  seen: boolean;
  dirty: boolean;
}

const reduced = () => document.documentElement.hasAttribute("data-reduce-motion") || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

export class FxPlayer {
  private readonly entries = new Set<Entry>();
  private frame = 0;
  private last = 0;
  private origin = 0;
  private readonly seen: IntersectionObserver | null;

  constructor() {
    this.seen =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((changes) => {
            for (const change of changes) {
              const entry = [...this.entries].find((candidate) => candidate.canvas === change.target);
              if (entry) entry.seen = change.isIntersecting;
            }
            this.wake();
          });
    document.addEventListener("visibilitychange", () => this.wake());
  }

  /** Adds the wash, frame, stamp and effects canvas to a card (`figure`). */
  mount(figure: HTMLElement, card: FxCard): FxHandle {
    const { look } = card;
    figure.style.setProperty("--grade", look.filter);
    figure.style.setProperty("--tint-top", look.tint[0]);
    figure.style.setProperty("--tint-foot", look.tint[1]);
    figure.style.setProperty("--tint-k", String(look.tint[2]));
    figure.style.setProperty("--vignette", String(look.vignette));
    figure.style.setProperty("--night", String(look.night));
    figure.style.setProperty("--accent", look.accent);
    figure.dataset.look = look.id;
    const tint = document.createElement("div");
    tint.className = "shot-tint";
    const canvas = document.createElement("canvas");
    canvas.className = "shot-fx";
    canvas.setAttribute("aria-hidden", "true");
    const frame = document.createElement("div");
    frame.className = "shot-frame";
    const stamp = document.createElement("span");
    stamp.className = "shot-stamp";
    stamp.textContent = stampText(look, card.placeLabel);
    figure.append(tint, canvas, frame, stamp);
    const context = canvas.getContext("2d");
    const entry: Entry | null = context ? { canvas, context, card, width: 0, height: 0, scale: 1, seen: this.seen === null, dirty: true } : null;
    if (entry) {
      this.entries.add(entry);
      this.seen?.observe(canvas);
    }
    return {
      resize: (width, height) => {
        if (!entry || width <= 0 || height <= 0) return;
        if (Math.abs(width - entry.width) < 0.5 && Math.abs(height - entry.height) < 0.5) return;
        entry.width = width;
        entry.height = height;
        entry.scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
        canvas.width = Math.max(1, Math.round(width * entry.scale));
        canvas.height = Math.max(1, Math.round(height * entry.scale));
        entry.dirty = true;
        this.wake();
      },
      dispose: () => {
        if (entry) {
          this.entries.delete(entry);
          this.seen?.unobserve(canvas);
        }
        tint.remove();
        canvas.remove();
        frame.remove();
        stamp.remove();
      },
    };
  }

  /** Starts or stops the loop by whether anything could be seen. */
  private wake(): void {
    const show = !document.hidden && [...this.entries].some((entry) => entry.seen && entry.width > 0);
    if (show && !this.frame) {
      this.origin = performance.now();
      this.frame = requestAnimationFrame((now) => this.tick(now));
    } else if (!show && this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private tick(now: number): void {
    this.frame = 0;
    if (document.hidden) return;
    const still = reduced();
    if (now - this.last >= FRAME_MS || this.last === 0) {
      this.last = now;
      let live = false;
      for (const entry of this.entries) {
        if (!entry.seen || entry.width <= 0) continue;
        if (still) {
          if (!entry.dirty) continue;
        } else {
          live = true;
        }
        this.draw(entry, still ? entry.card.look.peak : ((now - this.origin) / 1000 + entry.card.look.peak - 0.6) % LOOP);
        entry.dirty = false;
      }
      if (still && !live) return; // a still frame is drawn: nothing more until a card changes size
    }
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  private draw(entry: Entry, t: number): void {
    const { context: c, card, width, height, scale } = entry;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    drawFx(c, width, height, t, card.look, flourishFor(card.place, card.field), card.place);
  }
}
