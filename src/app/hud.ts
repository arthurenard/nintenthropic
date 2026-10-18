/**
 * The HTML glass HUD a game talks to through HudSink: the score panel in the
 * top-left corner, the weapon in the bottom-right (a revolver's cylinder, a
 * rifle's magazine, a laser's heat), a timed round's clock at the top, and
 * the moments in between - a wave's title card, hit markers, popups, damage
 * from a direction and the red edge that recedes as the player recovers,
 * hints, a secret found. The world owns the centre; nothing stays there.
 */
import type { AmmoStyle, GameStats, HudSink, Readout, RimArrow, SpotterMark } from "../engine/types";
import type { EyeView } from "../input/scope";
import { $, announce, element, icon, replay, setText } from "../ui/dom";
import { formatScore, formatTime } from "../ui/format";

const SVG = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

interface Row {
  label: string;
  value: HTMLElement;
  meter: HTMLElement | null;
  /** A readout's parts (Readout.segments), and the shape they were drawn for. */
  segments: SVGElement[] | null;
  shape: string;
}

/** What a readout's segments look like, so a change of count or layout redraws them. */
function segmentShape(r: Readout): string {
  return r.segments ? `${r.segmentLayout ?? "row"}:${r.segments.length}` : "";
}

/**
 * A readout's segments as an SVG: small rounded bars in a row, or a ring of
 * them round a middle disc (the first segment), clockwise from just left
 * of the top - a cupola's windows in miniature.
 */
function drawSegments(r: Readout): { svg: SVGSVGElement; parts: SVGElement[] } {
  const count = r.segments?.length ?? 0;
  const parts: SVGElement[] = [];
  if ((r.segmentLayout ?? "row") === "ring") {
    const s = svg("svg", { class: "segments ring", viewBox: "-30 -30 60 60", "aria-hidden": "true" });
    const middle = svg("circle", { class: "seg", cx: 0, cy: 0, r: 8.6 });
    s.append(middle);
    parts.push(middle);
    const around = Math.max(1, count - 1);
    const step = (Math.PI * 2) / around;
    const gap = 0.07;
    const [r1, r2] = [11.6, 27.5];
    for (let k = 0; k < around; k++) {
      // Clockwise (on screen) from just left of the top.
      const centre = Math.PI / 2 + step / 2 - k * step;
      const a0 = centre - step / 2 + gap;
      const a1 = centre + step / 2 - gap;
      const at = (rad: number, a: number) => `${(rad * Math.cos(a)).toFixed(2)},${(-rad * Math.sin(a)).toFixed(2)}`;
      const poly = svg("polygon", { class: "seg", points: [at(r1 + 0.8, a0 + 0.05), at(r2, a0), at(r2, a1), at(r1 + 0.8, a1 - 0.05)].join(" ") });
      s.append(poly);
      parts.push(poly);
    }
    return { svg: s, parts };
  }
  const width = count * 13 - 3;
  const s = svg("svg", { class: "segments row", viewBox: `0 0 ${Math.max(1, width)} 14`, "aria-hidden": "true" });
  for (let k = 0; k < count; k++) {
    const bar = svg("rect", { class: "seg", x: k * 13, y: 0, width: 10, height: 14, rx: 3 });
    s.append(bar);
    parts.push(bar);
  }
  return { svg: s, parts };
}

/**
 * What a secret's card says over its name: found, and how many of how many -
 * and for the last of them, that there is nothing left to find.
 */
export function secretWords(found: number, total: number): { eyebrow: string; tally: string } {
  if (total > 0 && found >= total) return { eyebrow: "Last Secret", tally: `${found} of ${total}. Nothing left unshot.` };
  return { eyebrow: "Secret Found", tally: `${found} of ${total}` };
}

