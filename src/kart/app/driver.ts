/**
 * Choose Your Driver: the stage of the kart select. The chosen driver sits in
 * their kart on a plinth, in the player's own kart colour, turning slowly
 * (drag to spin it); beside it their name, weight class, a line about them
 * and four bars (Speed, Acceleration, Handling, Weight, read honestly from
 * the sim's weights: driverStats.ts). Under it the nine drivers as portrait
 * tiles; the ninth, Dabble the duck, is a dark shape that says "Find every
 * duck" until every duck has been found. Once the Konami code has been
 * entered, a Golden Kart switch joins the details.
 *
 * Every seat on this device picks in turn (one player on the keyboard or the
 * pad, or up to four sharing a camera): a strip at the top says whose turn it
 * is and lets the players hop between seats.
 *
 * The stage is one WebGL renderer (render/stage.ts) made when the screen opens
 * and let go of when it closes. Where there is no WebGL, or only software
 * drawing (or a device asking for less data), the stage is a portrait of the
 * driver instead, drawn by render/portraits.ts, which also draws the tiles.
 *
 * Arrows (and a pad's d-pad or stick) move through the nine, Return (or A)
 * goes on, Back (or B) goes back. `?stage=3d` or `?stage=photo` makes the
 * choice by hand (to look at one or the other).
 */
import { $, element, icon, replay } from "../../ui/dom";
import { CHARACTERS, characterById } from "../characters";
import { TRACKS } from "../track/tracks";
import { isUnlocked, loadUnlocks } from "../unlocks";
import type { DriverStage } from "../render/stage";
import { CLASS_WORDS, SEGMENTS, statsOf } from "./driverStats";
import { moveIn, navPresses, type NavKey } from "./nav";
import { Switch, focusHeading } from "./ui";

export interface DriverChoice {
  character: string;
  golden: boolean;
}

/** What this device has opened. */
export interface DriverAccess {
  /** Dabble, the duck. */
  duck: boolean;
  /** The golden kart. */
  golden: boolean;
}

/** What this device has opened: the duck driver once every track's duck is found, the golden kart with the Konami code. */
export function driverAccess(): DriverAccess {
  const unlocks = loadUnlocks();
  return {
    duck: isUnlocked("duck-driver", unlocks, { duckTracks: TRACKS.filter((track) => track.duck).map((track) => track.id), cups: [] }),
    golden: isUnlocked("golden", unlocks, { duckTracks: [], cups: [] }),
  };
}

/** One seat on this device: who sits there, their kart's colour, and what they have chosen so far. */
export interface DriverSeat extends DriverChoice {
  name: string;
  colour: string;
}

export interface DriverHooks {
  /** Back from the first seat. */
  back(): void;
  /** Every seat has its driver. */
  next(choices: DriverChoice[]): void;
}

/** The names of the four players' kart colours (contract.ts PLAYER_COLOURS), for the line over the title. */
const COLOUR_NAMES: Record<string, string> = { "#FF453A": "Red", "#0A84FF": "Blue", "#30D158": "Green", "#FFD60A": "Yellow" };

interface Tile {
  id: string;
  button: HTMLButtonElement;
  image: HTMLImageElement;
  name: HTMLElement;
  sub: HTMLElement;
  locked: boolean;
}

/** How the stage is drawn here. "3d" is the live kart; "photo" the portrait; "loading" until the live kart is up. */
export type StageMode = "loading" | "3d" | "photo";

/** Can the page draw a live stage without it costing more than it is worth? */
export interface StageProbe {
  /** WebGL works at all. */
  webgl: boolean;
  /** Drawing is done in software (a test machine, an old driver): too slow to spin a kart in. */
  software: boolean;
  /** A weak or hot device: fewer frames. */
  low: boolean;
}

let probed: Promise<StageProbe> | null = null;

/** Asks the browser what drawing here is like, without keeping anything it made (once: the answer does not change). */
export function probeStage(): Promise<StageProbe> {
  probed ??= askBrowser();
  return probed;
}

async function askBrowser(): Promise<StageProbe> {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return { webgl: false, software: false, low: true };
    const { gpuName, guessTier } = await import("../../engine/tier");
    const name = gpuName(gl);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    const software = /swiftshader|llvmpipe|software|basic render/i.test(name);
    return { webgl: true, software, low: guessTier(name, cores) === "low" || (cores <= 4 && matchMedia("(pointer: coarse)").matches) };
  } catch {
    return { webgl: false, software: false, low: true };
  }
}

