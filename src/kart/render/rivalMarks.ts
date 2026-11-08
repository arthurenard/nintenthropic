/**
 * A small marker over your nemesis's kart (rivals.ts): a little chevron in
 * their colour, hovering over the roof, in the viewport of the player whose
 * nemesis they are and nobody else's. Subtle on purpose: it is there to be
 * noticed when you look for it. HTML over the canvas like the bubbles, one box
 * per viewport, projected through that viewport's camera.
 *
 * Which kart wears one for whom is told with `set` (viewed kart → its nemesis);
 * its look is a pure function of the distance (`markLook`), tested without a page.
 */
import "./rivalMarks.css";
import { Vector3, type PerspectiveCamera } from "three";
import type { KartView } from "../contract";
import { hudScale, type Rect } from "./layout";

/** Beyond this, metres, the kart is too small for a marker to matter. */
export const MARK_FAR = 90;
/** It hovers this far over the roof, metres. */
const OVER = 1.55;

export interface MarkLook {
  /** 0..1 */
  opacity: number;
  /** Size relative to a 1.0-scale view. */
  scale: number;
}

/** Fades in over the first few metres (a kart on your bumper needs none), holds, fades out towards the far end. */
export function markLook(distance: number): MarkLook {
  if (!(distance > 3) || distance >= MARK_FAR) return { opacity: 0, scale: 1 };
  const near = Math.min(1, (distance - 3) / 4);
  const far = Math.min(1, (MARK_FAR - distance) / 30);
  return { opacity: 0.85 * Math.min(near, far), scale: Math.max(0.55, Math.min(1, 26 / distance + 0.2)) };
}

export class RivalMarks {
  private rivals: Readonly<Record<number, number>> = {};
  private colours: ReadonlyMap<number, string> = new Map();
  private readonly layer: HTMLDivElement;
  private readonly boxes: HTMLDivElement[] = [];
  private readonly nodes: (HTMLDivElement | undefined)[] = [];
  private readonly point = new Vector3();

  constructor(root: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "gp-rival-marks";
    this.layer.setAttribute("aria-hidden", "true");
    root.appendChild(this.layer);
  }

  /** The racers' colours, for the markers (a kart id → "#RRGGBB"). */
  setColours(colours: ReadonlyMap<number, string>): void {
    this.colours = colours;
  }

  /** Viewed kart → its nemesis; none, no markers. */
  set(rivals: Readonly<Record<number, number>>): void {
    this.rivals = rivals;
  }

  /** Puts viewport `index`'s marker (the view follows `viewKart`, and was just drawn with `eye`). */
  place(index: number, rect: Rect, eye: PerspectiveCamera, kartAt: (id: number) => KartView | undefined, viewKart: number): void {
    const box = this.box(index);
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.w}px`;
    box.style.height = `${rect.h}px`;
    const rival = this.rivals[viewKart];
    const kart = rival === undefined ? undefined : kartAt(rival);
    const node = this.nodes[index];
    const hide = () => {
      if (node) node.style.display = "none";
    };
    // Not for a kart that has finished: its race is run.
    if (!kart || kart.finished !== null) return hide();
    const distance = Math.hypot(eye.position.x - kart.x, eye.position.y - kart.y, eye.position.z - kart.z);
    const look = markLook(distance);
    this.point.set(kart.x, kart.y + kart.hop + OVER, kart.z).project(eye);
    if (look.opacity <= 0 || this.point.z > 1 || this.point.z < -1 || Math.abs(this.point.x) > 1.1 || Math.abs(this.point.y) > 1.1) return hide();
    const element = node ?? this.make(index, box);
    const colour = this.colours.get(rival!) ?? "#ffffff";
    if (element.dataset.colour !== colour) {
      element.dataset.colour = colour;
      element.style.setProperty("--mark", colour);
    }
    const x = (this.point.x * 0.5 + 0.5) * rect.w;
    const y = (1 - (this.point.y * 0.5 + 0.5)) * rect.h;
    const scale = hudScale(rect.w, rect.h) * look.scale;
    element.style.display = "";
    element.style.opacity = String(look.opacity);
    element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  }

  /** How many viewports there are: the boxes of those that are gone go too. */
  setViews(count: number): void {
    for (let i = count; i < this.boxes.length; i++) this.boxes[i]?.remove();
    this.boxes.length = Math.min(this.boxes.length, count);
    this.nodes.length = Math.min(this.nodes.length, count);
  }

  dispose(): void {
    this.layer.remove();
    this.boxes.length = 0;
    this.nodes.length = 0;
  }

  private box(index: number): HTMLDivElement {
    let box = this.boxes[index];
    if (!box) {
      box = document.createElement("div");
      box.className = "gp-rival-view";
      this.layer.appendChild(box);
      this.boxes[index] = box;
    }
    return box;
  }

  private make(index: number, box: HTMLDivElement): HTMLDivElement {
    const node = document.createElement("div");
    node.className = "gp-rival-mark";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 15");
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "path");
    chevron.setAttribute("d", "M2 2.5h16L10 13z");
    svg.appendChild(chevron);
    node.appendChild(svg);
    box.appendChild(node);
    this.nodes[index] = node;
    return node;
  }
}