export class Hud implements HudSink {
  /** Called once when the game ends, with its stats. */
  onGameOver: ((stats: GameStats) => void) | null = null;
  onPlayerDown: (() => void) | null = null;
  /** The game hides the page's crosshair (its own reticle is up) or brings it back. */
  onCrosshair: ((style: "default" | "none") => void) | null = null;

  private lastScore = 0;
  private rows: Row[] = [];
  private capacity = 0;
  private turned = 0;
  private left = 0;
  /** The magazine as drawn: its capacity, and its rounds and chamber. */
  private magazine: { capacity: number; rounds: SVGElement[]; chamber: SVGElement } | null = null;
  private heatShown = -1;
  private clockShown = "";
  private hintTimer = 0;
  private hurt = 0;
  private gameHint: string | null = null;
  private ownHint: string | null = null;
  /** The round is over: the results own the screen, and a game's late hint waits for the next round. */
  private over = false;
  /** The spotter's marks on screen, by the id the game gave each. */
  private readonly spots = new Map<number, HTMLElement>();
  /** The arrow on a scope's rim, once there has been one. */
  private rim: HTMLElement | null = null;
  /** The eye indicator as drawn (a key of what shows), so it is redrawn only when it changes. */
  private eyeShown = "";

  constructor(private readonly reducedMotion: () => boolean) {}

  /** A clean slate for a new game. */
  reset(golden: boolean): void {
    this.lastScore = 0;
    setText("score", "0");
    $("readouts").replaceChildren();
    this.rows = [];
    this.capacity = 0;
    this.turned = 0;
    this.left = 0;
    this.magazine = null;
    this.heatShown = -1;
    this.clockShown = "";
    for (const id of ["cylinder", "magazine", "heat"]) {
      $(id).classList.toggle("golden", golden);
      $(id).hidden = true;
    }
    this.clock(null);
    this.onCrosshair?.("default");
    for (const id of ["arcs", "marks", "moments", "bursts", "spots"]) $(id).replaceChildren();
    this.spots.clear();
    this.rim = null;
    this.eye(null);
    this.health(0);
    this.gameHint = null;
    this.ownHint = null;
    this.over = false;
    $("hint").hidden = true;
  }

  score(value: number): void {
    const text = formatScore(value);
    const node = $("score");
    if (node.textContent === text) return;
    setText(node, text);
    if (value > this.lastScore && !this.reducedMotion()) replay(node, "pop");
    this.lastScore = value;
  }

  readouts(list: Readout[]): void {
    const box = $("readouts");
    if (this.rows.length !== list.length || this.rows.some((row, i) => row.label !== list[i]!.label || row.shape !== segmentShape(list[i]!))) {
      box.replaceChildren();
      this.rows = list.map((readout) => {
        const label = element("dt", "", readout.label);
        const value = element("dd");
        box.append(label, value);
        let meter: HTMLElement | null = null;
        if (readout.segments) {
          const drawn = drawSegments(readout);
          box.append(drawn.svg);
          return { label: readout.label, value, meter, segments: drawn.parts, shape: segmentShape(readout) };
        }
        if (readout.meter !== undefined) {
          meter = element("div", readout.signed ? "meter signed" : "meter");
          meter.setAttribute("aria-hidden", "true");
          meter.append(element("span"));
          // A meter that goes down a bite at a time is cut where each bite
          // leaves it, so the bites left can be counted at a glance.
          for (const notch of readout.notches ?? []) {
            const cut = element("i");
            cut.style.left = `${notch * 100}%`;
            meter.append(cut);
          }
          box.append(meter);
        }
        return { label: readout.label, value, meter, segments: null, shape: "" };
      });
    }
    list.forEach((readout, i) => {
      const row = this.rows[i]!;
      setText(row.value, readout.value);
      row.value.className = readout.tone ?? "";
      if (row.segments && readout.segments) {
        // Each part as full as its value, in its tone; an outline when gone.
        readout.segments.forEach((part, k) => {
          const node = row.segments![k];
          if (!node) return;
          const v = Math.max(0, Math.min(1, part.value));
          node.setAttribute("class", `seg${part.tone ? ` ${part.tone}` : ""}${v <= 0 ? " gone" : ""}`);
          node.style.fillOpacity = v <= 0 ? "0" : String(0.28 + 0.72 * v);
        });
        return;
      }
      if (!row.meter || readout.meter === undefined) return;
      row.meter.className = `meter${readout.signed ? " signed" : ""}${readout.tone ? ` ${readout.tone}` : ""}`;
      const fill = row.meter.firstElementChild as HTMLElement;
      if (readout.signed) {
        // Out from the middle, whichever way it points.
        const share = Math.max(-1, Math.min(1, readout.meter));
        fill.style.left = `${50 + Math.min(0, share) * 50}%`;
        fill.style.width = `${Math.abs(share) * 50}%`;
      } else {
        fill.style.transform = `scaleX(${Math.max(0, Math.min(1, readout.meter))})`;
      }
    });
  }

