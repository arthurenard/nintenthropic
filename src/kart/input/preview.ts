/**
 * The wheel's picture: the player's camera, mirrored as in a mirror, with the
 * wheel the game sees drawn over it - a ring through both palms that turns
 * with them, each hand a dot, and a quiet steer meter. Small in a corner of
 * the race, large on the wheel check and on a big-screen player's own device.
 *
 * It follows docs/DESIGN.md: the interface is monochrome plus one tint, and
 * here the tint is the mode - Handy's green while driving, amber while
 * braking, red when the hands are lost. A dot is solid for a fist and hollow
 * for an open hand.
 *
 * It draws what a WheelStatus says and nothing else, on the camera's own
 * picture (`video`), so it works for a live control and a recording alike.
 * The geometry (fitPicture, wheelRing) is plain functions, tested without a DOM.
 */
import type { WheelStatus } from "../contract";

/** Handy's tint for each mode (DESIGN.md: Ready green, Warning amber, Danger red). */
export const MODE_COLOURS: Readonly<Record<WheelStatus["mode"], string>> = {
  drive: "#30D158",
  brake: "#FF9F0A",
  lost: "#FF453A",
};

const SURFACE = "#1C1C1E";
const HAIRLINE = "rgba(255, 255, 255, 0.10)";

export type PreviewSize = "pip" | "full";

/** Things the picture can show that a WheelStatus does not carry. */
export interface PreviewExtras {
  /** 0..1: the level being held, drawn as a ring filling round the wheel. */
  levelProgress?: number;
}

export interface WheelPreviewOptions {
  /** A small corner picture-in-picture, or filling its container. */
  size?: PreviewSize;
  /** Two on one camera: show only this half of the picture, the one this player's wheel is in. */
  half?: "left" | "right" | null;
  /** The picture's width over its height until the video says (default 16:9). */
  aspect?: number;
}

// ─── Geometry, without a DOM ────────────────────────────────────────────────

/** How a camera picture (or half of it) sits in a canvas, filling it. */
export interface PictureFit {
  /** Canvas pixels per picture height. */
  scale: number;
  /** Where the region is drawn on the canvas (it may reach past the canvas's edges: filling means cropping). */
  dest: { x: number; y: number; width: number; height: number };
  /** The mirrored picture's point (x, y in 0..1, y down) on the canvas. */
  point(x: number, y: number): [number, number];
  /** The region in the camera's own, unmirrored pixels, to draw from. */
  source(videoWidth: number, videoHeight: number): { x: number; y: number; width: number; height: number };
}

/**
 * Fills a canvas with the picture (cropping the overflow, as `object-fit:
 * cover` does), or with its left or right half. Everything the wheel draws
 * goes through `point`, so it lands on the hand it belongs to whatever the
 * canvas's shape.
 */
export function fitPicture(width: number, height: number, aspect: number, half: "left" | "right" | null = null): PictureFit {
  const from = half === "right" ? 0.5 : 0;
  const to = half === "left" ? 0.5 : 1;
  const wide = aspect * (to - from); // the region's width, in picture heights
  const scale = Math.max(width / wide, height);
  const dest = { x: (width - wide * scale) / 2, y: (height - scale) / 2, width: wide * scale, height: scale };
  return {
    scale,
    dest,
    point: (x, y) => [dest.x + (x - from) * aspect * scale, dest.y + y * scale],
    source: (videoWidth, videoHeight) => ({ x: (1 - to) * videoWidth, y: 0, width: (to - from) * videoWidth, height: videoHeight }),
  };
}

/** The ring through two palms (canvas points): its centre, radius, and turn in radians (+ clockwise, the right hand lower). */
export function wheelRing(left: readonly [number, number], right: readonly [number, number]): { x: number; y: number; radius: number; turn: number } {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  return { x: (left[0] + right[0]) / 2, y: (left[1] + right[1]) / 2, radius: Math.hypot(dx, dy) / 2, turn: Math.atan2(dy, dx) };
}

