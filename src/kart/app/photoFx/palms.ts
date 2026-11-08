/**
 * Five Finger Circuit's palms: the shadows of fronds from the two top corners falling over the picture, and the sun glint
 * through them. Each frond has a curved midrib that arches out and droops, and long tapered leaflets down both sides that
 * hang and rustle on their own beat; the shadow is soft-edged (the shape, then the same shape grown a little at a faint
 * alpha) over a warm patch of sunlight, so it reads on a dark room as well as a bright window. They stay in the corners:
 * the middle of the card, where a face is, is clear.
 */
import { ph, sine, star, TAU, type Ctx, type Scene } from "./fxKit";

interface Frond {
  /** Where it is rooted, as a fraction of the card (off the corner). */
  x: number;
  y: number;
  /** Its heading, radians below the horizontal, going inward. */
  a: number;
  /** Its length, in units. */
  len: number;
  /** Its own beat. */
  beat: number;
}

const FRONDS: readonly Frond[] = [
  { x: -0.05, y: -0.08, a: 0.1, len: 0.56, beat: 0 },
  { x: -0.05, y: -0.08, a: 0.6, len: 0.52, beat: 0.2 },
  { x: -0.05, y: -0.08, a: 1.1, len: 0.44, beat: 0.45 },
  { x: 1.05, y: -0.08, a: 0.16, len: 0.58, beat: 0.1 },
  { x: 1.05, y: -0.08, a: 0.68, len: 0.5, beat: 0.35 },
  { x: 1.05, y: -0.08, a: 1.14, len: 0.4, beat: 0.6 },
];

/** One frond's leaflets and midrib into the current path. */
function frond(c: Ctx, s: Scene, f: Frond, flip: number): void {
  const { u, t } = s;
  const len = u * f.len;
  const sway = Math.sin(TAU * ph(t, 1, f.beat)) * 0.045;
  const a = f.a + sway;
  const dx = Math.cos(a) * flip;
  const dy = Math.sin(a);
  const ox = s.w * f.x;
  const oy = s.h * f.y;
  // The midrib arches out and droops with its own weight.
  const droop = len * 0.3;
  const at = (v: number): [number, number] => [ox + dx * len * v, oy + dy * len * v + droop * v * v];
  const leaflets = 15;
  for (let j = 1; j <= leaflets; j++) {
    const v = 0.1 + (0.88 * (j - 1)) / (leaflets - 1);
    const [bx, by] = at(v);
    const [nx, ny] = at(v + 0.02);
    let tx = nx - bx;
    let ty = ny - by;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // Longest in the middle of the frond, tapering to a point at the tip.
    const size = u * 0.17 * Math.sin(Math.PI * Math.min(1, v * 0.96 + 0.04)) ** 0.75 * (1.08 - v * 0.3) * (f.len / 0.5) ** 0.5;
    for (const side of [-1, 1]) {
      // Swept toward the tip, hanging a little, rustling.
      const flutter = Math.sin(TAU * ph(t, 2, f.beat + j * 0.07)) * 0.07;
      const spread = 1.12 + flutter * side;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread) * side;
      let lx = tx * cos - ty * sin;
      let ly = tx * sin + ty * cos;
      ly += 0.42;
      const ll = Math.hypot(lx, ly) || 1;
      lx /= ll;
      ly /= ll;
      const tipX = bx + lx * size;
      const tipY = by + ly * size + size * 0.14;
      const wid = size * 0.17;
      const px = -ly;
      const py = lx;
      c.moveTo(bx - tx * wid * 0.8, by - ty * wid * 0.8);
      c.quadraticCurveTo(bx + lx * size * 0.5 + px * wid * 1.5, by + ly * size * 0.5 + py * wid * 1.5, tipX, tipY);
      c.quadraticCurveTo(bx + lx * size * 0.5 - px * wid * 1.0, by + ly * size * 0.5 - py * wid * 1.0, bx + tx * wid * 0.8, by + ty * wid * 0.8);
      c.closePath();
    }
  }
}

