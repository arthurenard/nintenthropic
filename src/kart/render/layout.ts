/**
 * Where each player's viewport goes on the canvas (split screen).
 *
 * One kart takes the whole canvas. Two split the long way round: top and
 * bottom on a wide screen (each view stays wide, which suits a road ahead),
 * side by side on a tall one. Three and four are quadrants in reading order;
 * with three the fourth quadrant is left free, and the HUD puts the map and
 * the standings there instead of a view.
 *
 * Rects are in CSS pixels from the top-left, which is how both the HTML HUD
 * and (after the pixel ratio) the scissored WebGL viewports are placed.
 * A thin gap between views shows the canvas's dark clear colour as a divider.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewLayout {
  /** One rect per view, in reading order. */
  views: Rect[];
  /** The unused quadrant when three views are shown, else null. */
  free: Rect | null;
}

/** The divider between views, CSS px. */
export const VIEW_GAP = 3;

export function layoutViews(count: number, width: number, height: number, gap = VIEW_GAP): ViewLayout {
  const n = Math.max(0, Math.min(4, Math.floor(count)));
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  if (n === 0) return { views: [], free: null };
  if (n === 1) return { views: [{ x: 0, y: 0, w: W, h: H }], free: null };

  if (n === 2) {
    if (W >= H) {
      const top = Math.floor((H - gap) / 2);
      return {
        views: [
          { x: 0, y: 0, w: W, h: top },
          { x: 0, y: top + gap, w: W, h: H - gap - top },
        ],
        free: null,
      };
    }
    const left = Math.floor((W - gap) / 2);
    return {
      views: [
        { x: 0, y: 0, w: left, h: H },
        { x: left + gap, y: 0, w: W - gap - left, h: H },
      ],
      free: null,
    };
  }

  const left = Math.floor((W - gap) / 2);
  const right = W - gap - left;
  const top = Math.floor((H - gap) / 2);
  const bottom = H - gap - top;
  const quadrants: Rect[] = [
    { x: 0, y: 0, w: left, h: top },
    { x: left + gap, y: 0, w: right, h: top },
    { x: 0, y: top + gap, w: left, h: bottom },
    { x: left + gap, y: top + gap, w: right, h: bottom },
  ];
  if (n === 3) return { views: quadrants.slice(0, 3), free: quadrants[3]! };
  return { views: quadrants, free: null };
}

/**
 * A size the HUD scales by: 1 at a 900 px tall view (the design's reference),
 * shrinking for small quadrants but never below what stays legible, and
 * following the width too so a very wide, short strip does not get giant type.
 */
export function hudScale(w: number, h: number): number {
  const byHeight = h / 900;
  const byWidth = w / 1400;
  return Math.max(0.5, Math.min(1.5, Math.min(byHeight * 1.05, byWidth * 1.35)));
}

// ─── The map, in every layout ────────────────────────────────────────────────

/**
 * Where the map sits for a layout. One view: bottom left, as ever. Two, top
 * and bottom: on the right edge, centred on the split (side by side: in the
 * middle of the screen). Three: the free quadrant, which also holds the
 * standings. Four: small in the middle, where the quadrants meet, with a
 * compact standings strip beside it where the quadrants are wide enough.
 */
export type MapMode = "corner" | "edge" | "centre" | "free";

export interface MapPlacement {
  mode: MapMode;
  /** The map's glass box on the canvas, CSS px (for "free", the whole free quadrant). */
  rect: Rect;
  /** The type and line scale inside the box (the free quadrant sets its own). */
  scale: number;
  /** The map drawing's CSS size inside the box (null for "free", which measures its own). */
  canvas: { w: number; h: number } | null;
  /** A compact standings strip beside the map, inside the box (4 views; the free quadrant has a full list). */
  strip: { w: number } | null;
}

/** The glass box's padding and border, and the strip's row height, all at scale 1. */
export const MAP_PAD = 8;
const MAP_BORDER = 2;
export const STRIP_ROW = 22;
const STRIP_W = 156;
export const STRIP_GAP = 14;

/** The map drawing's size at `scale` for a track `aspect` (width over height) wide. */
export function mapCanvasSize(scale: number, aspect: number): { w: number; h: number } {
  const w = Math.round(190 * scale);
  const h = Math.max(Math.round(70 * scale), Math.min(Math.round(170 * scale), Math.round(w / Math.max(0.2, aspect))));
  return { w, h };
}