/** The choice of live stage or portrait, from the probe and what the player and the address ask for. */
export function chooseStage(probe: StageProbe, forced: string | null, saveData: boolean): "3d" | "photo" {
  if (forced === "photo") return "photo";
  if (forced === "3d") return probe.webgl ? "3d" : "photo";
  if (!probe.webgl || probe.software || saveData) return "photo";
  return "3d";
}

export class DriverScreen {
  private readonly stageBox = $("driver-stage");
  private readonly photo = $<HTMLImageElement>("driver-photo");
  private readonly dock = $("driver-dock");
  private readonly seatStrip = $("driver-seats");
  private readonly info = $("driver-name").closest(".driver-info") as HTMLElement;
  private readonly golden: Switch;
  private readonly proceed = $<HTMLButtonElement>("driver-continue");
  private readonly tiles: Tile[] = [];
  private seats: DriverSeat[] = [];
  private seat = 0;
  /** The tile whose details are showing (a locked one is only looked at). */
  private looking = "";
  private canvas: HTMLCanvasElement | null = null;
  private stage: DriverStage | null = null;
  private watch: ResizeObserver | null = null;
  private mode: StageMode = "loading";
  private opened = 0;
  private painted = "";
  private pads = new Set<NavKey>();
  private padTimer = 0;
  private visible = false;
  private readonly keydown = (event: KeyboardEvent) => this.key(event);
  private readonly hidden = () => this.sleep();

