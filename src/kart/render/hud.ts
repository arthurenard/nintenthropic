/**
 * Each viewport's HUD, in HTML over the canvas (hud.css; DESIGN.md's glass,
 * type and voice): lap and time top left, the item slot top centre, the
 * place large bottom right, the minimap bottom left, and in the middle the
 * countdown, "Final Lap", "Wrong Way" and the place on finishing. With three
 * players the free quadrant holds the map and the standings instead.
 *
 * It only touches the DOM when a value changes, so a steady frame costs a few
 * comparisons per viewport.
 */
import "./hud.css";
import type { ItemKind, KartView, RaceEvent, RaceView, RacerSetup } from "../contract";
import type { TrackGeometry } from "../track/geometry";
import { hudScale, type Rect, type ViewLayout } from "./layout";
import { formatRaceTime, ordinal } from "./math";
import { Minimap } from "./minimap";

const ICONS: Record<ItemKind, string> = {
  nitro: '<path d="M13.4 2.6 5.4 13.6h5.3l-1 7.8 8.9-11.5h-5.6l.4-7.3Z"/>',
  nitro3: '<path d="M13.4 2.6 5.4 13.6h5.3l-1 7.8 8.9-11.5h-5.6l.4-7.3Z"/>',
  puck: '<ellipse cx="12" cy="9" rx="8.2" ry="3.7"/><path d="M3.8 9v5.6c0 2 3.7 3.7 8.2 3.7s8.2-1.7 8.2-3.7V9"/>',
  seeker: '<circle cx="12" cy="12" r="6.6" fill="none"/><circle cx="12" cy="12" r="2.4"/><path d="M12 2.4v3.4M12 18.2v3.4M2.4 12h3.4M18.2 12h3.4" fill="none"/>',
  slick: '<path d="M12 3s6.8 6.8 6.8 11.5a6.8 6.8 0 0 1-13.6 0C5.2 9.8 12 3 12 3Z"/>',
  puck3: '<ellipse cx="7" cy="8" rx="4.4" ry="2"/><ellipse cx="17" cy="8" rx="4.4" ry="2"/><ellipse cx="12" cy="16" rx="4.4" ry="2"/>',
  comet: '<circle cx="16.4" cy="7.6" r="3.5"/><path d="M13.7 9.9 3.2 20.4M11.4 7.4 4 14.8M16.4 12.3 9.4 19.4" fill="none"/>',
  storm: '<path d="M7.2 14.2a4.4 4.4 0 0 1 .5-8.8 5.6 5.6 0 0 1 10.5 1.7 3.6 3.6 0 0 1-.4 7.1" fill="none"/><path d="m12.9 11.4-3.6 5.4h3l-1.3 4.8 4.4-6.5h-3l1.1-3.7Z"/>',
  skyrocket: '<path d="M12.5 2.6c3.2 2.3 4.5 5.8 4.2 9.6l2.1 3.6-3.6-.9-1.3 2.2h-3.3l-1.3-2.2-3.6.9 2.1-3.6c-.3-3.8 1-7.3 4.2-9.6Z" transform="rotate(32 12 12)"/><circle cx="12.5" cy="9.2" r="1.5" fill="#000" stroke="none" transform="rotate(32 12 12)"/>',
  blast: '<circle cx="12" cy="12" r="2.8"/><circle cx="12" cy="12" r="6.2" fill="none"/><circle cx="12" cy="12" r="9.6" fill="none" stroke-dasharray="2.6 2.4"/>',
  decoy: '<path d="M12 2.8 20.5 7.4v9.2L12 21.2l-8.5-4.6V7.4Z" fill="none"/><circle cx="9.2" cy="10.3" r="1.1"/><path d="M13.4 10.3h2.6M8.7 14c1.8 2.1 4.9 2.1 6.7 0" fill="none"/>',
};
/** The roulette turns through these, alternating shapes. */
const ROLL_ORDER: ItemKind[] = ["nitro", "puck", "comet", "slick", "storm", "seeker", "blast", "nitro3", "decoy", "puck3", "skyrocket"];
/** An item's icon as a 24-unit SVG body (the dev page's icon sheet draws them all). */
export const ITEM_ICONS: Readonly<Record<ItemKind, string>> = ICONS;
const EMPTY_ICON = '<circle cx="12" cy="12" r="7.5" fill="none" stroke-dasharray="2 4.2"/>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
}

