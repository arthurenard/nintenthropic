/**
 * A graded photo with its effects, stamp and frame drawn on one canvas: what the shared picture and the clip put on each
 * card, as the results' cards show them on the page (CSS filter, a soft-light wash, a vignette and the stamp there; here
 * the same in canvas calls). The page's version is photoFx/player.ts.
 */
import { drawFx } from "./effects";
import { flourishFor, type Look } from "./looks";

type Ctx = CanvasRenderingContext2D;

/** What the stamp on a card says: the track, and the place, as "Meadow Loop · 1st". */
export function stampText(look: Look, placeLabel: string): string {
  return `${look.name} · ${placeLabel}`;
}

/** The filter to draw with: Safari's canvas has none, and a photo ungraded is better than none. */
function canFilter(c: Ctx): boolean {
  return "filter" in c;
}

/** The photo (or any picture) filling x, y, w, h with the track's colour filter, soft-light wash and vignette. */
export function paintGraded(c: Ctx, image: CanvasImageSource, x: number, y: number, w: number, h: number, look: Look): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  if (canFilter(c)) c.filter = look.filter;
  c.drawImage(image, x, y, w, h);
  c.filter = "none";
  const [top, foot, strength] = look.tint;
  const wash = c.createLinearGradient(0, y, 0, y + h);
  wash.addColorStop(0, top);
  wash.addColorStop(1, foot);
  c.globalCompositeOperation = "soft-light";
  c.globalAlpha = strength;
  c.fillStyle = wash;
  c.fillRect(x, y, w, h);
  if (look.night > 0) {
    const dusk = c.createLinearGradient(0, y, 0, y + h * 0.75);
    dusk.addColorStop(0, `rgba(4,8,30,${look.night})`);
    dusk.addColorStop(1, "rgba(4,8,30,0)");
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = dusk;
    c.fillRect(x, y, w, h);
  }
  c.restore();
  paintVignette(c, x, y, w, h, look.vignette);
}

/** The corners darkened. */
export function paintVignette(c: Ctx, x: number, y: number, w: number, h: number, strength: number): void {
  const reach = Math.hypot(w, h) / 2;
  const shade = c.createRadialGradient(x + w / 2, y + h / 2, reach * 0.55, x + w / 2, y + h / 2, reach);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, `rgba(0,0,0,${strength})`);
  c.save();
  c.fillStyle = shade;
  c.fillRect(x, y, w, h);
  c.restore();
}

/** The little stamp at the top right of a card, and the thin frame inside its edge. */
export function paintStamp(c: Ctx, x: number, y: number, w: number, h: number, look: Look, placeLabel: string, font: string): void {
  const size = Math.max(9, Math.min(13, h * 0.055));
  c.save();
  c.strokeStyle = "rgba(255,255,255,0.26)";
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(x + 6.5, y + 6.5, w - 13, h - 13, Math.min(18, h * 0.08));
  c.stroke();
  if (w >= 150) {
    c.font = `700 ${size}px ${font}`;
    c.letterSpacing = `${size * 0.09}px`;
    const words = stampText(look, placeLabel).toUpperCase();
    const textW = c.measureText(words).width;
    const padX = size * 0.8;
    const pillH = size * 1.9;
    const px = x + w - 14 - (textW + padX * 2 + size);
    const py = y + 14;
    c.fillStyle = "rgba(6, 12, 30, 0.55)";
    c.beginPath();
    c.roundRect(px, py, textW + padX * 2 + size, pillH, pillH / 2);
    c.fill();
    c.fillStyle = look.accent;
    c.beginPath();
    c.arc(px + padX + size * 0.2, py + pillH / 2, size * 0.28, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#fff";
    c.textBaseline = "middle";
    c.fillText(words, px + padX + size * 0.8, py + pillH / 2 + 0.5);
    c.letterSpacing = "0px";
  }
  c.restore();
}

/** The effects over a card at x, y, w, h at time `t`, clipped to the card. */
export function paintFx(c: Ctx, x: number, y: number, w: number, h: number, t: number, look: Look, place: number, field: number): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.translate(x, y);
  drawFx(c, w, h, t, look, flourishFor(place, field), place, false);
  c.restore();
}
