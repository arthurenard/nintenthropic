/**
 * Speech bubbles over karts: the "Honk!" of a horn. HTML over the canvas, like
 * the HUD: each viewport that can see the kart gets its own bubble, projected
 * from the kart through that viewport's camera, so on a split screen everyone
 * who can see the honker sees it honk.
 *
 * The animation is a pure function of the bubble's age (`bubbleLook`), so it
 * is tested without a page.
 */
import "./bubbles.css";
import { Vector3, type PerspectiveCamera } from "three";
import type { KartView } from "../contract";
import { hudScale, type Rect } from "./layout";

/** How long a bubble lives, seconds. */
export const BUBBLE_LIFE = 1.4;
/** Farther than this a kart is too small for a bubble to be worth it, metres. */
const FAR = 110;
/** A bubble floats this far over the kart's roof, metres. */
const OVER = 2.3;

export interface BubbleLook {
  opacity: number;
  /** 1 at rest. */
  scale: number;
  /** Pixels it has risen (in a 1.0-scale view). */
  rise: number;
}

/** How a bubble of this age looks: pops in with a little overshoot, drifts up, fades at the end. Reduced motion only fades. */
export function bubbleLook(age: number, calm = false): BubbleLook {
  if (age < 0 || age >= BUBBLE_LIFE) return { opacity: 0, scale: 1, rise: 0 };
  const fadeIn = Math.min(1, age / 0.08);
  const fadeOut = Math.min(1, (BUBBLE_LIFE - age) / 0.35);
  const opacity = Math.max(0, Math.min(fadeIn, fadeOut));
  if (calm) return { opacity, scale: 1, rise: 0 };
  // Out of nothing to a little over full size in 0.16 s, settling by 0.3 s.
  const pop = age < 0.16 ? 0.35 + 0.8 * (age / 0.16) : age < 0.3 ? 1.15 - 0.15 * ((age - 0.16) / 0.14) : 1;
  return { opacity, scale: pop, rise: 26 * Math.min(1, age / BUBBLE_LIFE) };
}

interface Bubble {
  id: number;
  kart: number;
  text: string;
  born: number;
}

export class Bubbles {
  /** Reduce Motion: fade, no pop or rise. */
  calm = false;

  private readonly layer: HTMLDivElement;
  private bubbles: Bubble[] = [];
  private nextId = 1;
  private readonly boxes: HTMLDivElement[] = [];
  private readonly nodes = new Map<string, HTMLDivElement>();
  private touched = new Set<string>();
  private readonly point = new Vector3();

  constructor(root: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "gp-bubbles";
    this.layer.setAttribute("aria-hidden", "true");
    root.appendChild(this.layer);
  }

  /** `kart` says something; a bubble it already has is replaced. */
  say(kart: number, text: string, time: number): void {
    this.bubbles = this.bubbles.filter((b) => b.kart !== kart);
    this.bubbles.push({ id: this.nextId++, kart, text, born: time });
  }

  get count(): number {
    return this.bubbles.length;
  }

  /** Puts the bubbles in viewport `index`, whose picture was just drawn with `eye`. */
  place(index: number, rect: Rect, eye: PerspectiveCamera, kartAt: (id: number) => KartView | undefined, time: number): void {
    const box = this.box(index);
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.w}px`;
    box.style.height = `${rect.h}px`;
    const u = hudScale(rect.w, rect.h);
    for (const bubble of this.bubbles) {
      const key = `${index}:${bubble.id}`;
      const look = bubbleLook(time - bubble.born, this.calm);
      const kart = kartAt(bubble.kart);
      const node = this.nodes.get(key);
      const hide = () => {
        if (node) node.style.display = "none";
        this.touched.add(key);
      };
      if (!kart || look.opacity <= 0) {
        hide();
        continue;
      }
      const distance = Math.hypot(eye.position.x - kart.x, eye.position.y - kart.y, eye.position.z - kart.z);
      this.point.set(kart.x, kart.y + kart.hop + OVER, kart.z).project(eye);
      if (distance > FAR || this.point.z > 1 || this.point.z < -1 || Math.abs(this.point.x) > 1.15 || Math.abs(this.point.y) > 1.15) {
        hide();
        continue;
      }
      const x = (this.point.x * 0.5 + 0.5) * rect.w;
      const y = (1 - (this.point.y * 0.5 + 0.5)) * rect.h;
      // Nearer karts get larger bubbles, within reason.
      const near = Math.max(0.55, Math.min(1.2, 24 / Math.max(8, distance)));
      const scale = u * near * look.scale;
      const element = node ?? this.make(key, box, bubble.text);
      if (element.dataset.text !== bubble.text) {
        element.dataset.text = bubble.text;
        (element.firstElementChild as HTMLElement).textContent = bubble.text;
      }
      element.style.display = "";
      element.style.opacity = String(look.opacity);
      element.style.zIndex = String(Math.max(1, Math.round(1000 - distance)));
      element.style.transform = `translate(${x.toFixed(1)}px, ${(y - look.rise * u).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      this.touched.add(key);
    }
  }

  /** After every viewport: lets go of what has expired or whose viewport is gone. */
  end(time: number): void {
    this.bubbles = this.bubbles.filter((b) => time - b.born < BUBBLE_LIFE);
    for (const [key, node] of this.nodes) {
      if (this.touched.has(key) && this.bubbles.some((b) => key.endsWith(`:${b.id}`))) continue;
      node.remove();
      this.nodes.delete(key);
    }
    this.touched.clear();
  }

  /** How many viewports there are: the boxes of those that are gone go too. */
  setViews(count: number): void {
    for (let i = count; i < this.boxes.length; i++) {
      this.boxes[i]?.remove();
      for (const key of [...this.nodes.keys()]) if (key.startsWith(`${i}:`)) this.nodes.delete(key);
    }
    this.boxes.length = Math.min(this.boxes.length, count);
  }

  /** A new race. */
  clear(): void {
    this.bubbles = [];
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    this.touched.clear();
  }

  dispose(): void {
    this.clear();
    this.layer.remove();
  }

  private box(index: number): HTMLDivElement {
    let box = this.boxes[index];
    if (!box) {
      box = document.createElement("div");
      box.className = "gp-bubble-view";
      this.layer.appendChild(box);
      this.boxes[index] = box;
    }
    return box;
  }

  private make(key: string, box: HTMLDivElement, text: string): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "gp-bubble";
    element.dataset.text = text;
    const body = document.createElement("span");
    body.className = "gp-bubble-body";
    body.textContent = text;
    element.appendChild(body);
    box.appendChild(element);
    this.nodes.set(key, element);
    return element;
  }
}
