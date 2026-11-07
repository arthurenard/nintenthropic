/**
 * Fireworks that look like fireworks: a rocket climbing in an arc with a sparkling tail, a white flash as it goes off, a
 * bloom of sparks that fly out fast and slow down (drag), droop (gravity), leave short streaks, and fade, with a darker
 * pistil of a second colour and the crackle of glitter as the last ones die. Each is a pure function of the clock (its own
 * cycle repeats once per LOOP) and they go off at the sides and the top of the card, off the face in the middle.
 */
import { clamp01, easeOut, frac, ph, rnd, sine, TAU, type Ctx, type Scene } from "./fxKit";
import type { Look } from "./looks";

/** One bloom: how many sparks, its colour and the pistil's, and a seed for its look. */
interface Bloom {
  n: number;
  colour: string;
  accent: string;
  seed: number;
  /** Heads only, for a reflection. */
  light?: boolean;
}

const DRAG = 4.2;
/** How far a spark has gone at `q` (0..1) of the bloom: fast at first, then slowing to its reach. */
const reach = (q: number) => (1 - Math.exp(-DRAG * q)) / (1 - Math.exp(-DRAG));

/** A bloom of sparks centred at cx, cy, `radius` wide when full, at `q` (0..1) of its life. */
export function bloom(c: Ctx, cx: number, cy: number, radius: number, q: number, o: Bloom, u: number): void {
  if (q <= 0 || q >= 1) return;
  const fade = (1 - q) ** 1.35 * (0.88 + 0.12 * Math.sin(q * 46));
  const dot = u * 0.012;
  c.lineCap = "round";
  if (q < 0.16 && !o.light) {
    // The flash as it goes off.
    const f = 1 - q / 0.16;
    const flash = c.createRadialGradient(cx, cy, 0, cx, cy, radius * (0.2 + 0.5 * (1 - f)));
    flash.addColorStop(0, `rgba(255,255,255,${0.85 * f})`);
    flash.addColorStop(0.35, `rgba(255,236,190,${0.35 * f})`);
    flash.addColorStop(1, "rgba(255,230,180,0)");
    c.fillStyle = flash;
    c.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  const at = (j: number, qq: number): [number, number] => {
    const pistil = j % 3 === 0;
    const a = (TAU * j) / o.n + (rnd(j, o.seed) - 0.5) * 0.3;
    const v = (pistil ? 0.55 : 0.78 + 0.22 * rnd(j, o.seed + 1)) * radius;
    const k = reach(clamp01(qq));
    return [cx + Math.cos(a) * v * k, cy + Math.sin(a) * v * k + radius * 0.4 * qq * qq];
  };
  if (o.light) {
    c.fillStyle = o.colour;
    c.globalAlpha = fade * 0.4;
    c.beginPath();
    for (let j = 0; j < o.n; j++) {
      const [x, y] = at(j, q);
      c.moveTo(x + dot, y);
      c.arc(x, y, dot, 0, TAU);
    }
    c.fill();
    c.globalAlpha = 1;
    return;
  }
  // Streaks: three short segments each, the oldest the faintest, one stroke per colour.
  const step = 0.04 + 0.03 * (1 - q);
  for (let seg = 0; seg < 3; seg++) {
    c.globalAlpha = fade * (1 - seg * 0.3) * 0.9;
    c.lineWidth = dot * (1.25 - seg * 0.28);
    for (const pistil of [false, true]) {
      c.strokeStyle = pistil ? o.accent : o.colour;
      c.beginPath();
      for (let j = 0; j < o.n; j++) {
        if ((j % 3 === 0) !== pistil) continue;
        const [x0, y0] = at(j, Math.max(0, q - (seg + 1) * step));
        const [x1, y1] = at(j, Math.max(0, q - seg * step));
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
      }
      c.stroke();
    }
  }
  // The glowing heads, and a glitter of white that crackles as it dies.
  c.globalAlpha = fade;
  c.fillStyle = "#fff";
  c.beginPath();
  for (let j = 0; j < o.n; j++) {
    const [x, y] = at(j, q);
    c.moveTo(x + dot * 0.7, y);
    c.arc(x, y, dot * 0.7, 0, TAU);
  }
  c.fill();
  if (q > 0.42) {
    c.globalAlpha = Math.min(1, (q - 0.42) * 3) * (1 - q) ** 0.6;
    c.beginPath();
    for (let j = 0; j < o.n * 2; j++) {
      if (Math.sin(q * 61 + j * 5.31) < 0.45) continue;
      const [x, y] = at(j % o.n, q * (0.92 + 0.08 * rnd(j, o.seed + 5)));
      const w = dot * 0.6;
      c.rect(x + (rnd(j, o.seed + 6) - 0.5) * dot * 4, y + (rnd(j, o.seed + 7) - 0.3) * dot * 5, w, w);
    }
    c.fill();
  }
  c.globalAlpha = 1;
}

const HARBOUR = [
  { colour: "#ffb23a", accent: "#fff2c4" },
  { colour: "#45c8ff", accent: "#ffffff" },
  { colour: "#ff7aa8", accent: "#ffe3a6" },
];
const FAIR = [
  { colour: "#ff4fa3", accent: "#ffe45c" },
  { colour: "#ffd60a", accent: "#ff6a3d" },
  { colour: "#4fe0ff", accent: "#ffffff" },
  { colour: "#a784ff", accent: "#ffd0f2" },
  { colour: "#6dff9a", accent: "#fffbd0" },
];

/**
 * Where each goes off (fractions of the card) and where its rocket sets out from: at the sides and the top, so a face in the
 * middle is not in the way of either the climb or the bloom.
 */
const SPOTS: readonly { x: number; y: number; from: number }[] = [
  { x: 0.17, y: 0.32, from: 0.04 },
  { x: 0.85, y: 0.3, from: 0.97 },
  { x: 0.2, y: 0.22, from: 0.05 },
  { x: 0.8, y: 0.22, from: 0.95 },
];

function rocket(c: Ctx, s: Scene, from: number, cx: number, cy: number, q: number, colour: string): void {
  const sx = s.w * from;
  const sy = s.h * 1.02;
  const pos = (qq: number): [number, number] => {
    const k = easeOut(clamp01(qq));
    return [sx + (cx - sx) * k + Math.sin(qq * 40) * s.u * 0.004, sy + (cy - sy) * k];
  };
  c.lineCap = "round";
  const tail = 9;
  for (let i = tail; i >= 1; i--) {
    const [x0, y0] = pos(q - (i / tail) * 0.2);
    const [x1, y1] = pos(q - ((i - 1) / tail) * 0.2);
    c.globalAlpha = (1 - i / tail) ** 1.5 * 0.85;
    c.strokeStyle = i > 5 ? colour : "#ffe7a8";
    c.lineWidth = s.u * 0.011 * (1 - i / tail * 0.7);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  }
  // Sparks dropping off the tail.
  c.fillStyle = "#ffe7a8";
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const back = frac(i / 6 + q * 3) * 0.16;
    const [x, y] = pos(q - back);
    const px = x + (rnd(i, 3) - 0.5) * s.u * 0.03;
    const py = y + back * s.h * 0.35;
    c.globalAlpha = (1 - back / 0.16) * 0.8;
    c.moveTo(px + s.u * 0.0045, py);
    c.arc(px, py, s.u * 0.0045, 0, TAU);
    c.fill();
    c.beginPath();
  }
  const [hx, hy] = pos(q);
  c.globalAlpha = 1;
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(hx, hy, s.u * 0.0075, 0, TAU);
  c.fill();
}