  banner(title: string, subtitle?: string): void {
    const card = element("div", "banner glass");
    card.append(element("p", "title1", title));
    if (subtitle) card.append(element("p", "subhead secondary", subtitle));
    this.moment(card, 2600);
    announce(subtitle ? `${title}. ${subtitle}` : title);
  }

  /** Shows one of the weapon's corners and hides the others. */
  private dock(which: "cylinder" | "magazine" | "heat"): HTMLElement {
    for (const id of ["cylinder", "magazine", "heat"] as const) if (id !== which) $(id).hidden = true;
    const node = $(which);
    node.hidden = false;
    return node;
  }

  ammo(left: number, capacity: number, reloading: boolean, style?: AmmoStyle): void {
    if (style?.kind === "magazine") {
      this.rifle(left, capacity, reloading, style);
      return;
    }
    const cylinder = this.dock("cylinder");
    const drum = $("drum");
    if (capacity !== this.capacity) {
      // Chambers round the axle, the next to fire at the top.
      this.capacity = capacity;
      this.turned = 0;
      drum.replaceChildren(svg("circle", { class: "frame", cx: 0, cy: 0, r: 35 }));
      for (let i = 0; i < capacity; i++) {
        const angle = (i / capacity) * Math.PI * 2 - Math.PI / 2;
        drum.append(svg("circle", { class: "chamber", cx: 21 * Math.cos(angle), cy: 21 * Math.sin(angle), r: 8.5 }));
      }
      drum.append(svg("circle", { class: "axle", cx: 0, cy: 0, r: 4 }));
    }
    // Each shot turns the drum one chamber on.
    if (left < this.left && !reloading) this.turned += this.left - left;
    this.left = left;
    const chambers = [...drum.querySelectorAll(".chamber")];
    chambers.forEach((chamber, i) => {
      const fromTop = (i - this.turned + capacity * 1000) % capacity;
      chamber.classList.toggle("loaded", fromTop < left);
    });
    (drum as unknown as SVGElement).style.transform = `rotate(${(-this.turned * 360) / capacity}deg)`;
    cylinder.classList.toggle("empty", left === 0 && !reloading);
    if (reloading && !cylinder.classList.contains("reloading")) replay(cylinder, "reloading");
    if (!reloading) cylinder.classList.remove("reloading");
    cylinder.setAttribute("aria-label", reloading ? "Reloading" : `${left} of ${capacity} rounds`);
  }

