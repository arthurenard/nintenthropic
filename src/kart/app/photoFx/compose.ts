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

/** One filter function: its name and number (degrees for hue-rotate). */
export function parseFilter(filter: string): { name: string; value: number }[] {
  const out: { name: string; value: number }[] = [];
  for (const m of filter.matchAll(/([a-z-]+)\(([-\d.]+)(deg)?\)/g)) out.push({ name: m[1]!, value: Number(m[2]) });
  return out;
}

/** Grades RGBA pixels in place as the CSS filter would (saturate, brightness, contrast, sepia, hue-rotate): for browsers whose canvas has no filter. */
export function gradePixels(data: Uint8ClampedArray, filter: string): void {
  const steps = parseFilter(filter);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]! / 255;
    let g = data[i + 1]! / 255;
    let b = data[i + 2]! / 255;
    for (const { name, value } of steps) {
      if (name === "saturate") {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * value;
        g = l + (g - l) * value;
        b = l + (b - l) * value;
      } else if (name === "brightness") {
        r *= value;
        g *= value;
        b *= value;
      } else if (name === "contrast") {
        r = (r - 0.5) * value + 0.5;
        g = (g - 0.5) * value + 0.5;
        b = (b - 0.5) * value + 0.5;
      } else if (name === "sepia") {
        const k = Math.min(1, value);
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r += (sr - r) * k;
        g += (sg - g) * k;
        b += (sb - b) * k;
      } else if (name === "hue-rotate") {
        const a = (value * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const nr = r * (0.213 + cos * 0.787 - sin * 0.213) + g * (0.715 - cos * 0.715 - sin * 0.715) + b * (0.072 - cos * 0.072 + sin * 0.928);
        const ng = r * (0.213 - cos * 0.213 + sin * 0.143) + g * (0.715 + cos * 0.285 + sin * 0.14) + b * (0.072 - cos * 0.072 - sin * 0.283);
        const nb = r * (0.213 - cos * 0.213 - sin * 0.787) + g * (0.715 - cos * 0.715 + sin * 0.715) + b * (0.072 + cos * 0.928 + sin * 0.072);
        r = nr;
        g = ng;
        b = nb;
      }
      r = Math.min(1, Math.max(0, r));
      g = Math.min(1, Math.max(0, g));
      b = Math.min(1, Math.max(0, b));
    }
    data[i] = r * 255;
    data[i + 1] = g * 255;
    data[i + 2] = b * 255;
  }
}

const gradedCache = new WeakMap<object, { key: string; canvas: HTMLCanvasElement }>();

/** The picture graded by pixels at about its drawn size, kept for the next frame (a clip draws the same card 120 times). */
function gradedCopy(image: CanvasImageSource, w: number, h: number, filter: string): CanvasImageSource {
  const key = `${Math.round(w)}x${Math.round(h)}|${filter}`;
  const hit = gradedCache.get(image);
  if (hit && hit.key === key) return hit.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const g = canvas.getContext("2d");
  if (!g) return image;
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    gradePixels(pixels.data, filter);
    g.putImageData(pixels, 0, 0);
  } catch {
    // a tainted picture: shared ungraded
  }
  gradedCache.set(image, { key, canvas });
  return canvas;
}

/** The photo (or any picture) filling x, y, w, h with the track's colour filter, soft-light wash and vignette. */
export function paintGraded(c: Ctx, image: CanvasImageSource, x: number, y: number, w: number, h: number, look: Look): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  if (canFilter(c)) {
    c.filter = look.filter;
    c.drawImage(image, x, y, w, h);
    c.filter = "none";
  } else {
    c.drawImage(gradedCopy(image, w, h, look.filter), x, y, w, h);
  }
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
