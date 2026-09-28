/**
 * How the player's eye frames a world seen from one fixed point.
 *
 * A world's own camera is the art's composition: High Noon's `camera.player`
 * (45° tall) shows the whole street with room for the aim check's bottles in
 * its corners. It is the right picture for the warm-up, but in the fight it
 * leaves a man at 30 m sixty pixels tall at 1440 × 900 and the lower third of
 * the screen to empty dirt. So the game plays through a tighter lens: from
 * the same eye (a world baked with projection UVs from exactly there can be
 * turned and zoomed safely, never moved), the narrowest field of view and the
 * slight pitch that still show every place the fight happens ("sights"),
 * clear of the page's corner chrome, at whatever shape the window is.
 *
 * Pure math, in the art camera's space (x right, y up, looking down −z), so
 * it can be tested without a renderer.
 */

export interface Framing {
  /** Vertical field of view, degrees. */
  fov: number;
  /** Radians up from the town camera's own pitch. */
  pitch: number;
}

/** A point the view must show. */
export interface Sight {
  x: number;
  y: number;
  z: number;
  /**
   * A head or a chest (something to shoot at): it must also stay out from
   * under the page's chrome. A knee or a secret only has to be on screen.
   */
  clear: boolean;
  /** How far inside the edges it must stay, if not the fit's own margins. */
  margin?: number;
}

/** Part of the viewport (fractions, 0,0 top-left) the page covers with chrome. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FitOptions {
  /** The narrowest and widest vertical fields of view to consider, degrees. */
  minFov: number;
  maxFov: number;
  /** How far the pitch may turn up (or down), radians. */
  minPitch: number;
  maxPitch: number;
  /** The pitch that composes best (the street's horizon a little below the middle), radians. */
  preferPitch: number;
  /** Degrees of field of view added to the tightest fit, so nothing sits right on an edge. */
  slack: number;
  /** Every point stays this far inside the edges (fractions of the width / height). */
  marginX: number;
  marginY: number;
  /** Where the page's chrome sits; `clear` points keep out of these. */
  keepOut: readonly Rect[];
}

const RAD = Math.PI / 180;

/** Where `p` lands in the viewport (fractions, 0,0 top-left), or null behind the eye. */
export function projectSight(p: Sight, f: Framing, aspect: number): { x: number; y: number } | null {
  // Turn the point by −pitch about x: into the pitched camera's space.
  const c = Math.cos(f.pitch);
  const s = Math.sin(f.pitch);
  const y = p.y * c + p.z * s;
  const z = -p.y * s + p.z * c;
  if (z > -1e-3) return null;
  const ty = Math.tan((f.fov * RAD) / 2);
  const tx = ty * aspect;
  return { x: 0.5 + (0.5 * p.x) / (-z * tx), y: 0.5 - (0.5 * y) / (-z * ty) };
}

function inside(v: { x: number; y: number }, r: Rect): boolean {
  return v.x > r.x0 && v.x < r.x1 && v.y > r.y0 && v.y < r.y1;
}

/** Does this framing show every point, the targets clear of the chrome? */
export function framingFits(points: readonly Sight[], f: Framing, aspect: number, o: Pick<FitOptions, "marginX" | "marginY" | "keepOut">): boolean {
  for (const p of points) {
    const v = projectSight(p, f, aspect);
    if (!v) return false;
    const mx = p.margin ?? o.marginX;
    const my = p.margin ?? o.marginY;
    if (v.x < mx || v.x > 1 - mx || v.y < my || v.y > 1 - my) return false;
    if (p.clear) for (const r of o.keepOut) if (inside(v, r)) return false;
  }
  return true;
}

/** Of the pitches in range that fit at this field of view, the one nearest `prefer`; null if none. */
function bestPitch(points: readonly Sight[], fov: number, aspect: number, o: FitOptions): number | null {
  const step = 0.1 * RAD;
  let best: number | null = null;
  for (let pitch = o.minPitch; pitch <= o.maxPitch + 1e-9; pitch += step) {
    if (!framingFits(points, { fov, pitch }, aspect, o)) continue;
    if (best === null || Math.abs(pitch - o.preferPitch) < Math.abs(best - o.preferPitch)) best = pitch;
  }
  return best;
}