  /**
   * A rifle's rounds: the magazine's in a row, and the one in the chamber
   * apart at its end, in the breech. Spent rounds stay as outlines, so how
   * many the magazine holds is always in sight.
   */
  private rifle(left: number, capacity: number, reloading: boolean, style: AmmoStyle): void {
    const dock = this.dock("magazine");
    const action = style.action ?? "ready";
    // Unsaid, a round is in the chamber whenever one is left and the action is closed on it.
    const chambered = left > 0 && (style.chambered ?? action === "ready") ? 1 : 0;
    const inMagazine = Math.max(0, Math.min(capacity - 1, left - chambered));
    if (!this.magazine || this.magazine.capacity !== capacity) this.magazine = this.drawMagazine(capacity);
    const { rounds, chamber } = this.magazine;
    // The magazine feeds from the end nearest the chamber.
    rounds.forEach((round, i) => round.classList.toggle("loaded", i >= rounds.length - inMagazine));
    const wasChambered = chamber.classList.contains("loaded");
    chamber.classList.toggle("loaded", chambered > 0);
    if (chambered > 0 && !wasChambered && !reloading) replay(chamber, "fed");
    dock.dataset.action = action;
    dock.classList.toggle("empty", left === 0 && !reloading);
    if (reloading && !dock.classList.contains("reloading")) replay(dock, "reloading");
    if (!reloading) dock.classList.remove("reloading");
    dock.setAttribute(
      "aria-label",
      reloading ? "Reloading" : `${left} of ${capacity} rounds${action === "cycling" ? ", working the action" : action === "open" ? ", action open" : ""}`,
    );
  }

  /** The magazine's rounds and its breech, sized to how many it holds. */
  private drawMagazine(capacity: number): { capacity: number; rounds: SVGElement[]; chamber: SVGElement } {
    // A round 6 wide every 11, a breech 16 wide 10 past the last, and a
    // stroke's width to spare on each side.
    const pitch = 11;
    const inMagazine = Math.max(0, capacity - 1);
    const last = inMagazine > 0 ? (inMagazine - 1) * pitch + 6 : -10;
    const breechX = last + 10;
    const width = breechX + 16 + 2;
    const art = $("magazine-art") as unknown as SVGSVGElement;
    art.setAttribute("viewBox", `-1 0 ${width} 40`);
    art.style.width = `${width}px`;
    art.replaceChildren();
    const rounds: SVGElement[] = [];
    for (let i = 0; i < inMagazine; i++) {
      const round = svg("rect", { class: "round", x: i * pitch, y: 9, width: 6, height: 22, rx: 3 });
      art.append(round);
      rounds.push(round);
    }
    art.append(svg("rect", { class: "breech", x: breechX, y: 3, width: 16, height: 34, rx: 8 }));
    const chamber = svg("rect", { class: "round chamber", x: breechX + 4, y: 8, width: 8, height: 24, rx: 4 });
    art.append(chamber);
    return { capacity, rounds, chamber };
  }

  heat(level: number, venting: boolean): void {
    const dock = this.dock("heat");
    const share = Math.max(0, Math.min(1, level));
    const percent = Math.round(share * 100);
    const ring = $("heat-level");
    ring.style.strokeDasharray = `${share * 100} 100`;
    // Stone cold: no dot of a round cap at the top.
    ring.style.opacity = share > 0.004 ? "1" : "0";
    dock.classList.toggle("warm", !venting && share >= 0.75);
    dock.classList.toggle("venting", venting);
    if (percent !== this.heatShown) {
      this.heatShown = percent;
      setText("heat-value", String(percent));
    }
    dock.setAttribute("aria-label", venting ? `Overheated, cooling: ${percent}%` : `Heat ${percent}%`);
  }

  weaponFinish(finish: "steel" | "gold"): void {
    for (const id of ["cylinder", "magazine", "heat"]) $(id).classList.toggle("golden", finish === "gold");
  }

  crosshair(style: "default" | "none"): void {
    this.onCrosshair?.(style);
  }

  clock(seconds: number | null, tone: "" | "warning" = ""): void {
    const node = $("clock");
    if (seconds === null) {
      node.hidden = true;
      delete $("game").dataset.clock;
      return;
    }
    const text = formatTime(seconds);
    if (text !== this.clockShown) {
      this.clockShown = text;
      setText(node, text);
    }
    node.classList.toggle("warning", tone === "warning");
    node.hidden = false;
    $("game").dataset.clock = "";
  }

