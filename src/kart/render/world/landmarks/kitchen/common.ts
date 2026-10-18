/**
 * What the kitchen's models share: the palette (china and cobalt, steel, wood
 * and fruit, all lifted because the golden light dims whatever faces the road),
 * the brushed-steel shade, a Bezier curve for spouts and handles, and the
 * plaque, a thin patch laid on a ball's skin for a painted mark or a shine.
 */
import type { Paint } from "../../builder";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb, type Shade, type V3 } from "../kit";

export const TAU = Math.PI * 2;

// ─── Palette ─────────────────────────────────────────────────────────────────

// China is cream with cobalt; steel runs from a dim foot to a near-white top.
/** The kitchen's golden light warms and dims whatever faces the road, so the palette is lifted and a little cooler than it looks. */
export const lift = (hex: string, k = 1.3): Rgb => scaleRgb(rgb(hex), k);
export const CHINA: Rgb = [1.05, 1.22, 1.6];
export const BLUE = lift("#2b73e0", 1.55);
export const BLUE_PALE = lift("#5b9cf0", 1.45);
export const GOLD = lift("#ffcf4a", 1.2);
export const STEEL_D: Rgb = [0.3, 0.4, 0.62];
export const STEEL: Rgb = [0.72, 1.0, 1.7];
export const STEEL_L: Rgb = [1.15, 1.55, 2.5];
export const WALNUT = lift("#44281a", 1.15);
export const WOOD_L = lift("#8a5c38", 1.2);
export const WHITE: Rgb = [1.05, 1.22, 1.6];

// Fruit, warm and saturated.
export const ORANGE = lift("#ff8a1c", 1.35);
export const APPLE = lift("#d62b2b", 1.3);
export const PEAR = lift("#a9c93a", 1.25);
export const LEMON = lift("#ffe03a", 1.2);
export const LEAF = lift("#3f9a3a", 1.3);
export const STALK = lift("#6b4524", 1.3);

// ─── Shapes ──────────────────────────────────────────────────────────────────

/** Brushed steel for a lathe or a tube: dim at y0, bright at y1, with each facet a touch different. */
export function chrome(y0: number, y1: number, glint = 0.07): Shade {
  return (p, _i, j) => {
    const t = Math.max(0, Math.min(1, (p[1] - y0) / (y1 - y0 || 1)));
    const k = 1 + (j % 3 === 0 ? glint : j % 3 === 1 ? -glint : 0);
    return scaleRgb(mixRgb(STEEL_D, STEEL_L, t), k);
  };
}

/** A cubic Bezier through four control points, `n` pieces. */
export function bezier(a: V3, b: V3, c: V3, d: V3, n: number): V3[] {
  const out: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push([a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3, a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3]);
  }
  return out;
}

/** A thin ellipsoid lying on a ball's skin: ball centre, ball radius, outward direction, width, height, thickness. */
export function plaque(b: MeshBuilder, c: V3, r: number, d: V3, w: number, h: number, t: number, paint: Paint, roll = 0): void {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const n: V3 = [d[0] / l, d[1] / l, d[2] / l];
  b.add(shapes.ball(0), xf(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, w, h, t, Math.atan2(n[0], n[2]), -Math.asin(n[1]), roll), paint);
}
