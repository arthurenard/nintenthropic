/**
 * A game's backdrop (GameEntry.backdrop): its light, drawn where its poster
 * would be until the poster loads, or for good while there is none. The
 * same picture two ways - as a CSS background for the page, and on a 2D
 * canvas for the shared results card - so both look alike.
 */
import type { Backdrop } from "../engine/types";

/** A dusk that belongs to no game in particular, for a game that names no light of its own. */
export const NEUTRAL_BACKDROP: Backdrop = {
  sky: [
    ["#15171d", 0],
    ["#23262f", 0.6],
    ["#1a1b20", 1],
  ],
  glow: { x: 0.5, y: 1.1, width: 1.1, height: 0.7, stops: [["rgba(120, 128, 150, 0.35)", 0], ["rgba(120, 128, 150, 0)", 0.7]] },
};

const percent = (n: number) => `${+(n * 100).toFixed(2)}%`;
const stops = (list: Backdrop["sky"]) => list.map(([colour, at]) => `${colour} ${percent(at)}`).join(", ");

/** The backdrop as a CSS `background` value. */
export function backdropCss(backdrop: Backdrop = NEUTRAL_BACKDROP): string {
  const sky = `linear-gradient(180deg, ${stops(backdrop.sky)})`;
  const g = backdrop.glow;
  if (!g) return sky;
  return `radial-gradient(${percent(g.width)} ${percent(g.height)} at ${percent(g.x)} ${percent(g.y)}, ${stops(g.stops)}), ${sky}`;
}

/** The backdrop painted into a rectangle of a 2D canvas. */
export function paintBackdrop(context: CanvasRenderingContext2D, backdrop: Backdrop = NEUTRAL_BACKDROP, x = 0, y = 0, width = context.canvas.width, height = context.canvas.height): void {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  const sky = context.createLinearGradient(0, y, 0, y + height);
  for (const [colour, at] of backdrop.sky) sky.addColorStop(at, colour);
  context.fillStyle = sky;
  context.fillRect(x, y, width, height);
  const g = backdrop.glow;
  if (g) {
    // An ellipse is a circle of the width's radius, squashed to the height's.
    const rx = g.width * width;
    const ry = g.height * height;
    const k = rx / ry;
    context.translate(x + g.x * width, y + g.y * height);
    context.scale(1, 1 / k);
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (const [colour, at] of g.stops) glow.addColorStop(Math.min(1, at), colour);
    context.fillStyle = glow;
    // The whole rectangle, in the squashed space.
    context.fillRect(-g.x * width, -g.y * height * k, width, height * k);
  }
  context.restore();
}