  constructor(private readonly hooks: DriverHooks) {
    this.dock.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(".driver-tile");
      if (button) this.look(button.dataset.id!, true);
    });
    for (const character of CHARACTERS) {
      const button = element("button", "driver-tile");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.id = character.id;
      const image = element("img", "driver-tile-img");
      image.alt = "";
      image.width = image.height = 128;
      image.decoding = "async";
      const name = element("span", "driver-tile-name", character.name);
      const sub = element("span", "driver-tile-sub");
      button.append(image, name, sub);
      this.tiles.push({ id: character.id, button, image, name, sub, locked: false });
      this.dock.append(button);
    }
    const toggle = $<HTMLButtonElement>("driver-golden-switch");
    this.golden = new Switch(toggle, (on) => {
      this.current.golden = on;
      this.show();
    });
    $("driver-back").addEventListener("click", () => this.back());
    this.proceed.addEventListener("click", () => this.forward());
    this.seatStrip.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button[data-seat]");
      if (button) this.pick(Number(button.dataset.seat));
    });
  }

  private get current(): DriverSeat {
    return this.seats[this.seat]!;
  }

  /** Shows the screen for these seats (each with the driver they had), starting with the first. */
  open(seats: DriverSeat[], access: DriverAccess): void {
    // (Opened again without being left: whatever it had up is let go first.)
    this.close();
    this.seats = seats.map((seat) => ({ ...seat }));
    this.seat = 0;
    this.visible = true;
    this.opened++;
    for (const tile of this.tiles) {
      const character = characterById(tile.id)!;
      tile.locked = character.unlock === "duck-driver" && !access.duck;
      tile.button.classList.toggle("locked", tile.locked);
      tile.button.setAttribute("aria-disabled", String(tile.locked));
      tile.name.textContent = tile.locked ? "???" : character.name;
      tile.button.setAttribute("aria-label", tile.locked ? "Locked. Find every duck." : `${character.name}, ${CLASS_WORDS[character.weight]}`);
      tile.sub.replaceChildren(tile.locked ? icon("lock") : document.createTextNode(""));
      if (tile.locked) tile.sub.append(element("span", undefined, "Find every duck"));
    }
    // A driver this device has not unlocked (or one that no longer exists) falls back to the first.
    for (const one of this.seats) {
      const wanted = this.tiles.find((tile) => tile.id === one.character && !tile.locked);
      one.character = wanted?.id ?? this.tiles[0]!.id;
      one.golden = access.golden && one.golden;
    }
    $("driver-golden").hidden = !access.golden;
    this.buildSeats();
    this.enter();
    window.addEventListener("keydown", this.keydown);
    document.addEventListener("visibilitychange", this.hidden);
    this.pollPad();
    void this.startStage();
    focusHeading($("driver-title"));
  }

  /** Lets the stage and the listeners go: the screen is being left. */
  close(): void {
    this.visible = false;
    this.opened++;
    window.removeEventListener("keydown", this.keydown);
    document.removeEventListener("visibilitychange", this.hidden);
    window.clearInterval(this.padTimer);
    this.padTimer = 0;
    this.watch?.disconnect();
    this.watch = null;
    this.stage?.dispose();
    this.stage = null;
    this.canvas?.remove();
    this.canvas = null;
    this.mode = "loading";
    this.stageBox.dataset.stage = "loading";
  }

  /** The camera is starting: Continue waits. `fraction` is how much of the hand tracker has arrived (the first visit fetches it). */
  setBusy(busy: boolean, fraction = 0): void {
    this.proceed.disabled = busy;
    if (!busy) {
      this.proceed.textContent = this.seat < this.seats.length - 1 ? "Next Driver" : "Continue";
      return;
    }
    const percent = Math.round(fraction * 100);
    this.proceed.textContent = percent > 0 && percent < 100 ? `Getting Ready… ${percent}%` : "Starting Camera…";
  }

  /** What the seats have chosen so far. */
  get choices(): DriverChoice[] {
    return this.seats.map(({ character, golden }) => ({ character, golden }));
  }

  /** How the stage is drawn (for a test to know the live one came up). */
  get stageMode(): StageMode {
    return this.mode;
  }

  // --- seats --------------------------------------------------------------------------------------------

  private buildSeats(): void {
    const several = this.seats.length > 1;
    this.seatStrip.hidden = !several;
    this.seatStrip.replaceChildren(
      ...this.seats.map((seat, index) => {
        const button = element("button", "seat-chip");
        button.type = "button";
        button.setAttribute("role", "radio");
        button.dataset.seat = String(index);
        const dot = element("i", "seat-dot");
        dot.style.background = seat.colour;
        button.append(dot, element("span", undefined, seat.name));
        return button;
      }),
    );
  }

  /** Moves to a seat (its driver and kart colour come up on the stage). */
  private pick(index: number): void {
    if (index < 0 || index >= this.seats.length) return;
    this.seat = index;
    this.enter();
    this.show();
  }

  /** Brings the current seat's words, tiles and colour up. */
  private enter(): void {
    const seat = this.current;
    const several = this.seats.length > 1;
    const colourName = COLOUR_NAMES[seat.colour.toUpperCase()];
    $("driver-eyebrow").textContent = several ? `Driver ${this.seat + 1} of ${this.seats.length}` : colourName ? `Your ${colourName} Kart` : "Your Kart";
    // With several seats the chips under the title say whose turn it is; the line is for a screen reader then.
    $("driver-eyebrow").classList.toggle("visually-hidden", several);
    $("driver-title").textContent = this.seat === 0 ? "Choose Your Driver" : `Choose ${seat.name}’s Driver`;
    $("screen-driver").style.setProperty("--seat", seat.colour);
    this.seatStrip.querySelectorAll<HTMLButtonElement>("button[data-seat]").forEach((button) => {
      const on = Number(button.dataset.seat) === this.seat;
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
    });
    this.proceed.textContent = this.seat < this.seats.length - 1 ? "Next Driver" : "Continue";
    this.golden.on = seat.golden;
    this.paintTiles();
    this.look(seat.character, false);
    this.mark();
  }

  /** Marks the chosen tile in the dock, and brings it to the middle of a dock that scrolls. */
  private mark(): void {
    const chosen = this.current.character;
    for (const tile of this.tiles) {
      const on = tile.id === chosen;
      tile.button.setAttribute("aria-checked", String(on));
      tile.button.tabIndex = on ? 0 : -1;
      if (on && this.dock.scrollWidth > this.dock.clientWidth + 1) {
        const left = tile.button.offsetLeft - (this.dock.clientWidth - tile.button.offsetWidth) / 2;
        const calm = document.documentElement.hasAttribute("data-reduce-motion");
        this.dock.scrollTo({ left: Math.max(0, left), behavior: calm ? "auto" : "smooth" });
      }
    }
  }

  // --- choosing -------------------------------------------------------------------------------------------

  /** Shows `id`'s details; `pick` also chooses them (a locked one is only looked at: it says how to find it). */
  private look(id: string, pick: boolean): void {
    const tile = this.tiles.find((t) => t.id === id);
    const character = characterById(id);
    if (!tile || !character) return;
    const changed = this.looking !== id;
    this.looking = id;
    const locked = tile.locked;
    $("driver-name").textContent = locked ? "???" : character.name;
    $("driver-class").textContent = locked ? "Locked" : CLASS_WORDS[character.weight];
    $("driver-class").classList.toggle("locked", locked);
    $("driver-blurb").textContent = locked ? "Find every duck. One hides on every track." : character.blurb;
    this.info.classList.toggle("locked", locked);
    this.stats(locked ? null : character.weight);
    if (changed) replay(this.info, "swap");
    for (const other of this.tiles) other.button.classList.toggle("peek", locked && other.id === id);
    if (locked) {
      this.stageBox.classList.add("peeking");
      void this.paintPhoto(id, true);
      return;
    }
    this.stageBox.classList.remove("peeking");
    if (pick && id !== this.current.character) {
      this.current.character = id;
      this.mark();
      this.show();
    }
  }

  /** The four bars of a weight class (none for a locked driver). */
  private stats(weight: Parameters<typeof statsOf>[0] | null): void {
    const list = $("driver-stats");
    list.hidden = weight === null;
    if (weight === null) return;
    const stats = statsOf(weight);
    if (list.children.length !== stats.length) {
      list.replaceChildren(
        ...stats.map((stat) => {
          const li = element("li", "stat");
          li.dataset.stat = stat.id;
          const bar = element("span", "stat-bar");
          bar.setAttribute("aria-hidden", "true");
          for (let i = 0; i < SEGMENTS; i++) bar.append(element("i"));
          li.append(icon(stat.icon), element("span", "stat-label", stat.label), bar);
          return li;
        }),
      );
    }
    stats.forEach((stat, row) => {
      const li = list.children[row] as HTMLElement;
      li.setAttribute("aria-label", `${stat.label} ${stat.segments} of ${SEGMENTS}`);
      li.querySelectorAll("i").forEach((segment, i) => segment.classList.toggle("on", i < stat.segments));
    });
  }

  /** Puts the chosen driver on the stage (the live one, or their portrait). */
  private show(): void {
    const seat = this.current;
    this.stage?.show({ character: seat.character, colour: seat.colour, golden: seat.golden });
    if (this.mode === "photo") void this.paintPhoto(seat.character, false);
    this.stageBox.classList.remove("peeking");
  }

  private forward(): void {
    if (this.seat < this.seats.length - 1) {
      this.pick(this.seat + 1);
      return;
    }
    this.hooks.next(this.choices);
  }

  private back(): void {
    if (this.seat > 0) this.pick(this.seat - 1);
    else this.hooks.back();
  }

  // --- the keys and the pad ----------------------------------------------------------------------------------

  private key(event: KeyboardEvent): void {
    if (!this.visible || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (event.key === "Enter") {
      // On a button, Return does what that button does; on a tile or nothing, it goes on.
      if (target && target.closest("button") && !target.closest(".driver-dock") && target !== this.proceed) return;
      if (target === this.proceed) return;
      event.preventDefault();
      this.forward();
      return;
    }
    const move = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as Record<string, NavKey | undefined>)[event.key];
    if (!move) return;
    // On the seats' chips the sideways arrows hop between seats; on the switch the arrows are the page's.
    if (target?.closest("#driver-seats")) {
      if (move !== "left" && move !== "right") return;
      event.preventDefault();
      this.pick(this.seat + (move === "left" ? -1 : 1));
      this.seatStrip.querySelector<HTMLButtonElement>(`button[data-seat="${this.seat}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (target?.closest(".golden-row")) return;
    event.preventDefault();
    this.move(move, true);
  }

  /** Moves the choice one way through the nine, over the locked one. */
  private move(key: NavKey, focus: boolean): void {
    // The nine are a grid, or on a phone one row side to side.
    const style = getComputedStyle(this.dock);
    const columns = style.display === "grid" ? Math.max(1, style.gridTemplateColumns.split(" ").length) : this.tiles.length;
    let at = this.tiles.findIndex((tile) => tile.id === this.current.character);
    for (;;) {
      const next = moveIn(at, key, this.tiles.length, columns);
      if (next === at) return;
      at = next;
      if (!this.tiles[at]!.locked) break;
    }
    const tile = this.tiles[at]!;
    if (focus) tile.button.focus({ preventScroll: true });
    this.look(tile.id, true);
  }

  private pollPad(): void {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    this.padTimer = window.setInterval(() => {
      if (!this.visible || document.hidden || document.querySelector("dialog[open]")) return;
      const pad = navigator.getGamepads().find((candidate) => candidate?.connected);
      for (const press of navPresses(pad, this.pads)) {
        if (press === "confirm") this.forward();
        else if (press === "back") this.back();
        else this.move(press, false);
      }
    }, 60);
  }

  // --- the pictures ----------------------------------------------------------------------------------------------

  /** Draws the nine portraits in this seat's kart colour, a few at a time so the screen stays smooth. */
  private paintTiles(): void {
    const colour = this.current.colour;
    // Drawn again when the colour changes, or when a driver has been found since.
    const key = colour + "|" + this.tiles.map((tile) => (tile.locked ? 1 : 0)).join("");
    if (this.painted === key) return;
    this.painted = key;
    const run = this.opened;
    void (async () => {
      try {
        const { portrait, driversReady } = await import("../render/portraits");
        await driversReady();
        for (const tile of this.tiles) {
          if (run !== this.opened || this.painted !== key) return;
          const url = portrait(tile.id, { colour, silhouette: tile.locked, size: 256 });
          if (url) tile.image.src = url;
          tile.image.classList.toggle("blank", !url);
          // A frame between portraits: each is a small drawing of its own.
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      } catch {
        // No drawing here: the names are enough.
      }
    })();
  }

  /** The big portrait (the stage where there is no live one, and the silhouette over it for a locked driver). */
  private async paintPhoto(id: string, silhouette: boolean): Promise<void> {
    const run = this.opened;
    try {
      const { portrait, driversReady } = await import("../render/portraits");
      await driversReady();
      if (run !== this.opened) return;
      const url = portrait(id, { colour: this.current.colour, silhouette, size: 640, framing: "wave" });
      if (!url || run !== this.opened) return;
      this.photo.src = url;
      this.photo.hidden = false;
      this.stageBox.classList.add("has-photo");
    } catch {
      // Nothing to draw with.
    }
  }

  // --- the stage ---------------------------------------------------------------------------------------------------

  private async startStage(): Promise<void> {
    const run = this.opened;
    const calm = document.documentElement.hasAttribute("data-reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.mode = "loading";
    this.stageBox.dataset.stage = "loading";
    this.stageBox.classList.remove("has-photo", "peeking", "live");
    this.photo.hidden = true;
    const probe = await probeStage();
    if (run !== this.opened) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const wanted = chooseStage(probe, new URLSearchParams(location.search).get("stage"), connection?.saveData === true);
    if (wanted === "3d") {
      try {
        const { createDriverStage } = await import("../render/stage");
        const canvas = element("canvas", "stage-canvas");
        canvas.setAttribute("aria-hidden", "true");
        this.stageBox.prepend(canvas);
        const stage = await createDriverStage(canvas, { reduceMotion: calm, lowPower: probe.low });
        if (run !== this.opened) {
          stage.dispose();
          canvas.remove();
          return;
        }
        this.canvas = canvas;
        this.stage = stage;
        this.watch = new ResizeObserver(() => this.fit());
        this.watch.observe(this.stageBox);
        this.fit();
        this.show();
        stage.start();
        this.mode = "3d";
        this.stageBox.dataset.stage = "3d";
        // Until the first frame is up the portrait (if there is one) stands in; then the kart fades in over it.
        requestAnimationFrame(() => this.stageBox.classList.add("live"));
        return;
      } catch {
        this.canvas?.remove();
        this.canvas = null;
      }
    }
    this.mode = "photo";
    this.stageBox.dataset.stage = "photo";
    await this.paintPhoto(this.current.character, false);
  }

  private fit(): void {
    if (!this.stage) return;
    const box = this.stageBox.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) this.stage.resize(Math.round(box.width), Math.round(box.height), window.devicePixelRatio || 1);
  }

  /** The page is in the background: the stage stops drawing, and starts again when it is back. */
  private sleep(): void {
    if (!this.stage) return;
    if (document.hidden) this.stage.stop();
    else this.stage.start();
  }
}
