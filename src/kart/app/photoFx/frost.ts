/**
 * Glacier Pass's frost: ice creeping in from the corners and the edges of the card as it does on a cold window, never across
 * the middle. A thin frosted haze hugs each edge, and out of it grow feathery ferns of ice (a stem with side branches
 * and twigs, shorter toward the tip) that creep a little further and back, translucent, with a cool shadow under the white
 * so they show on a bright picture too, and a few crystals that glint.
 */
import { clamp01, ph, rnd, smooth, star, TAU, type Ctx, type Scene } from "./fxKit";

interface Stem {
  x: number;
  y: number;
  /** The way it grows, radians. */
  a: number;
  /** How long it grows to, in units. */
  len: number;
  /** Where in its life it starts to grow (0..1 of the creep), so they do not all move as one. */
  late: number;
}

/** The stems: along each edge, and the longest from the corners, growing inward. Fixed by the card's size. */
const stemCache = new Map<string, Stem[]>();
function stems(s: Scene): Stem[] {
  const key = `${s.w}x${s.h}x${s.u}`;
  const hit = stemCache.get(key);
  if (hit) return hit;
  if (stemCache.size > 12) stemCache.clear();
  const made = buildStems(s);
  stemCache.set(key, made);
  return made;
}
function buildStems(s: Scene): Stem[] {
  const out: Stem[] = [];
  const edge = (n: number, salt: number, place: (f: number) => [number, number, number], len: number) => {
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5 + (rnd(i, salt) - 0.5) * 0.6) / n;
      const [x, y, a] = place(f);
      out.push({ x, y, a: a + (rnd(i, salt + 1) - 0.5) * 0.7, len: s.u * len * (0.55 + 0.6 * rnd(i, salt + 2)), late: rnd(i, salt + 3) * 0.4 });
    }
  };
  const along = s.w > s.h ? 7 : 5;
  const up = s.w > s.h ? 4 : 6;
  edge(along, 1, (f) => [s.w * f, 0, Math.PI / 2], 0.2);
  edge(along - 2, 2, (f) => [s.w * f, s.h, -Math.PI / 2], 0.11);
  edge(up, 3, (f) => [0, s.h * f, 0], 0.2);
  edge(up, 4, (f) => [s.w, s.h * f, Math.PI], 0.2);
  // The corners grow longest, three each, fanned across the diagonal.
  const corners: [number, number, number][] = [
    [0, 0, Math.PI / 4],
    [s.w, 0, (3 * Math.PI) / 4],
    [0, s.h, -Math.PI / 4],
    [s.w, s.h, (-3 * Math.PI) / 4],
  ];
  corners.forEach(([x, y, a], k) => {
    for (let i = 0; i < 3; i++) out.push({ x, y, a: a + (i - 1) * 0.42 + (rnd(k * 3 + i, 9) - 0.5) * 0.2, len: s.u * (0.27 + 0.07 * rnd(i, k + 20)), late: 0 });
  });
  return out;
}

