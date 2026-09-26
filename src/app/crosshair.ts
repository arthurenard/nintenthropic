/**
 * The crosshair: drawn by the page on a 2D canvas over the world, at the
 * device's full resolution, at the latest aim - so it is always crisp, never
 * waits for the 3D frame, and moves the moment the hand does. It copies the
 * desktop's: a ring broken at the compass points, ticks through the gaps and
 * a dot, green while the gun is cocked; the ring tightens as the thumb folds
 * and kicks out on each shot.
 *
 * In the aim check the same canvas rings the target to shoot, softly
 * breathing, so it is plain which one is lit however the game lights it.
 */
import type { Aim } from "../engine/types";

const TINT = "#30d158";
/** How long the ring's kick lasts, ms (the desktop's RECOIL). */
const KICK = 180;

export class Crosshair {
  private readonly context: CanvasRenderingContext2D;
  private ratio = 1;
  private width = 0;
  private height = 0;
  private dirty: [number, number, number, number][] = [];
  private firedAt = Number.NEGATIVE_INFINITY;
  /** Shown at all: off while there is no aim to show (no map yet, paused). */
  visible = false;

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
    if (!this.visible || !aim.tracking || aim.offscreen || !this.width) return;
    const context = this.context;
    const cssWidth = this.width / this.ratio;
    const cssHeight = this.height / this.ratio;
    // The desktop's size, grown with the window: about 22 px at 1440x900.
    const unit = 0.75 * Math.max(cssWidth / 960, cssHeight / 900) * this.ratio;
    const x = Math.round(aim.x * this.width);
    const y = Math.round(aim.y * this.height);
    const weight = Math.max(1.5, 2 * unit);
    const thin = Math.max(1, 1.1 * unit);
    const radius = 20 * unit * (1 - 0.18 * Math.min(1, Math.max(0, aim.travel)));
    const reach = 30 * unit;
    // With reduced motion the ring does not kick out; the recoil itself stays.
    const kick = this.reducedMotion() ? 1 : (now - this.firedAt) / KICK;
    const extent = Math.ceil(Math.max(reach, kick < 1 ? (20 + 34 * kick) * unit : 0) + 8 * this.ratio);
    this.dirty.push([x - extent, y - extent, extent * 2, extent * 2]);

    const colour = aim.armed ? TINT : "rgba(255, 255, 255, 0.72)";
    context.save();
    context.strokeStyle = context.fillStyle = colour;
    context.lineCap = "round";
    // A soft dark edge keeps it legible over the brightest sky.
    context.shadowColor = "rgba(0, 0, 0, 0.45)";
    context.shadowBlur = 3 * this.ratio;
    context.lineWidth = weight;
    for (const start of [10, 100, 190, 280]) {
      context.beginPath();
      context.arc(x, y, radius, (start * Math.PI) / 180, ((start + 70) * Math.PI) / 180);
      context.stroke();
    }
    context.beginPath();
    context.arc(x, y, Math.max(1.5, 2 * unit) + 0.5, 0, Math.PI * 2);
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
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(x + dx * from * unit, y + dy * from * unit);
        context.lineTo(x + dx * reach, y + dy * reach);
        context.stroke();
      }
    }
    if (kick < 1) {
      context.globalAlpha = 1 - kick;
      context.lineWidth = weight;
      context.beginPath();
      context.arc(x, y, (20 + 34 * kick) * unit, 0, Math.PI * 2);
      context.stroke();
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