/** The fireworks over the harbour (with their reflection in the water) and the fair (more of them, more colours). */
export function fireworks(c: Ctx, s: Scene, look: Look): void {
  const fair = look.id === "fun-fair";
  const set = fair ? FAIR : HARBOUR;
  const n = fair ? 4 : 3;
  c.save();
  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const p = ph(s.t, 1, i / n + (fair ? 0.1 : 0.16));
    const spot = SPOTS[i]!;
    const cx = s.w * spot.x;
    const cy = s.h * spot.y;
    const colours = set[i % set.length]!;
    const climb = 0.17;
    const life = 0.7;
    if (p < climb) {
      rocket(c, s, spot.from, cx, cy, p / climb, colours.colour);
      continue;
    }
    const q = (p - climb) / life;
    if (q >= 1) continue;
    const radius = s.u * (0.26 + 0.05 * rnd(i, 3)) * (spot.y < 0.25 ? 0.72 : 1);
    const o = { n: fair ? 30 : 26, ...colours, seed: i * 7 + 1 };
    bloom(c, cx, cy, radius, q, o, s.u);
    if (!fair) {
      // The water takes the light, wobbling.
      c.save();
      const water = s.h * 0.9;
      c.translate(0, water);
      c.scale(1, -0.3);
      c.translate(0, -water);
      bloom(c, cx + sine(s.t, 3, i / 3) * s.u * 0.012, cy, radius, q, { ...o, light: true }, s.u);
      c.restore();
    }
  }
  c.restore();
}
