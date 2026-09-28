/**
 * The crosshair: drawn by the page on a 2D canvas over the world, at the
 * device's full resolution, at the latest aim - so it is always crisp, never
 * waits for the 3D frame, and moves the moment the hand does. It copies the
 * desktop's: a ring broken at the compass points, ticks through the gaps and
 * a dot, green while the gun is cocked; the ring tightens as the thumb folds
 * and kicks out on each shot.
 *
 * The player may make it larger, and give it a dark outline that holds it
 * against the brightest sky (Settings, Crosshair).
 *
 * In the aim check the same canvas rings the target to shoot, softly
 * breathing, so it is plain which one is lit however the game lights it.
 */
import type { Aim } from "../engine/types";

const TINT = "#30d158";
/** How long the ring's kick lasts, ms (the desktop's RECOIL). */
const KICK = 180;

export interface CrosshairStyle {
  size: "standard" | "large";
  /** A dark outline round every stroke, for the brightest skies. */
  highContrast: boolean;
}

/** Large is half as big again. */
export const CROSSHAIR_SCALE: Record<CrosshairStyle["size"], number> = { standard: 1, large: 1.5 };

export interface CrosshairMetrics {
  /** One unit of the desktop's drawing, in device pixels. */
  unit: number;
  /** The ring's and the outer ticks' stroke. */
  weight: number;
  /** The inner ticks' stroke. */
  thin: number;
  /** How far the dark outline reaches past each stroke on either side (0 without it). */
  outline: number;
}

/** The crosshair's measurements on a stage of this size (CSS pixels) at this pixel ratio. */
export function crosshairMetrics(cssWidth: number, cssHeight: number, ratio: number, style: CrosshairStyle): CrosshairMetrics {
  const scale = CROSSHAIR_SCALE[style.size];
  // The desktop's size, grown with the window: about 22 px at 1440x900.
  const unit = 0.75 * Math.max(cssWidth / 960, cssHeight / 900) * ratio * scale;
  const weight = Math.max(1.5 * scale, 2 * unit);
  return {
    unit,
    weight,
    thin: Math.max(1 * scale, 1.1 * unit),
    outline: style.highContrast ? Math.max(1.25 * ratio, 0.55 * weight) : 0,
  };
}

export class Crosshair {
  private readonly context: CanvasRenderingContext2D;
  private ratio = 1;
  private width = 0;
  private height = 0;
  private dirty: [number, number, number, number][] = [];
  private firedAt = Number.NEGATIVE_INFINITY;
  /** Shown at all: off while there is no aim to show (no map yet, paused). */
  visible = false;
  /** The game draws its own reticle for now (a scope's picture): HudSink.crosshair("none"). */
  hiddenByGame = false;
  /** The player's choice of size and contrast. */
  style: CrosshairStyle = { size: "standard", highContrast: false };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    this.context = canvas.getContext("2d", { alpha: true })!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    this.ratio = window.devicePixelRatio || 1;
    this.width = Math.round(this.canvas.clientWidth * this.ratio);
    this.height = Math.round(this.canvas.clientHeight * this.ratio);
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.dirty = [];
    }
  }

  clear(): void {
    for (const [x, y, w, h] of this.dirty) this.context.clearRect(x, y, w, h);
    this.dirty = [];
  }

  /**
   * Draws the frame at `now`: the lit target's ring (in CSS pixels of the
   * stage, if there is one to shoot), then the crosshair at `aim` over it.
   */
  draw(aim: Aim, now: number, target: { x: number; y: number; r: number } | null = null): void {
    this.clear();
    if (target && this.width) this.ring(target, now);
    if (aim.fired) this.firedAt = now;
    if (!this.visible || this.hiddenByGame || !aim.tracking || aim.offscreen || !this.width) return;
    const context = this.context;
    const { unit, weight, thin, outline } = crosshairMetrics(this.width / this.ratio, this.height / this.ratio, this.ratio, this.style);
    const x = Math.round(aim.x * this.width);
    const y = Math.round(aim.y * this.height);
    const radius = 20 * unit * (1 - 0.18 * Math.min(1, Math.max(0, aim.travel)));
    const reach = 30 * unit;
    // With reduced motion the ring does not kick out; the recoil itself stays.
    const kick = this.reducedMotion() ? 1 : (now - this.firedAt) / KICK;
    const extent = Math.ceil(Math.max(reach, kick < 1 ? (20 + 34 * kick) * unit : 0) + outline + 8 * this.ratio);
    this.dirty.push([x - extent, y - extent, extent * 2, extent * 2]);

    // Everything is drawn twice with the outline: once dark and wider
    // underneath, once in colour on top.
    const paint = (colour: string, grow: number) => {
      context.strokeStyle = context.fillStyle = colour;
      context.lineWidth = weight + grow * 2;
      for (const start of [10, 100, 190, 280]) {
        context.beginPath();
        context.arc(x, y, radius, (start * Math.PI) / 180, ((start + 70) * Math.PI) / 180);
        context.stroke();
      }
      context.beginPath();
      context.arc(x, y, Math.max(1.5, 2 * unit) + 0.5 + grow, 0, Math.PI * 2);
      context.fill();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        for (const [from, width] of [
          [9, thin],
          [25, weight],
        ] as const) {
          context.lineWidth = width + grow * 2;
          context.beginPath();
          context.moveTo(x + dx * from * unit, y + dy * from * unit);
          context.lineTo(x + dx * reach, y + dy * reach);
          context.stroke();
        }
      }
      if (kick < 1) {
        context.globalAlpha = 1 - kick;
        context.lineWidth = weight + grow * 2;
        context.beginPath();
        context.arc(x, y, (20 + 34 * kick) * unit, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha = 1;
      }
    };

    context.save();
    context.lineCap = "round";
    if (outline > 0) {
      paint("rgba(0, 0, 0, 0.88)", outline);
      paint(aim.armed ? TINT : "#fff", 0);
    } else {
      // A soft dark edge keeps it legible over most of the sky.
      context.shadowColor = "rgba(0, 0, 0, 0.45)";
      context.shadowBlur = 3 * this.ratio;
      paint(aim.armed ? TINT : "rgba(255, 255, 255, 0.72)", 0);
    }
    context.restore();
  }

  /** A soft white ring round the target to shoot, breathing gently. */
  private ring(target: { x: number; y: number; r: number }, now: number): void {
    const context = this.context;
    const ratio = this.ratio;
    const breath = this.reducedMotion() ? 1 : 1 + 0.07 * Math.sin(now / 320);
    const radius = Math.max(18, target.r * 1.45) * breath * ratio;
    const x = target.x * ratio;
    const y = target.y * ratio;
    const extent = Math.ceil(radius + 14 * ratio);
    this.dirty.push([x - extent, y - extent, extent * 2, extent * 2]);
    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.lineWidth = 2 * ratio;
    context.shadowColor = "rgba(255, 255, 255, 0.55)";
    context.shadowBlur = 10 * ratio;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}
