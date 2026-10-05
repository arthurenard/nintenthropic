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