/** Sets text only when it differs, so an unchanged frame writes nothing. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setRect(node: HTMLElement, r: Rect): void {
  node.style.left = `${r.x}px`;
  node.style.top = `${r.y}px`;
  node.style.width = `${r.w}px`;
  node.style.height = `${r.h}px`;
}

/** The free quadrant holds only a map and a list, so its type runs larger than the play views'. */
function freeScale(rect: Rect): number {
  return Math.max(0.7, Math.min(1.35, hudScale(rect.w, rect.h) * 1.6));
}

function restart(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

interface ViewHud {
  kartId: number;
  rect: Rect;
  scale: number;
  root: HTMLElement;
  lapCount: HTMLElement;
  lapTime: HTMLElement;
  item: HTMLElement;
  itemSvg: SVGSVGElement;
  uses: HTMLElement;
  incoming: HTMLElement;
  incomingText: HTMLElement;
  place: HTMLElement;
  placeN: HTMLElement;
  placeS: HTMLElement;
  finalLap: HTMLElement;
  wrong: HTMLElement;
  count: HTMLElement;
  finish: HTMLElement;
  finishPlace: HTMLElement;
  finishTime: HTMLElement;
  map: HTMLElement | null;
  mapCanvas: HTMLCanvasElement | null;
  // What was last written.
  lastPlace: number;
  lastItem: string;
  lastCount: string;
  lastLap: number;
  finalUntil: number;
  rollClock: number;
  rollIndex: number;
  wasRolling: boolean;
  shownFinal: boolean;
}

interface FreeHud {
  root: HTMLElement;
  /** The map box's size in CSS px once laid out (measured once, not every frame). */
  mapSize: { w: number; h: number } | null;
  rect: Rect;
  mapBox: HTMLElement;
  canvas: HTMLCanvasElement;
  list: HTMLElement;
  rows: HTMLElement[];
  lastKey: string;
}

export interface HudOptions {
  /** Backdrop blur on the glass. */
  blur: boolean;
  /** Fade instead of move (Reduce Motion). */
  calm: boolean;
}

export class Hud {
  private views: ViewHud[] = [];
  private free: FreeHud | null = null;
  private readonly map = new Minimap();
  private racers: readonly RacerSetup[] = [];
  private local = new Set<number>();
  private lastEvent = -1;
  private clock = 0;
  private dpr = 1;

  constructor(
    private readonly root: HTMLElement,
    private options: HudOptions,
  ) {
    root.classList.add("gp-hud");
    this.applyOptions();
  }

  setOptions(options: Partial<HudOptions>): void {
    this.options = { ...this.options, ...options };
    this.applyOptions();
  }

  private applyOptions(): void {
    this.root.classList.toggle("gp-blur", this.options.blur);
    this.root.classList.toggle("gp-calm", this.options.calm);
  }

  setTrack(track: TrackGeometry, racers: readonly RacerSetup[]): void {
    this.map.setTrack(track);
    this.racers = racers;
  }

  /** A new race: events are numbered afresh, and nothing from the last one lingers. */
  resetRace(): void {
    this.lastEvent = -1;
    for (const v of this.views) {
      v.finalUntil = -1;
      v.shownFinal = false;
      v.lastLap = 0;
      v.lastPlace = -1;
    }
  }

  setDpr(dpr: number): void {
    this.dpr = dpr;
  }

  /** Lays the HUD out for a new set of viewports. */
  setViews(layout: ViewLayout, karts: readonly number[]): void {
    for (const v of this.views) v.root.remove();
    this.views = [];
    this.free?.root.remove();
    this.free = null;
    this.local = new Set(karts);
    layout.views.forEach((rect, i) => {
      const id = karts[i];
      if (id === undefined) return;
      this.views.push(this.build(id, rect, layout.views.length === 1));
    });
    if (layout.free) this.free = this.buildFree(layout.free);
  }

  private build(kartId: number, rect: Rect, withMap: boolean): ViewHud {
    const root = el("div", "gp-view", this.root);
    const scale = hudScale(rect.w, rect.h);
    setRect(root, rect);
    root.style.setProperty("--u", String(scale));

    const lap = el("div", "gp-lap gp-glass", root);
    const lapCount = el("div", "gp-lap-count", lap);
    const lapTime = el("div", "gp-lap-time", lap);

    const item = el("div", "gp-item gp-glass gp-empty", root);
    const itemSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    itemSvg.setAttribute("viewBox", "0 0 24 24");
    itemSvg.innerHTML = EMPTY_ICON;
    item.appendChild(itemSvg);
    const uses = el("span", "gp-uses", item);

    // A skyrocket on its way to this kart: the edges of the view glow red, and the banner says so.
    const incoming = el("div", "gp-incoming", root);
    const incomingBanner = el("div", "gp-incoming-banner gp-glass", incoming);
    const incomingRing = el("span", "gp-incoming-ring", incomingBanner);
    incomingRing.setAttribute("aria-hidden", "true");
    const incomingText = el("span", "gp-incoming-text", incomingBanner);
    incoming.setAttribute("aria-live", "assertive");

    const place = el("div", "gp-place", root);
    const placeN = el("span", "gp-place-n", place);
    const placeS = el("span", "gp-place-s", place);

    const finalLap = el("div", "gp-banner gp-glass", root);
    finalLap.textContent = "Final Lap";
    finalLap.setAttribute("aria-live", "polite");
    const wrong = el("div", "gp-banner gp-wrong gp-glass", root);
    wrong.textContent = "Wrong Way";
    wrong.setAttribute("aria-live", "assertive");
    wrong.style.top = `calc(var(--m) + 90px * var(--u))`;

    const count = el("div", "gp-count", root);
    count.setAttribute("aria-live", "polite");
    const finish = el("div", "gp-finish gp-glass", root);
    finish.setAttribute("aria-live", "polite");
    el("div", "gp-finish-eyebrow", finish).textContent = "Finished";
    const finishPlace = el("div", "gp-finish-place", finish);
    const finishTime = el("div", "gp-finish-time", finish);

    let map: HTMLElement | null = null;
    let mapCanvas: HTMLCanvasElement | null = null;
    if (withMap) {
      map = el("div", "gp-map gp-glass", root);
      mapCanvas = el("canvas", "", map);
    }

    return {
      kartId,
      rect,
      scale,
      root,
      lapCount,
      lapTime,
      item,
      itemSvg,
      uses,
      incoming,
      incomingText,
      place,
      placeN,
      placeS,
      finalLap,
      wrong,
      count,
      finish,
      finishPlace,
      finishTime,
      map,
      mapCanvas,
      lastPlace: -1,
      lastItem: "",
      lastCount: "",
      lastLap: 0,
      finalUntil: -1,
      rollClock: 0,
      rollIndex: 0,
      wasRolling: false,
      shownFinal: false,
    };
  }

  private buildFree(rect: Rect): FreeHud {
    const root = el("div", "gp-free", this.root);
    setRect(root, rect);
    const scale = freeScale(rect);
    root.style.setProperty("--u", String(scale));
    const inner = el("div", "gp-free-inner", root);
    const mapBox = el("div", "gp-map gp-glass", inner);
    const canvas = el("canvas", "", mapBox);
    const list = el("div", "gp-standings gp-glass", inner);
    el("div", "gp-eyebrow", list).textContent = "Standings";
    return { root, mapSize: null, rect, mapBox, canvas, list, rows: [], lastKey: "" };
  }

  update(view: RaceView, dt: number): void {
    this.clock += dt;
    const byId = new Map<number, KartView>();
    for (const k of view.karts) byId.set(k.id, k);

    // Events, once each.
    const fresh: RaceEvent[] = [];
    for (const e of view.events) {
      if (e.id > this.lastEvent) {
        fresh.push(e);
        this.lastEvent = Math.max(this.lastEvent, e.id);
      }
    }

    for (const v of this.views) {
      const kart = byId.get(v.kartId);
      if (!kart) continue;
      for (const e of fresh) {
        if (e.type === "final-lap" && e.kart === v.kartId) v.finalUntil = this.clock + 2.6;
        if (e.type === "lap" && e.kart === v.kartId) restart(v.lapCount, "gp-pop");
      }
      this.updateView(v, kart, view);
    }
    if (this.free) this.updateFree(this.free, view);
  }

  private updateView(v: ViewHud, kart: KartView, view: RaceView): void {
    const done = kart.finished !== null;
    const lapShown = Math.min(Math.max(kart.lap, 1), view.laps);
    setText(v.lapCount, `Lap ${lapShown}/${view.laps}`);
    setText(v.lapTime, formatRaceTime(done ? (kart.finished as number) : view.time));
    if (kart.lap !== v.lastLap) {
      if (v.lastLap > 0 && !done) restart(v.lapCount, "gp-pop");
      v.lastLap = kart.lap;
    }

    // Place.
    if (kart.place !== v.lastPlace) {
      const o = ordinal(kart.place);
      setText(v.placeN, o.number);
      setText(v.placeS, o.suffix);
      v.place.classList.toggle("gp-first", kart.place === 1);
      if (v.lastPlace > 0) restart(v.place, "gp-pop");
      v.lastPlace = kart.place;
    }
    v.place.style.display = done ? "none" : "";

    // The item slot.
    this.updateItem(v, kart);
    this.updateIncoming(v, kart, view);

    // Final lap: by event, or by the lap counter when no event reached us.
    if (!v.shownFinal && view.laps > 1 && kart.lap === view.laps && !done) {
      v.shownFinal = true;
      if (v.finalUntil < 0) v.finalUntil = this.clock + 2.6;
    }
    if (kart.lap < view.laps) v.shownFinal = false;
    v.finalLap.classList.toggle("gp-on", this.clock < v.finalUntil && !done);
    v.wrong.classList.toggle("gp-on", kart.wrongWay && !done && view.phase === "racing");

    // Countdown.
    let text = "";
    let cls = "";
    if (view.phase === "countdown") {
      if (view.countdown > 3) {
        text = "Get Ready";
        cls = "gp-ready";
      } else if (view.countdown > 0) {
        text = String(Math.ceil(view.countdown));
      }
    } else if (view.time < 0.9) {
      text = "Go";
      cls = "gp-go";
    }
    if (text !== v.lastCount) {
      v.lastCount = text;
      setText(v.count, text);
      v.count.className = `gp-count${cls ? ` ${cls}` : ""}`;
      if (text && cls !== "gp-ready") restart(v.count, "gp-on");
      else if (text) v.count.classList.add("gp-on");
      else v.count.classList.remove("gp-on");
    }

    // Finished.
    v.finish.classList.toggle("gp-on", done);
    if (done) {
      const o = ordinal(kart.place);
      const html = `${o.number}<small>${o.suffix}</small>`;
      if (v.finishPlace.innerHTML !== html) v.finishPlace.innerHTML = html;
      v.finishPlace.classList.toggle("gp-first", kart.place === 1);
      setText(v.finishTime, formatRaceTime(kart.finished as number));
    }

    if (v.map && v.mapCanvas) {
      const w = Math.round(190 * v.scale);
      const h = Math.max(Math.round(70 * v.scale), Math.min(Math.round(170 * v.scale), Math.round(w / this.map.aspect)));
      v.mapCanvas.style.width = `${w}px`;
      v.mapCanvas.style.height = `${h}px`;
      this.map.draw(v.mapCanvas, w, h, this.dpr, v.scale, view.karts, this.racers, this.local);
    }
  }

  private updateItem(v: ViewHud, kart: KartView): void {
    let key: string;
    let svg: string;
    let empty = false;
    if (kart.rolling) {
      v.rollClock += 1;
      if (v.rollClock % 5 === 0) v.rollIndex = (v.rollIndex + 1) % ROLL_ORDER.length;
      const kind = ROLL_ORDER[v.rollIndex]!;
      key = `roll:${kind}`;
      svg = ICONS[kind];
    } else if (kart.item) {
      key = `item:${kart.item}`;
      svg = ICONS[kart.item];
    } else {
      key = "none";
      svg = EMPTY_ICON;
      empty = true;
    }
    if (key !== v.lastItem) {
      v.lastItem = key;
      v.itemSvg.innerHTML = svg;
    }
    v.item.classList.toggle("gp-empty", empty);
    v.item.classList.toggle("gp-rolling", kart.rolling);
    if (v.wasRolling && !kart.rolling && kart.item) restart(v.item, "gp-got");
    v.wasRolling = kart.rolling;
    setText(v.uses, !kart.rolling && (kart.item === "nitro3" || kart.item === "puck3") ? `×${kart.itemUses}` : "");
    v.item.dataset.item = kart.rolling ? "" : (kart.item ?? "");
  }

  /** A skyrocket flying to this kart: red edges, "Incoming", and what to do about it. */
  private updateIncoming(v: ViewHud, kart: KartView, view: RaceView): void {
    let near = -1;
    for (const t of view.things) {
      if (t.kind !== "skyrocket" || t.target !== v.kartId) continue;
      near = Math.max(near, 1 - Math.min(1, Math.hypot(t.x - kart.x, t.z - kart.z) / 70));
    }
    const on = near >= 0 && kart.finished === null;
    v.incoming.classList.toggle("gp-on", on);
    if (!on) return;
    v.incoming.style.setProperty("--near", near.toFixed(2));
    setText(v.incomingText, kart.item === "blast" && !kart.rolling ? "Skyrocket incoming: use your Blast" : "Skyrocket incoming");
  }

  private updateFree(f: FreeHud, view: RaceView): void {
    // The map.
    const scale = freeScale(f.rect);
    if (!f.mapSize) {
      const box = f.mapBox.getBoundingClientRect();
      f.mapSize = { w: Math.max(40, Math.floor(box.width - 20 * scale)), h: Math.max(40, Math.floor(box.height - 20 * scale)) };
      f.canvas.style.width = `${f.mapSize.w}px`;
      f.canvas.style.height = `${f.mapSize.h}px`;
    }
    this.map.draw(f.canvas, f.mapSize.w, f.mapSize.h, this.dpr, scale * 1.15, view.karts, this.racers, this.local);

    // The standings: rebuilt only when the order or a lap changes.
    const order = [...view.karts].sort((a, b) => a.place - b.place);
    const key = order.map((k) => `${k.id}:${k.lap}:${k.finished !== null ? 1 : 0}`).join("|");
    const live = order.map((k) => (k.finished !== null ? formatRaceTime(k.finished) : `Lap ${Math.min(k.lap, view.laps)}`));
    const rowKey = key + "#" + live.join("|");
    if (rowKey !== f.lastKey) {
      f.lastKey = rowKey;
      for (const r of f.rows) r.remove();
      f.rows = order.map((k, i) => {
        const racer = this.racers.find((r) => r.id === k.id);
        const row = el("div", `gp-row${this.local.has(k.id) ? " gp-local" : ""}`, f.list);
        el("b", "", row).textContent = String(k.place);
        const dot = el("span", "gp-dot", row);
        dot.style.background = racer?.colour ?? "#fff";
        el("span", "gp-name", row).textContent = racer?.name ?? `Kart ${k.id + 1}`;
        el("span", "gp-note", row).textContent = live[i] ?? "";
        return row;
      });
    }
  }

  dispose(): void {
    for (const v of this.views) v.root.remove();
    this.free?.root.remove();
    this.views = [];
    this.free = null;
    this.root.classList.remove("gp-hud", "gp-blur", "gp-calm");
  }
}
