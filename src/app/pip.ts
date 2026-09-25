/**
 * The camera preview: a small rounded picture-in-picture, like FaceTime's,
 * mirrored so it moves the way the player does, with their hand drawn over it
 * in white - soft round joints, not debug colours. It is larger during the
 * aim check, where seeing your hand matters, and small in play.
 */
import type { HandFrame } from "../tracking/types";
import { $ } from "../ui/dom";

/** MediaPipe's hand topology: which of the 21 points join. */
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const TIPS = new Set([4, 8, 12, 16, 20]);

export class Pip {
  private readonly box = $("pip");
  private readonly video = $<HTMLVideoElement>("camera");
  private readonly canvas = $<HTMLCanvasElement>("hand-graph");
  private readonly context = this.canvas.getContext("2d")!;
  private lostSince: number | null = null;

  /** Shows the preview: with the camera's picture, or the hand alone (a scripted hand). */
  show(withPicture: boolean): void {
    this.box.hidden = false;
    this.video.hidden = !withPicture;
    this.lostSince = null;
    this.box.classList.remove("lost");
  }

  hide(): void {
    this.box.hidden = true;
    this.clear();
  }

  clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Draws the hand from one camera frame, and marks a hand lost for a moment. */
  draw(frame: HandFrame, now: number): void {
    if (this.box.hidden) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.canvas.clientWidth * ratio);
    const height = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.context;
    context.clearRect(0, 0, width, height);
    // A hand gone for a third of a second, not a dropped frame, rings red.
    if (!frame.landmarks) this.lostSince ??= now;
    else this.lostSince = null;
    this.box.classList.toggle("lost", this.lostSince !== null && now - this.lostSince > 300);
    const points = frame.landmarks;
    if (!points || !width) return;
    // Where the picture sits in the box: object-fit: cover, mirrored.
    const vw = this.video.videoWidth || 4;
    const vh = this.video.videoHeight || 3;
    const scale = Math.max(width / vw, height / vh);
    const left = (width - vw * scale) / 2;
    const top = (height - vh * scale) / 2;
    const at = (i: number): [number, number] => {
      const p = points[i]!;
      return [left + (1 - p.x) * vw * scale, top + p.y * vh * scale];
    };
    const unit = Math.max(1, width / 240) * 0.9;
    context.strokeStyle = "rgba(255, 255, 255, 0.82)";
    context.lineWidth = 2 * unit;
    context.lineCap = "round";
    context.shadowColor = "rgba(0, 0, 0, 0.45)";
    context.shadowBlur = 4 * unit;
    context.beginPath();
    for (const [a, b] of BONES) {
      const [ax, ay] = at(a);
      const [bx, by] = at(b);
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
    }
    context.stroke();
    context.fillStyle = "#fff";
    for (let i = 0; i < points.length; i++) {
      const [x, y] = at(i);
      context.beginPath();
      context.arc(x, y, (TIPS.has(i) ? 3.4 : 2.6) * unit, 0, Math.PI * 2);
      context.fill();
    }
    context.shadowBlur = 0;
  }
}