function alpha(hex: string, opacity: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

// ─── The component ──────────────────────────────────────────────────────────

export class WheelPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private video: HTMLVideoElement | null = null;
  private size: PreviewSize;
  private half: "left" | "right" | null;
  private aspect: number;
  private observer: ResizeObserver | null = null;
  private frame = 0;

  constructor(options: WheelPreviewOptions = {}) {
    this.size = options.size ?? "full";
    this.half = options.half ?? null;
    this.aspect = options.aspect ?? 16 / 9;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Your camera, with your wheel drawn on it");
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("a 2D canvas is not available");
    this.context = context;
    this.style();
    // Until the page lays it out: a sensible backing store.
    this.canvas.width = 640;
    this.canvas.height = Math.round(640 / this.shape());
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box) this.resize(box.width, box.height);
      });
      this.observer.observe(this.canvas);
    }
  }

  /** The camera whose picture is shown (null: none yet, a dark panel). */
  attach(video: HTMLVideoElement | null): void {
    this.video = video;
    this.style();
  }

  setSize(size: PreviewSize): void {
    this.size = size;
    this.style();
  }

  setHalf(half: "left" | "right" | null): void {
    this.half = half;
    this.style();
  }

  /** The visible region's width over its height. */
  private shape(): number {
    return this.aspectNow() * (this.half ? 0.5 : 1);
  }

  private aspectNow(): number {
    const video = this.video;
    return video && video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : this.aspect;
  }

  private style(): void {
    const { style } = this.canvas;
    style.display = "block";
    style.background = SURFACE;
    style.aspectRatio = `${this.shape()} / 1`;
    style.height = "auto";
    if (this.size === "pip") {
      style.width = "240px";
      style.maxWidth = "100%";
      style.borderRadius = "16px";
      style.boxShadow = `0 0 0 1px ${HAIRLINE}, 0 16px 40px rgba(0, 0, 0, 0.4)`;
    } else {
      style.width = "100%";
      style.maxWidth = "";
      style.borderRadius = "22px";
      style.boxShadow = `0 0 0 1px ${HAIRLINE}`;
    }
  }

  /** Backing store to the laid-out size, in device pixels. */
  private resize(cssWidth: number, cssHeight: number): void {
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round((cssHeight > 0 ? cssHeight : cssWidth / this.shape()) * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /** Draws a status every animation frame until the returned function is called. `read` gives null to draw an empty panel. */
  follow(read: () => { status: WheelStatus; extras?: PreviewExtras } | null): () => void {
    const tick = () => {
      const now = read();
      this.draw(now?.status ?? null, now?.extras);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(this.frame);
  }

  /** One picture: the camera, then the wheel on it. */
  draw(status: WheelStatus | null, extras: PreviewExtras = {}): void {
    const { context: g, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;
    const fit = fitPicture(width, height, this.aspectNow(), this.half);
    // Line widths and sizes scale with the picture so a corner PiP and a full screen look alike.
    const k = Math.min(2.2, Math.max(0.6, width / 640));

    g.clearRect(0, 0, width, height);
    g.fillStyle = SURFACE;
    g.fillRect(0, 0, width, height);
    const video = this.video;
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      const from = fit.source(video.videoWidth, video.videoHeight);
      g.save();
      // Mirrored, as the player sees themself: flip about the middle of where the picture goes.
      g.translate(fit.dest.x + fit.dest.width, 0);
      g.scale(-1, 1);
      g.drawImage(video, from.x, from.y, from.width, from.height, 0, fit.dest.y, fit.dest.width, fit.dest.height);
      g.restore();
    }
    // A veil so the wheel reads over any room.
    g.fillStyle = "rgba(0, 0, 0, 0.22)";
    g.fillRect(0, 0, width, height);

    if (!status) return;
    const colour = MODE_COLOURS[status.mode];
    const left = status.left ? fit.point(status.left.x, status.left.y) : null;
    const right = status.right ? fit.point(status.right.x, status.right.y) : null;
    if (left && right) this.drawRing(wheelRing(left, right), colour, k);
    if (extras.levelProgress && extras.levelProgress > 0 && left && right) this.drawLevel(wheelRing(left, right), extras.levelProgress, k);
    for (const [hand, point] of [
      [status.left, left],
      [status.right, right],
    ] as const) {
      if (hand && point) this.drawHand(point, Math.min(34 * k, Math.max(11 * k, hand.size * fit.scale * 0.4)), hand.open, colour, k);
    }
    if (status.mode !== "lost") this.drawMeter(status.steer, colour, k);
  }

  private drawRing(ring: { x: number; y: number; radius: number; turn: number }, colour: string, k: number): void {
    const g = this.context;
    g.save();
    g.translate(ring.x, ring.y);
    g.rotate(ring.turn);
    const r = ring.radius;
    g.fillStyle = alpha(colour, 0.1);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.lineCap = "round";
    // The spokes: across, through both hands, and down - a steering wheel's T.
    g.strokeStyle = alpha(colour, 0.55);
    g.lineWidth = 4 * k;
    g.beginPath();
    g.moveTo(-r, 0);
    g.lineTo(r, 0);
    g.moveTo(0, 0);
    g.lineTo(0, r);
    g.stroke();
    // The rim.
    g.strokeStyle = colour;
    g.lineWidth = 5 * k;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
    // The top mark, so a turn can be read off a ring that is otherwise round.
    g.strokeStyle = "#FFFFFF";
    g.lineWidth = 8 * k;
    g.beginPath();
    g.arc(0, 0, r, -Math.PI / 2 - 0.2, -Math.PI / 2 + 0.2);
    g.stroke();
    g.restore();
  }

  private drawLevel(ring: { x: number; y: number; radius: number }, progress: number, k: number): void {
    const g = this.context;
    const r = ring.radius + 14 * k;
    g.save();
    g.lineCap = "round";
    g.lineWidth = 4 * k;
    g.strokeStyle = "rgba(255, 255, 255, 0.18)";
    g.beginPath();
    g.arc(ring.x, ring.y, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#FFFFFF";
    g.beginPath();
    g.arc(ring.x, ring.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
    g.stroke();
    g.restore();
  }

  /** A fist is a solid dot, an open hand a hollow one. */
  private drawHand(point: readonly [number, number], radius: number, open: boolean, colour: string, k: number): void {
    const g = this.context;
    g.save();
    g.beginPath();
    g.arc(point[0], point[1], radius, 0, Math.PI * 2);
    if (open) {
      g.lineWidth = 5 * k;
      g.strokeStyle = "rgba(0, 0, 0, 0.45)";
      g.stroke();
      g.lineWidth = 3.5 * k;
      g.strokeStyle = colour;
      g.stroke();
    } else {
      g.fillStyle = colour;
      g.fill();
      g.lineWidth = 2 * k;
      g.strokeStyle = "rgba(0, 0, 0, 0.45)";
      g.stroke();
    }
    g.restore();
  }

  /** A thin bar along the bottom: how far the wheel is steering, from the middle. */
  private drawMeter(steer: number, colour: string, k: number): void {
    const g = this.context;
    const width = Math.min(this.canvas.width * 0.5, 320 * k);
    const x = (this.canvas.width - width) / 2;
    const y = this.canvas.height - 18 * k;
    const middle = x + width / 2;
    g.save();
    g.lineCap = "round";
    g.lineWidth = 5 * k;
    g.strokeStyle = "rgba(255, 255, 255, 0.22)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + width, y);
    g.stroke();
    const end = middle + (steer * width) / 2;
    if (Math.abs(steer) > 0.01) {
      g.strokeStyle = colour;
      g.beginPath();
      g.moveTo(middle, y);
      g.lineTo(end, y);
      g.stroke();
    }
    g.fillStyle = "#FFFFFF";
    g.beginPath();
    g.arc(end, y, 5 * k, 0, Math.PI * 2);
    g.fill();
    // The middle.
    g.strokeStyle = "rgba(255, 255, 255, 0.5)";
    g.lineWidth = 2 * k;
    g.beginPath();
    g.moveTo(middle, y - 7 * k);
    g.lineTo(middle, y + 7 * k);
    g.stroke();
    g.restore();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.canvas.remove();
  }
}