/** `rows` is how many karts the strip may have to list (a race has up to eight). */
export function mapPlacement(layout: ViewLayout, aspect = 1.5, rows = 8): MapPlacement | null {
  const all = layout.free ? [...layout.views, layout.free] : layout.views;
  const n = layout.views.length;
  if (n === 0) return null;
  if (layout.free) return { mode: "free", rect: layout.free, scale: 1, canvas: null, strip: null };
  const W = Math.max(...all.map((r) => r.x + r.w));
  const H = Math.max(...all.map((r) => r.y + r.h));
  const full = hudScale(W, H);

  if (n === 1) {
    const canvas = mapCanvasSize(full, aspect);
    const w = canvas.w + MAP_PAD * 2 * full + MAP_BORDER;
    const h = canvas.h + MAP_PAD * 2 * full + MAP_BORDER;
    const m = 24 * full;
    return { mode: "corner", rect: { x: m, y: H - m - h, w, h }, scale: full, canvas, strip: null };
  }

  // The box grows with its scale, so find the scale it fits the screen at, then size it.
  const sizeAt = (s: number, withStrip: boolean) => {
    const canvas = mapCanvasSize(s, aspect);
    const strip = withStrip ? { w: Math.round(STRIP_W * s) } : null;
    const w = canvas.w + MAP_PAD * 2 * s + MAP_BORDER + (strip ? strip.w + STRIP_GAP * s : 0);
    const h = Math.max(canvas.h, withStrip ? rows * STRIP_ROW * s : 0) + MAP_PAD * 2 * s + MAP_BORDER;
    return { canvas, strip, w, h };
  };
  let scale = Math.max(0.6, Math.min(1.35, full * 0.85));
  // With four, a standings strip beside the map, where the quadrants are wide enough to spare it: four players side by
  // side on a phone held upright have quadrants so narrow that map and strip would cover half of each, lap panel and all.
  const narrowest = Math.min(...layout.views.map((r) => r.w));
  const withStrip = n >= 4 && sizeAt(scale, true).w <= narrowest * 0.8;
  const probe = sizeAt(scale, withStrip);
  scale = Math.max(0.3, scale * Math.min(1, (W * 0.5) / probe.w, (H * 0.45) / probe.h));
  const { canvas, strip, w, h } = sizeAt(scale, withStrip);

  const a = layout.views[0]!;
  const b = layout.views[1]!;
  if (n === 2 && b.y > a.y) {
    // Stacked: the right edge, centred on the split.
    const splitY = a.y + a.h + (b.y - (a.y + a.h)) / 2;
    return { mode: "edge", rect: { x: W - 12 * scale - w, y: splitY - h / 2, w, h }, scale, canvas, strip };
  }
  // Side by side, or four: the middle, where the dividers cross.
  const cx = a.x + a.w + (b.x - (a.x + a.w)) / 2;
  const cy = n === 2 ? H / 2 : a.y + a.h + (layout.views[2]!.y - (a.y + a.h)) / 2;
  return { mode: "centre", rect: { x: cx - w / 2, y: cy - h / 2, w, h }, scale, canvas, strip };
}

/**
 * How far to nudge a view's corner furniture clear of a map that overlaps it:
 * the place (bottom right) moves left by `place`, the lap panel (top left)
 * right by `lap`, or, in a view too narrow for the map, the panel and the item
 * slot side by side along its top, down by `lapDown`; all px. `u` is the view's
 * HUD scale.
 */
export function clearance(view: Rect, card: Rect, u: number): { place: number; lap: number; lapDown: number } {
  const hits = (band: Rect) => card.x < band.x + band.w && band.x < card.x + card.w && card.y < band.y + band.h && band.y < card.y + card.h;
  const gap = 10 * u;
  const placeBand: Rect = { x: view.x + view.w - 160 * u, y: view.y + view.h - 130 * u, w: 160 * u, h: 130 * u };
  const lapBand: Rect = { x: view.x, y: view.y, w: 200 * u, h: 110 * u };
  const place = hits(placeBand) ? Math.max(0, view.x + view.w - card.x + gap) : 0;
  const lap = hits(lapBand) ? Math.max(0, card.x + card.w - view.x + gap) : 0;
  // Margin, nudge, the panel (146 units), a gap and the slot (76), and the margin again (hud.css's --item-x).
  if (lap > 0 && lap + (24 + 146 + 8 + 76 + 24) * u > view.w) return { place, lap: 0, lapDown: Math.max(0, card.y + card.h - view.y + gap) };
  return { place, lap, lapDown: 0 };
}