/**
 * The tightest framing that shows every point: the smallest field of view for
 * which a pitch in range fits, opened by `slack` so nothing sits on an edge,
 * and of the pitches that then fit, the one nearest the preferred. Falls back
 * to the widest field of view when nothing fits.
 */
export function fitFraming(points: readonly Sight[], aspect: number, o: FitOptions): Framing {
  for (let fov = o.minFov; fov <= o.maxFov + 1e-9; fov += 0.25) {
    const tight = bestPitch(points, fov, aspect, o);
    if (tight === null) continue;
    const eased = Math.min(o.maxFov, fov + o.slack);
    const roomy = bestPitch(points, eased, aspect, o);
    return roomy === null ? { fov, pitch: tight } : { fov: eased, pitch: roomy };
  }
  return { fov: o.maxFov, pitch: Math.min(o.maxPitch, Math.max(o.minPitch, 0)) };
}

/**
 * The warm-up's framing: the art's own camera, widened only when the window
 * is narrower than 4:3, so the targets at its sides (High Noon's bottles)
 * never leave the screen.
 */
export function checkFraming(artFov: number, aspect: number): Framing {
  const narrowest = 4 / 3;
  if (aspect >= narrowest) return { fov: artFov, pitch: 0 };
  const tan = (Math.tan((artFov * RAD) / 2) * narrowest) / Math.max(0.2, aspect);
  return { fov: (2 * Math.atan(tan)) / RAD, pitch: 0 };
}

/** A panel's size in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

export interface ChromeOptions {
  /** The score panel with the game's readouts: High Noon's three (wave, gang, streak) make about 168 × 154. */
  panel?: Size;
  /** The weapon's dock in the bottom-right corner (see WEAPON_DOCK): the revolver's cylinder is 96 × 96. */
  dock?: Size;
}

/**
 * The weapon dock's size for each way of showing the ammunition
 * (HudSink.ammo's style, HudSink.heat), as src/app/play.css lays them out on
 * a stage taller than 520 px.
 */
export const WEAPON_DOCK: Readonly<Record<"cylinder" | "magazine" | "heat", Size>> = {
  cylinder: { width: 96, height: 96 },
  magazine: { width: 96, height: 96 },
  heat: { width: 96, height: 96 },
};

/**
 * Where the page's chrome sits in play, in CSS pixels, as src/app/play.css
 * lays it out: the score panel top left, Pause top right, the weapon's dock
 * bottom right, the camera's picture-in-picture bottom left (with the hand
 * only), and the hint pill along the bottom. A little is added round each,
 * so a hat brim does not tuck under a panel's edge either.
 */
export function chromeKeepOut(width: number, height: number, hand: boolean, options: ChromeOptions = {}): Rect[] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const hud = Math.min(32, Math.max(16, 0.022 * w));
  const pad = 10;
  const panel = options.panel ?? { width: 168, height: 154 };
  const dock = options.dock ?? WEAPON_DOCK.cylinder;
  const px = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h });
  const rects: Rect[] = [
    // The score and the game's readouts.
    px(0, 0, hud + panel.width + pad, hud + panel.height + pad),
    // Pause.
    px(w - hud - 48 - pad, 0, w, hud + 48 + pad),
    // The weapon's dock.
    px(w - hud - dock.width - pad, h - hud - dock.height - pad, w, h),
    // The hint, across the bottom middle.
    px(w / 2 - 290, h - hud - 44 - pad, w / 2 + 290, h),
  ];
  if (hand) {
    const pip = Math.min(176, Math.max(120, 0.12 * w));
    rects.push(px(0, h - hud - pip * 0.75 - pad, hud + pip + pad, h));
  }
  return rects;
}