  /** The damage arc's own shape: the top of a ring that fades out at both ends (the ring is 92% of its box). */
  private arcDrawing(): SVGSVGElement {
    const span = 0.38;
    const r = 46;
    const from = [r * Math.sin(-span), -r * Math.cos(-span)];
    const to = [r * Math.sin(span), -r * Math.cos(span)];
    const drawing = svg("svg", { viewBox: "-50 -50 100 100" });
    drawing.append(svg("path", { d: `M ${from[0]} ${from[1]} A ${r} ${r} 0 0 1 ${to[0]} ${to[1]}` }));
    return drawing;
  }

  damage(direction: number, hurt: number): void {
    // An arc on a ring round the middle of the view, pointing where the shot
    // came from: straight ahead at the top, to the right on the right.
    const arc = element("div", "arc");
    arc.append(this.arcDrawing());
    arc.style.transform = `rotate(${direction}rad)`;
    arc.addEventListener("animationend", () => arc.remove());
    $("arcs").append(arc);
    this.health(hurt);
  }

  /**
   * A shot at the player, from where `direction` points in the view (radians
   * clockwise from the top): the damage arc's own look, but on the view's
   * edge, which is where a man in the open valley can be told from the
   * middle - and softer unless the shot `hit`.
   */
  incoming(direction: number, hit = false): void {
    const layer = $("arcs");
    const w = Math.max(1, layer.clientWidth);
    const h = Math.max(1, layer.clientHeight);
    // The ray from the middle along `direction`, to the view's edge less a margin.
    const dx = Math.sin(direction);
    const dy = -Math.cos(direction);
    const inset = 44;
    const reach = Math.min((w / 2 - inset) / Math.max(1e-6, Math.abs(dx)), (h / 2 - inset) / Math.max(1e-6, Math.abs(dy)));
    // The same arc on a tighter ring, centred so that the arc's middle falls on that point and bulges toward the edge.
    const radius = Math.max(80, Math.min(170, reach * 0.7));
    const size = (2 * radius) / 0.92;
    const arc = element("div", hit ? "arc" : "arc soft");
    arc.append(this.arcDrawing());
    arc.style.width = arc.style.height = `${size.toFixed(1)}px`;
    arc.style.left = `${(w / 2 + (reach - radius) * dx).toFixed(1)}px`;
    arc.style.top = `${(h / 2 + (reach - radius) * dy).toFixed(1)}px`;
    arc.style.margin = `${(-size / 2).toFixed(1)}px 0 0 ${(-size / 2).toFixed(1)}px`;
    arc.style.transform = `rotate(${direction}rad)`;
    arc.addEventListener("animationend", () => arc.remove());
    layer.append(arc);
  }

  health(hurt: number): void {
    this.hurt = Math.max(0, Math.min(1, hurt));
    $("hurt-edge").style.opacity = String(Math.min(1, this.hurt * 1.15));
  }