/** The palm shadows over a patch of warm sun in each top corner. */
export function leaves(c: Ctx, s: Scene): void {
  const { w, h, u } = s;
  c.save();
  // The sunlit patch the shadows fall on: warm light that thins away from the corner.
  c.globalCompositeOperation = "lighter";
  for (const x of [0, w]) {
    const patch = c.createRadialGradient(x, 0, 0, x, 0, u * 0.62);
    patch.addColorStop(0, "rgba(255,226,140,0.46)");
    patch.addColorStop(0.55, "rgba(255,214,120,0.18)");
    patch.addColorStop(1, "rgba(255,214,120,0)");
    c.fillStyle = patch;
    c.fillRect(x === 0 ? 0 : w - u * 0.62, 0, u * 0.62, u * 0.62);
  }
  c.globalCompositeOperation = "source-over";
  c.lineCap = "round";
  c.lineJoin = "round";
  for (let side = 0; side < 2; side++) {
    const flip = side === 0 ? 1 : -1;
    for (const f of FRONDS.filter((fr) => (fr.x < 0.5) === (side === 0))) {
      c.beginPath();
      frond(c, s, f, flip);
      // Soft edge: the leaflets grown by a wider and fainter stroke each, then the leaflets themselves.
      c.strokeStyle = "rgba(3,34,26,0.06)";
      c.lineWidth = u * 0.034;
      c.stroke();
      c.strokeStyle = "rgba(3,34,26,0.12)";
      c.lineWidth = u * 0.016;
      c.stroke();
      c.fillStyle = "rgba(3,34,26,0.46)";
      c.fill();
      // The midrib, a darker line down the middle.
      const len = u * f.len;
      const sway = Math.sin(TAU * ph(s.t, 1, f.beat)) * 0.045;
      const a = f.a + sway;
      c.beginPath();
      c.moveTo(w * f.x, h * f.y);
      for (let i = 1; i <= 12; i++) {
        const v = i / 12;
        c.lineTo(w * f.x + Math.cos(a) * flip * len * v, h * f.y + Math.sin(a) * len * v + len * 0.3 * v * v);
      }
      c.strokeStyle = "rgba(3,34,26,0.4)";
      c.lineWidth = Math.max(1.5, u * 0.011);
      c.stroke();
    }
  }
  c.restore();
}

/** The sun, glinting through the fronds: a soft glow, a four-point star and a streak, pulsing. */
export function glint(c: Ctx, s: Scene): void {
  const pulse = 0.6 + 0.4 * sine(s.t, 2);
  const x = s.w * 0.9;
  const y = s.h * 0.24;
  c.save();
  c.globalCompositeOperation = "lighter";
  const r = s.u * 0.26;
  const glow = c.createRadialGradient(x, y, 0, x, y, r);
  glow.addColorStop(0, `rgba(255,250,222,${0.75 * pulse})`);
  glow.addColorStop(0.3, `rgba(255,236,170,${0.28 * pulse})`);
  glow.addColorStop(1, "rgba(255,236,170,0)");
  c.fillStyle = glow;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  // A streak across, and the star.
  const streak = c.createLinearGradient(x - s.u * 0.3, y, x + s.u * 0.3, y);
  streak.addColorStop(0, "rgba(255,244,200,0)");
  streak.addColorStop(0.5, `rgba(255,248,214,${0.55 * pulse})`);
  streak.addColorStop(1, "rgba(255,244,200,0)");
  c.fillStyle = streak;
  c.fillRect(x - s.u * 0.3, y - s.u * 0.004, s.u * 0.6, s.u * 0.008);
  c.fillStyle = `rgba(255,255,250,${0.5 + 0.5 * pulse})`;
  c.beginPath();
  star(c, x, y, s.u * (0.04 + 0.05 * pulse));
  c.fill();
  // Ghosts of the sun toward the middle of the card, small and faint.
  const gx = s.w / 2 - x;
  const gy = s.h / 2 - y;
  for (const [f, rr, a] of [[0.22, 0.02, 0.2], [0.4, 0.032, 0.12]] as const) {
    c.fillStyle = `rgba(255,220,150,${a * pulse})`;
    c.beginPath();
    c.arc(x + gx * f, y + gy * f, s.u * rr, 0, TAU);
    c.fill();
  }
  c.restore();
}