/** One fern into the current path: `grow` (0..1) is how much of it has crept out. */
function fern(c: Ctx, st: Stem, grow: number): [number, number] {
  let x = st.x;
  let y = st.y;
  let a = st.a;
  const bend = (rnd(Math.round(st.x + st.y), 5) - 0.5) * 0.5;
  const segs = 6;
  c.moveTo(x, y);
  let tip: [number, number] = [x, y];
  // Fixed segments; the last one drawn grows by its fraction, so the fern creeps smoothly and nothing pops in.
  const reach = clamp01(grow) * segs;
  for (let i = 1; i <= Math.ceil(reach - 1e-6); i++) {
    const part = Math.min(1, reach - (i - 1));
    const step = (st.len / segs) * part;
    a += (bend / segs) * 2;
    const nx = x + Math.cos(a) * step;
    const ny = y + Math.sin(a) * step;
    c.lineTo(nx, ny);
    // Branches off the stem, each a little feather of its own: shorter toward the tip.
    const along = (i - 0.5) / segs;
    const room = 1 - along * 0.85;
    const bl = st.len * 0.38 * room * part;
    for (const side of [-1, 1]) {
      const ba = a + side * 0.95;
      const bx = x + Math.cos(a) * step * 0.55;
      const by = y + Math.sin(a) * step * 0.55;
      const ex = bx + Math.cos(ba) * bl;
      const ey = by + Math.sin(ba) * bl;
      c.moveTo(bx, by);
      c.lineTo(ex, ey);
      // Twigs, angled back toward the stem's tip.
      for (const t of [0.42, 0.74]) {
        const tx = bx + (ex - bx) * t;
        const ty = by + (ey - by) * t;
        const tl = bl * 0.36 * (1.1 - t * 0.5);
        for (const ts of [-1, 1]) {
          c.moveTo(tx, ty);
          c.lineTo(tx + Math.cos(ba + ts * 0.8 - side * 0.0) * tl, ty + Math.sin(ba + ts * 0.8) * tl);
        }
      }
    }
    x = nx;
    y = ny;
    c.moveTo(x, y);
    tip = [x, y];
  }
  return tip;
}

export function frost(c: Ctx, s: Scene): void {
  // The frost creeps out and back a little, never a jump (a loop: one breath per LOOP).
  const breath = 0.5 - 0.5 * Math.cos(TAU * ph(s.t, 1));
  const creep = 0.74 + 0.26 * breath;
  const { w, h, u } = s;
  c.save();
  // The frosted edge: a haze that thins inward, strongest in the corners.
  const depth = u * (0.07 + 0.03 * breath);
  const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(222,242,255,0.5)");
    g.addColorStop(0.45, "rgba(205,232,255,0.16)");
    g.addColorStop(1, "rgba(205,232,255,0)");
    c.fillStyle = g;
    c.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, 0, depth, 0, 0, w, depth);
  edge(0, h, 0, h - depth, 0, h - depth, w, depth);
  edge(0, 0, depth, 0, 0, 0, depth, h);
  edge(w, 0, w - depth, 0, w - depth, 0, depth, h);
  const reachC = u * (0.26 + 0.04 * breath);
  for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    const haze = c.createRadialGradient(cx, cy, 0, cx, cy, reachC);
    haze.addColorStop(0, "rgba(226,244,255,0.55)");
    haze.addColorStop(0.5, "rgba(210,235,255,0.18)");
    haze.addColorStop(1, "rgba(210,235,255,0)");
    c.fillStyle = haze;
    c.fillRect(cx === 0 ? 0 : w - reachC, cy === 0 ? 0 : h - reachC, reachC, reachC);
  }
  // The ferns: a cool shadow under, a soft glow, then the crisp white.
  const list = stems(s);
  c.lineCap = "round";
  c.lineJoin = "round";
  const tips: [number, number][] = [];
  c.beginPath();
  list.forEach((st) => tips.push(fern(c, st, smooth((creep - st.late) / (1 - st.late)) * 0.9 + 0.1)));
  c.strokeStyle = "rgba(40,92,160,0.28)";
  c.lineWidth = Math.max(2.4, u * 0.0085);
  c.stroke();
  c.strokeStyle = "rgba(214,238,255,0.4)";
  c.lineWidth = Math.max(1.8, u * 0.006);
  c.stroke();
  c.strokeStyle = "rgba(255,255,255,0.88)";
  c.lineWidth = Math.max(0.8, u * 0.0028);
  c.stroke();
  // Crystals that catch the light, at the tips of some ferns.
  c.fillStyle = "#fff";
  c.beginPath();
  for (let i = 0; i < tips.length; i += 2) {
    const p = ph(s.t, 1 + (i % 3 === 0 ? 1 : 0), rnd(i, 61));
    const k = Math.sin(Math.PI * p) ** 6;
    if (k < 0.05) continue;
    star(c, tips[i]![0], tips[i]![1], u * 0.03 * (0.5 + rnd(i, 62)) * clamp01(k));
  }
  c.fill();
  c.restore();
}