  /**
   * The spotter's marks: each a small caret floating above its man, never
   * over him, the same size at any range. They are kept as they come (a mark
   * that stays only moves) and the ones that go fade out. The nearest man's
   * carries his distance; one who just fired pings a ring; the last man,
   * unfound, breathes. `rim` is the arrow on a scope's rim.
   */
  spotter(marks: SpotterMark[] | null, rim: RimArrow | null = null): void {
    const layer = $("spots");
    const keep = new Set<number>();
    for (const mark of marks ?? []) {
      keep.add(mark.id);
      let spot = this.spots.get(mark.id);
      if (!spot) {
        // A man who has just fired is marked at once; the rest fade in from nothing, a frame after they are placed.
        const fresh = element("div", mark.pulse === "shot" ? "spot" : "spot gone");
        fresh.append(icon("caret"), element("span", "spot-label glass"));
        layer.append(fresh);
        this.spots.set(mark.id, fresh);
        if (mark.pulse !== "shot") requestAnimationFrame(() => requestAnimationFrame(() => fresh.classList.remove("gone")));
        spot = fresh;
      }
      // The rest of the spot's state keys on `gone` being off, in case it was on its way out.
      if (mark.pulse === "shot") spot.classList.remove("gone");
      spot.style.left = `${(mark.x * 100).toFixed(2)}%`;
      spot.style.top = `${(mark.y * 100).toFixed(2)}%`;
      spot.style.setProperty("--lift", `${(mark.lift ?? 0).toFixed(1)}px`);
      spot.style.setProperty("--shift", `${(mark.shift ?? 0).toFixed(1)}px`);
      spot.style.setProperty("--fade", (mark.opacity ?? 1).toFixed(2));
      const label = spot.children[1] as HTMLElement;
      label.toggleAttribute("hidden", !mark.label);
      setText(label, mark.label ?? "");
      spot.style.setProperty("--label-lift", `${(mark.labelLift ?? 0).toFixed(1)}px`);
      const pulse = mark.pulse ?? "";
      if (spot.dataset.pulse !== pulse) {
        spot.dataset.pulse = pulse;
        spot.classList.toggle("last", pulse === "last");
        spot.classList.toggle("shot", pulse === "shot");
        spot.querySelector(".spot-ring")?.remove();
        if (pulse === "shot") spot.append(element("i", "spot-ring"));
      }
    }
    for (const [id, spot] of this.spots) {
      if (keep.has(id)) continue;
      this.spots.delete(id);
      spot.classList.add("gone");
      window.setTimeout(() => spot.remove(), 260);
    }
    this.rimArrow(rim);
  }

  /** The scope's rim arrow: a double caret on the rim pointing toward the nearest man, fading in and out as it comes and goes. */
  private rimArrow(rim: RimArrow | null): void {
    let node = this.rim;
    if (!rim) {
      node?.classList.add("gone");
      return;
    }
    if (!node) {
      node = element("div", "rim-arrow gone");
      node.append(icon("carets"));
      $("spots").append(node);
      this.rim = node;
      // Placed hidden, then shown, so that it fades in.
      void node.offsetWidth;
    }
    node.classList.remove("gone");
    node.style.left = `${(rim.x * 100).toFixed(2)}%`;
    node.style.top = `${(rim.y * 100).toFixed(2)}%`;
    // The carets point down; turned half a circle they point where the man is.
    (node.firstElementChild as SVGElement).style.transform = `rotate(${((rim.angle * 180) / Math.PI + 180).toFixed(1)}deg)`;
  }

  /**
   * The eye indicator, for a game that reads the eye: a small glass circle
   * with an eye in it. Dim and struck through while no face is seen, an
   * open eye with a ring that fills as the eye closes, white and closed
   * while it scopes. `null` takes it away.
   */
  eye(view: EyeView | null): void {
    const meter = $("eye-meter");
    if (!view) {
      if (!meter.hidden) meter.hidden = true;
      this.eyeShown = "";
      return;
    }
    // An open eye's readings tremble a little: the first sixth of the way is not shown as closing.
    const closing = view.scoped ? 1 : view.seen ? Math.max(0, (view.closing - 0.15) / 0.85) : 0;
    const state = view.scoped ? "scoped" : !view.seen ? "away" : closing > 0.02 ? "closing" : "seen";
    const key = `${state}|${Math.round(closing * 40)}|${view.held}`;
    if (key === this.eyeShown && !meter.hidden) return;
    this.eyeShown = key;
    meter.hidden = false;
    meter.dataset.state = state;
    meter.dataset.held = String(view.held);
    meter.setAttribute(
      "aria-label",
      state === "scoped" ? "Eye closed. Scoping" : state === "away" ? "Eye. Your face is not in view" : "Eye. Your face is seen",
    );
    // The lid comes down with the eye; the ring fills with it.
    const open = view.scoped ? 0.1 : Math.max(0.1, 1 - closing * 0.9);
    const up = (20 - 7.5 * open).toFixed(2);
    const down = (20 + 7.5 * open).toFixed(2);
    $("eye-lid").setAttribute("d", `M9 20C13 ${up} 27 ${up} 31 20C27 ${down} 13 ${down} 9 20Z`);
    $("eye-iris").setAttribute("r", (3 * Math.min(1, Math.max(0, (open - 0.2) * 1.6))).toFixed(2));
    $("eye-fill").style.strokeDasharray = `${(closing * 100).toFixed(1)} 100`;
  }

