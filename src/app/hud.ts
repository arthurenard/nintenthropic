/**
 * The HTML glass HUD a game talks to through HudSink: the score panel in the
 * top-left corner, the revolver's cylinder in the bottom-right, and the
 * moments in between - a wave's title card, hit markers, popups, damage from
 * a direction and the red edge that recedes as the player recovers, hints, a
 * secret found. The world owns the centre; nothing stays there.
 */
import type { GameStats, HudSink, Readout } from "../engine/types";
import { $, announce, element, icon, replay, setText } from "../ui/dom";
import { formatScore } from "../ui/format";

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
}

export class Hud implements HudSink {
  /** Called once when the game ends, with its stats. */
  onGameOver: ((stats: GameStats) => void) | null = null;
  onPlayerDown: (() => void) | null = null;

  private lastScore = 0;
  private rows: Row[] = [];
  private capacity = 0;
  private turned = 0;
  private left = 0;
  private hintTimer = 0;
  private hurt = 0;
  private gameHint: string | null = null;
  private ownHint: string | null = null;
  /** The round is over: the results own the screen, and a game's late hint waits for the next round. */
  private over = false;

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
    $("cylinder").classList.toggle("golden", golden);
    $("cylinder").hidden = true;
    for (const id of ["arcs", "marks", "moments", "bursts"]) $(id).replaceChildren();
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
    if (this.rows.length !== list.length || this.rows.some((row, i) => row.label !== list[i]!.label)) {
      box.replaceChildren();
      this.rows = list.map((readout) => {
        const label = element("dt", "", readout.label);
        const value = element("dd");
        box.append(label, value);
        let meter: HTMLElement | null = null;
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
        return { label: readout.label, value, meter };
      });
    }
    list.forEach((readout, i) => {
      const row = this.rows[i]!;
      setText(row.value, readout.value);
      row.value.className = readout.tone ?? "";
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

  ammo(left: number, capacity: number, reloading: boolean): void {
    const cylinder = $("cylinder");
    cylinder.hidden = false;
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

  revolverFinish(finish: "steel" | "gold"): void {
    $("cylinder").classList.toggle("golden", finish === "gold");
  }

  damage(direction: number, hurt: number): void {
    // An arc on a ring round the middle of the view, pointing where the shot
    // came from: straight ahead at the top, to the right on the right.
    const arc = element("div", "arc");
    const span = 0.38;
    const r = 46;
    const from = [r * Math.sin(-span), -r * Math.cos(-span)];
    const to = [r * Math.sin(span), -r * Math.cos(span)];
    const drawing = svg("svg", { viewBox: "-50 -50 100 100" });
    drawing.append(svg("path", { d: `M ${from[0]} ${from[1]} A ${r} ${r} 0 0 1 ${to[0]} ${to[1]}` }));
    arc.append(drawing);
    arc.style.transform = `rotate(${direction}rad)`;
    arc.addEventListener("animationend", () => arc.remove());
    $("arcs").append(arc);
    this.health(hurt);
  }

  health(hurt: number): void {
    this.hurt = Math.max(0, Math.min(1, hurt));
    $("hurt-edge").style.opacity = String(Math.min(1, this.hurt * 1.15));
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
    words.append(element("span", "eyebrow", "Secret Found"), element("span", "headline", name), element("span", "footnote secondary num", `${found} of ${total}`));
    toast.append(star, words);
    this.moment(toast, 3500);
    announce(`Secret found: ${name}. ${found} of ${total}.`);
  }

  hint(text: string | null): void {
    if (this.over) return;
    this.gameHint = text;
    this.showHint();
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