  hitMarker(x: number, y: number, kind: "hit" | "headshot" | "kill"): void {
    const marker = element("div", `hit-marker ${kind}`);
    marker.style.left = `${x * 100}%`;
    marker.style.top = `${y * 100}%`;
    marker.append(icon("hitmark"));
    marker.addEventListener("animationend", (event) => {
      if (event.animationName === "fade-out") marker.remove();
    });
    $("marks").append(marker);
  }

  popup(x: number, y: number, text: string, tone: "" | "gold" | "danger" = ""): void {
    const line = element("p", `popup${tone ? ` ${tone}` : ""}`, text);
    line.style.left = `${Math.min(0.92, Math.max(0.08, x)) * 100}%`;
    line.style.top = `${Math.min(0.94, Math.max(0.06, y)) * 100}%`;
    line.addEventListener("animationend", () => line.remove());
    $("marks").append(line);
  }

  secret(name: string, found: number, total: number): void {
    const toast = element("div", "secret glass");
    const star = element("span", "star");
    star.append(icon("star"));
    const words = element("span", "secret-text");
    const said = secretWords(found, total);
    words.append(element("span", "eyebrow", said.eyebrow), element("span", "headline", name), element("span", "footnote secondary num", said.tally));
    toast.append(star, words);
    this.moment(toast, 3500);
    announce(`${said.eyebrow}: ${name}. ${said.tally.replace(/\.?$/, ".")}`);
  }

  hint(text: string | null): void {
    if (this.over) return;
    this.gameHint = text;
    this.showHint();
  }

  /**
   * Takes back words the page put on the game's line ("Click to fire."),
   * unless the game has said something of its own since: a tip of the
   * game's is never cut short by the page's own clock.
   */
  unsay(text: string): void {
    if (this.gameHint === text) this.hint(null);
  }

  /**
   * The page's own hint ("Show your hand to the camera."), which the game
   * cannot know to give. It takes the hint's place while it stands, and the
   * game's own hint comes back after it.
   */
  pageHint(text: string | null): void {
    if (text === this.ownHint) return;
    this.ownHint = text;
    this.showHint();
  }

  private showHint(): void {
    const text = this.ownHint ?? this.gameHint;
    const hint = $("hint");
    window.clearTimeout(this.hintTimer);
    if (text === null) {
      if (hint.hidden) return;
      hint.classList.add("gone");
      this.hintTimer = window.setTimeout(() => (hint.hidden = true), 260);
      return;
    }
    setText(hint, text);
    if (hint.hidden || hint.classList.contains("gone")) {
      hint.classList.add("gone");
      hint.hidden = false;
      requestAnimationFrame(() => hint.classList.remove("gone"));
    }
  }

  playerDown(): void {
    this.onPlayerDown?.();
  }

  gameOver(stats: GameStats): void {
    this.hint(null);
    this.over = true;
    this.onGameOver?.(stats);
  }

  /** A transient card over the world, removed once it has faded. */
  private moment(node: HTMLElement, lasts: number): void {
    const moments = $("moments");
    // One title card at a time: a new one replaces the last.
    for (const old of moments.querySelectorAll(`.${node.classList[0]}`)) old.remove();
    moments.append(node);
    window.setTimeout(() => node.remove(), lasts);
  }
}
