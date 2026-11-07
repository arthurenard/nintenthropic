/**
 * The small animations that play over a finish-line photo (looks.ts says which, by track and place). Every one is a pure
 * function of the clock and the card's size: no state, no allocation to speak of, so it can be drawn at any moment, frozen
 * on its best frame for the shared picture, or stepped through for a clip. And every one repeats within LOOP seconds, so
 * the clip joins up with itself.
 */
import { LOOP, type EffectId, type Flourish, type Look } from "./looks";

type Ctx = CanvasRenderingContext2D;

/** The card being drawn on: its size, a unit of size (its shorter side), and the clock, seconds. */
export interface Scene {
  w: number;
  h: number;
  u: number;
  t: number;
}

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
/** A fixed pseudo-random number in 0..1 for the i-th thing (and a salt for another). */
const rnd = (i: number, salt = 0) => frac(Math.sin(i * 127.1 + salt * 311.7 + 1.7) * 43758.5453);
/** A looping phase 0..1: `k` whole cycles in LOOP, shifted by `off`. */
const ph = (t: number, k: number, off = 0) => frac((t * k) / LOOP + off);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
const sine = (t: number, k: number, off = 0) => Math.sin(TAU * ph(t, k, off));

function star(c: Ctx, x: number, y: number, r: number): void {
  const inner = r * 0.18;
  c.moveTo(x, y - r);
  c.lineTo(x + inner, y - inner);
  c.lineTo(x + r, y);
  c.lineTo(x + inner, y + inner);
  c.lineTo(x, y + r);
  c.lineTo(x - inner, y + inner);
  c.lineTo(x - r, y);
  c.lineTo(x - inner, y - inner);
  c.closePath();
}

/** Four-point twinkles at fixed places, each blooming once per loop (or twice). */
function sparkles(c: Ctx, s: Scene, n: number, size: number, colour: string, salt: number, box = { x: 0, y: 0, w: 1, h: 1 }): void {
  c.fillStyle = colour;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const p = ph(s.t, 1 + (i % 2), rnd(i, salt));
    const bloom = Math.sin(Math.PI * p) ** 3;
    if (bloom < 0.04) continue;
    star(c, s.w * (box.x + box.w * rnd(i, salt + 1)), s.h * (box.y + box.h * rnd(i, salt + 2)), s.u * size * (0.5 + rnd(i, salt + 3)) * bloom);
  }
  c.fill();
}

/** One firework at `q` (0..1) of its burst: sparks flying out, drooping, fading. */
function burst(c: Ctx, cx: number, cy: number, radius: number, q: number, spokes: number, spin: number, dot: number): void {
  const r = radius * easeOut(q);
  const droop = radius * 0.32 * q * q;
  const fade = (1 - q) ** 1.3;
  c.globalAlpha = fade * (0.75 + 0.25 * Math.sin(q * 40));
  if (q < 0.18) {
    c.beginPath();
    c.arc(cx, cy, radius * 0.1 * (1 - q / 0.18), 0, TAU);
    c.fill();
  }
  c.beginPath();
  for (let j = 0; j < spokes; j++) {
    const a = (TAU * j) / spokes + spin;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r + droop;
    c.moveTo(x + dot, y);
    c.arc(x, y, dot * (1 - q * 0.5), 0, TAU);
    const x2 = cx + Math.cos(a) * r * 0.82;
    const y2 = cy + Math.sin(a) * r * 0.82 + droop * 0.8;
    c.moveTo(x2 + dot * 0.6, y2);
    c.arc(x2, y2, dot * 0.6 * (1 - q * 0.5), 0, TAU);
  }
  c.fill();
}

const FAIR = ["#ff5fa8", "#ffd60a", "#5fe0ff", "#9d7bff", "#7dff9a"];
const HARBOUR = ["#ffd479", "#ffffff", "#6fd8ff"];

function fireworks(c: Ctx, s: Scene, look: Look): void {
  const fair = look.id === "fun-fair";
  const palette = fair ? FAIR : HARBOUR;
  const n = fair ? 4 : 3;
  c.save();
  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const p = ph(s.t, 1, i / n + (fair ? 0.04 : 0.1));
    const cx = s.w * (0.16 + 0.68 * ((i * 0.37 + 0.12) % 1));
    const cy = s.h * (0.16 + 0.2 * rnd(i, 2));
    const radius = s.u * (0.26 + 0.1 * rnd(i, 3));
    c.fillStyle = palette[i % palette.length]!;
    if (p < 0.2) {
      // The rocket going up, a spark at its tail.
      const q = p / 0.2;
      const y = cy + s.h * 0.55 * (1 - q * (2 - q));
      c.globalAlpha = 0.9;
      c.beginPath();
      c.arc(cx, y, s.u * 0.012, 0, TAU);
      c.arc(cx, y + s.u * 0.03, s.u * 0.008, 0, TAU);
      c.arc(cx, y + s.u * 0.055, s.u * 0.005, 0, TAU);
      c.fill();
      continue;
    }
    const q = (p - 0.2) / 0.8;
    burst(c, cx, cy, radius, q, fair ? 26 : 20, rnd(i, 4) * 3, s.u * 0.015);
    if (!fair) {
      // The water takes the light, wobbling.
      c.save();
      c.translate(0, s.h * 0.86);
      c.scale(1, -0.35);
      c.translate(0, -s.h * 0.86);
      c.globalAlpha = 0.18;
      burst(c, cx + sine(s.t, 3, i / 3) * s.u * 0.01, cy + s.h * 0.62, radius, q, 14, rnd(i, 4) * 3, s.u * 0.014);
      c.restore();
    }
  }
  c.restore();
}

function beam(c: Ctx, s: Scene): void {
  const ox = s.w * 0.94;
  const oy = s.h * 0.13;
  const a = Math.PI * 0.86 + 0.42 * sine(s.t, 1);
  const len = s.w * 1.5;
  const spread = 0.07;
  const grad = c.createLinearGradient(ox, oy, ox + Math.cos(a) * len * 0.8, oy + Math.sin(a) * len * 0.8);
  grad.addColorStop(0, "rgba(255, 246, 200, 0.6)");
  grad.addColorStop(1, "rgba(255, 246, 200, 0)");
  c.save();
  c.globalCompositeOperation = "lighter";
  c.fillStyle = grad;
  c.beginPath();
  c.moveTo(ox, oy);
  c.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
  c.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
  c.closePath();
  c.fill();
  c.fillStyle = "rgba(255, 250, 220, 0.9)";
  c.beginPath();
  c.arc(ox, oy, s.u * 0.014, 0, TAU);
  c.fill();
  c.restore();
}

function petals(c: Ctx, s: Scene): void {
  for (let i = 0; i < 12; i++) {
    const p = ph(s.t, 1, rnd(i));
    const x = s.w * (rnd(i, 1) * 1.1 - 0.05) + Math.sin(TAU * (p * 2 + rnd(i, 2))) * s.u * 0.05 + p * s.w * 0.12;
    const y = s.h * (-0.08 + 1.16 * p);
    const turn = TAU * (p * 2 + rnd(i, 3));
    const r = s.u * (0.016 + 0.01 * rnd(i, 4));
    c.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.85)" : "rgba(255,170,205,0.88)";
    c.beginPath();
    c.ellipse(x, y, r * 1.6, r * (0.5 + 0.5 * Math.abs(Math.cos(turn * 0.5))), turn, 0, TAU);
    c.fill();
  }
}

function butterflies(c: Ctx, s: Scene): void {
  for (let i = 0; i < 2; i++) {
    const x = s.w * (0.5 + 0.38 * sine(s.t, 1, i * 0.5));
    const y = s.h * (0.36 + 0.14 * sine(s.t, 2, i * 0.3)) + s.u * 0.02 * i;
    const flap = 0.25 + 0.75 * Math.abs(sine(s.t, 6 + i * 2));
    const r = s.u * 0.034;
    c.fillStyle = i === 0 ? "#ffb347" : "#7ad7ff";
    c.beginPath();
    for (const side of [-1, 1]) {
      c.ellipse(x + side * r * 0.55 * flap, y - r * 0.3, r * 0.65 * flap, r * 0.9, side * 0.4, 0, TAU);
      c.ellipse(x + side * r * 0.4 * flap, y + r * 0.55, r * 0.4 * flap, r * 0.55, side * -0.3, 0, TAU);
    }
    c.fill();
    c.strokeStyle = "rgba(40,30,30,0.85)";
    c.lineWidth = Math.max(1, s.u * 0.006);
    c.beginPath();
    c.moveTo(x, y - r * 0.8);
    c.lineTo(x, y + r * 0.8);
    c.stroke();
  }
}

function balloon(c: Ctx, s: Scene): void {
  const p = ph(s.t, 1, 0.15);
  const r = s.u * 0.07;
  const x = s.w * (-0.14 + 1.28 * p);
  const y = s.h * 0.2 + Math.sin(TAU * p * 2) * s.h * 0.02;
  c.save();
  c.translate(x, y);
  c.fillStyle = "#ff5d5d";
  c.beginPath();
  c.ellipse(0, 0, r * 0.88, r, 0, 0, TAU);
  c.fill();
  c.fillStyle = "#ffe36a";
  c.beginPath();
  c.ellipse(0, 0, r * 0.3, r, 0, 0, TAU);
  c.fill();
  c.strokeStyle = "rgba(60,40,30,0.7)";
  c.lineWidth = Math.max(1, r * 0.04);
  c.beginPath();
  c.moveTo(-r * 0.4, r * 0.9);
  c.lineTo(-r * 0.2, r * 1.5);
  c.moveTo(r * 0.4, r * 0.9);
  c.lineTo(r * 0.2, r * 1.5);
  c.stroke();
  c.fillStyle = "#8a5a2b";
  c.fillRect(-r * 0.26, r * 1.5, r * 0.52, r * 0.3);
  c.restore();
}

function sprinkles(c: Ctx, s: Scene): void {
  const colours = ["#ff6fa8", "#ffd60a", "#5fe0ff", "#fff", "#8be36a"];
  c.lineCap = "round";
  c.lineWidth = Math.max(1.5, s.u * 0.011);
  for (let i = 0; i < 24; i++) {
    const p = ph(s.t, 1, rnd(i));
    const x = s.w * rnd(i, 1);
    const y = s.h * (-0.06 + 1.12 * p);
    const a = TAU * (p * 2 + rnd(i, 2));
    const l = s.u * 0.018;
    c.strokeStyle = colours[i % colours.length]!;
    c.beginPath();
    c.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
}

function steam(c: Ctx, s: Scene): void {
  c.lineCap = "round";
  c.strokeStyle = "#fff";
  c.lineWidth = Math.max(2, s.u * 0.02);
  for (let k = 0; k < 3; k++) {
    const x0 = s.w * (0.18 + 0.32 * k);
    for (let j = 0; j < 12; j++) {
      const a = j / 12;
      const b = (j + 1) / 12;
      const at = (v: number) => [x0 + Math.sin(TAU * (v * 1.3 - ph(s.t, 1, k / 3))) * s.u * 0.045 * v, s.h * (1.02 - 0.55 * v)] as const;
      const [x1, y1] = at(a);
      const [x2, y2] = at(b);
      c.globalAlpha = 0.34 * Math.sin(Math.PI * a);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    }
  }
  c.globalAlpha = 1;
}

function flour(c: Ctx, s: Scene): void {
  const p = ph(s.t, 1, 0.1);
  if (p > 0.55) return;
  const q = p / 0.55;
  c.fillStyle = "#fffaf0";
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI * (0.05 + 0.5 * rnd(i, 1));
    const d = s.u * (0.1 + 0.28 * rnd(i, 2)) * easeOut(q);
    c.globalAlpha = 0.5 * (1 - q) * (0.6 + 0.4 * rnd(i, 3));
    c.beginPath();
    c.arc(s.w * 0.12 + Math.cos(a) * d, s.h * 0.84 + Math.sin(a) * d, s.u * (0.03 + 0.07 * q) * (0.6 + rnd(i, 4)), 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

function flare(c: Ctx, s: Scene): void {
  const x = s.w * 0.2;
  const y = s.h * 0.13;
  const pulse = 0.85 + 0.15 * sine(s.t, 2);
  c.save();
  c.globalCompositeOperation = "lighter";
  const glow = c.createRadialGradient(x, y, 0, x, y, s.u * 0.4);
  glow.addColorStop(0, `rgba(255,248,220,${0.95 * pulse})`);
  glow.addColorStop(0.25, `rgba(255,200,110,${0.5 * pulse})`);
  glow.addColorStop(1, "rgba(255,150,60,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, s.w, s.h);
  c.fillStyle = `rgba(255,230,180,${0.4 * pulse})`;
  c.beginPath();
  c.ellipse(x, y, s.u * 0.6, s.u * 0.014, 0, 0, TAU);
  c.fill();
  // Ghosts of the sun along the line through the middle of the picture.
  const mx = s.w / 2;
  const my = s.h / 2;
  for (const [f, r, a] of [[0.45, 0.04, 0.16], [0.85, 0.07, 0.1], [1.35, 0.035, 0.14]] as const) {
    c.fillStyle = `rgba(255,190,120,${a * pulse})`;
    c.beginPath();
    c.arc(x + (mx - x) * f * 1.4, y + (my - y) * f * 1.4, s.u * r, 0, TAU);
    c.fill();
  }
  c.restore();
}

function dustDevil(c: Ctx, s: Scene): void {
  const cx = s.w * (0.5 + 0.34 * sine(s.t, 1, 0.25));
  const base = s.h * 0.94;
  c.fillStyle = "#d9a86a";
  for (let i = 0; i < 36; i++) {
    const hh = frac(i / 36 + ph(s.t, 1));
    const a = TAU * (ph(s.t, 3) + i * 0.37);
    const r = s.u * (0.015 + 0.075 * hh);
    c.globalAlpha = 0.8 * Math.sin(Math.PI * hh) ** 0.7;
    c.beginPath();
    c.arc(cx + Math.cos(a) * r, base - hh * s.u * 0.5 + Math.sin(a) * r * 0.25, s.u * (0.012 + 0.016 * hh), 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

function tumbleweed(c: Ctx, s: Scene): void {
  const p = ph(s.t, 1, 0.3);
  const r = s.u * 0.055;
  const x = s.w * (1.1 - 1.2 * p);
  const y = s.h * 0.9 - Math.abs(Math.sin(TAU * p * 3)) * s.u * 0.05 - r * 0.2;
  c.save();
  c.translate(x, y);
  c.rotate(-TAU * p * 3);
  c.strokeStyle = "rgba(112,72,34,0.9)";
  c.lineWidth = Math.max(1, s.u * 0.006);
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    c.moveTo(Math.cos(i) * r * 0.2, Math.sin(i) * r * 0.2);
    c.ellipse(0, 0, r * (0.55 + 0.45 * rnd(i, 1)), r * (0.45 + 0.5 * rnd(i, 2)), i * 0.9, rnd(i, 3) * 3, rnd(i, 3) * 3 + 4);
  }
  c.stroke();
  c.restore();
}

function confetti(c: Ctx, s: Scene): void {
  for (let i = 0; i < 30; i++) {
    const p = ph(s.t, 1, rnd(i));
    const x = s.w * rnd(i, 1) + Math.sin(TAU * (p * 2 + rnd(i, 2))) * s.u * 0.04;
    const y = s.h * (-0.06 + 1.12 * p);
    const flip = Math.cos(TAU * (p * 3 + rnd(i, 3)));
    c.fillStyle = FAIR[i % FAIR.length]!;
    c.fillRect(x, y, s.u * 0.022, s.u * 0.014 * flip);
  }
}

function snow(c: Ctx, s: Scene): void {
  c.fillStyle = "#fff";
  c.beginPath();
  for (let i = 0; i < 34; i++) {
    const p = ph(s.t, 1, rnd(i));
    const size = s.u * (0.005 + 0.011 * rnd(i, 1));
    const x = s.w * rnd(i, 2) + Math.sin(TAU * (p * 2 + rnd(i, 3))) * s.u * 0.03;
    const y = s.h * (-0.04 + 1.08 * p);
    c.moveTo(x + size, y);
    c.arc(x, y, size, 0, TAU);
  }
  c.globalAlpha = 0.85;
  c.fill();
  c.globalAlpha = 1;
}

function frost(c: Ctx, s: Scene): void {
  const grow = 0.62 + 0.2 * (0.5 - 0.5 * Math.cos(TAU * ph(s.t, 1)));
  const reach = s.u * grow * 0.55;
  c.lineCap = "round";
  c.strokeStyle = "rgba(235,248,255,0.55)";
  c.lineWidth = Math.max(1, s.u * 0.005);
  c.beginPath();
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [s.w, 0, -1, 1], [0, s.h, 1, -1], [s.w, s.h, -1, -1]] as const) {
    const haze = c.createRadialGradient(cx, cy, 0, cx, cy, reach);
    haze.addColorStop(0, "rgba(225,244,255,0.62)");
    haze.addColorStop(1, "rgba(225,244,255,0)");
    c.fillStyle = haze;
    c.fillRect(sx > 0 ? 0 : s.w - reach, sy > 0 ? 0 : s.h - reach, reach, reach);
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI / 2) * ((i + 0.5) / 5);
      const len = reach * (0.5 + 0.4 * rnd(i, cx + cy));
      const dx = Math.cos(a) * sx;
      const dy = Math.sin(a) * sy;
      c.moveTo(cx, cy);
      c.lineTo(cx + dx * len, cy + dy * len);
      for (const f of [0.45, 0.75]) {
        const bx = cx + dx * len * f;
        const by = cy + dy * len * f;
        const bl = len * 0.22 * (1.2 - f);
        c.moveTo(bx, by);
        c.lineTo(bx + (dx * 0.5 - dy * 0.9) * bl * 2, by + (dy * 0.5 + dx * 0.9) * bl * 2);
        c.moveTo(bx, by);
        c.lineTo(bx + (dx * 0.5 + dy * 0.9) * bl * 2, by + (dy * 0.5 - dx * 0.9) * bl * 2);
      }
    }
  }
  c.stroke();
}

function embers(c: Ctx, s: Scene): void {
  c.save();
  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < 34; i++) {
    const p = ph(s.t, 1, rnd(i));
    const x = s.w * rnd(i, 1) + Math.sin(TAU * (p * 1.5 + rnd(i, 2))) * s.u * 0.05;
    const y = s.h * (1.04 - 1.1 * p);
    c.globalAlpha = Math.sin(Math.PI * p) ** 0.6 * (0.65 + 0.35 * sine(s.t, 6, rnd(i, 3)));
    c.fillStyle = i % 3 === 0 ? "#ffd27a" : i % 3 === 1 ? "#ff8a2f" : "#ff4a1f";
    c.beginPath();
    c.arc(x, y, s.u * (0.005 + 0.009 * rnd(i, 4)) * (1 - p * 0.5), 0, TAU);
    c.fill();
  }
  c.restore();
}

function lava(c: Ctx, s: Scene): void {
  const pulse = 0.82 + 0.18 * sine(s.t, 1);
  const grad = c.createLinearGradient(0, s.h, 0, s.h * 0.45);
  grad.addColorStop(0, `rgba(255,96,24,${0.62 * pulse})`);
  grad.addColorStop(0.5, `rgba(255,60,10,${0.2 * pulse})`);
  grad.addColorStop(1, "rgba(255,60,10,0)");
  c.save();
  c.globalCompositeOperation = "lighter";
  c.fillStyle = grad;
  c.fillRect(0, 0, s.w, s.h);
  c.restore();
}

function shooting(c: Ctx, s: Scene): void {
  c.lineCap = "round";
  c.lineWidth = Math.max(1.5, s.u * 0.009);
  for (let i = 0; i < 2; i++) {
    const p = ph(s.t, 1, i * 0.5 + 0.1);
    if (p > 0.32) continue;
    const q = p / 0.32;
    const dx = -Math.cos(0.5) * s.u * 0.7;
    const dy = Math.sin(0.5) * s.u * 0.7;
    const hx = s.w * (0.95 - 0.35 * i) + dx * q;
    const hy = s.h * (0.05 + 0.1 * i) + dy * q;
    const tail = c.createLinearGradient(hx, hy, hx - dx * 0.4, hy - dy * 0.4);
    tail.addColorStop(0, `rgba(255,255,255,${Math.sin(Math.PI * q)})`);
    tail.addColorStop(1, "rgba(180,170,255,0)");
    c.strokeStyle = tail;
    c.beginPath();
    c.moveTo(hx, hy);
    c.lineTo(hx - dx * 0.4, hy - dy * 0.4);
    c.stroke();
  }
}

function planet(c: Ctx, s: Scene): void {
  const r = s.u * 0.12;
  const x = s.w * 0.99 + Math.sin(TAU * ph(s.t, 1)) * s.u * 0.01;
  const y = s.h * 0.4;
  const ring = (from: number, to: number) => {
    c.beginPath();
    c.ellipse(x, y, r * 1.9, r * 0.5, -0.35, from, to);
    c.stroke();
  };
  c.lineWidth = Math.max(2, r * 0.16);
  c.strokeStyle = "rgba(255,220,250,0.7)";
  ring(Math.PI, TAU);
  const body = c.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, "#ffd9f2");
  body.addColorStop(0.55, "#a77bff");
  body.addColorStop(1, "#3a2a9c");
  c.fillStyle = body;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  ring(0, Math.PI);
}

function leaves(c: Ctx, s: Scene): void {
  c.lineCap = "round";
  c.strokeStyle = "rgba(6, 52, 40, 0.26)";
  const sway = 0.05 * sine(s.t, 1);
  c.beginPath();
  for (const [ox, oy, flip] of [[-s.w * 0.04, -s.h * 0.04, 1], [s.w * 1.04, -s.h * 0.04, -1]] as const) {
    for (let f = 0; f < 3; f++) {
      const base = Math.PI * (0.18 + 0.2 * f) + sway * (f + 1);
      const len = s.u * (0.48 - 0.06 * f);
      const dirx = Math.cos(base) * flip;
      const diry = Math.sin(base);
      // The spine bends down with its own weight; leaflets hang off it.
      const at = (v: number) => [ox + dirx * len * v, oy + diry * len * v + len * 0.35 * v * v] as const;
      let [px, py] = at(0);
      for (let j = 1; j <= 10; j++) {
        const [x, y] = at(j / 10);
        c.moveTo(px, py);
        c.lineTo(x, y);
        const l = s.u * 0.1 * Math.sin(Math.PI * (j / 11)) ** 0.7;
        c.moveTo(x, y);
        c.lineTo(x - diry * flip * l + dirx * l * 0.4, y + l * 0.85);
        c.moveTo(x, y);
        c.lineTo(x + diry * flip * l + dirx * l * 0.4, y + l * 0.55);
        px = x;
        py = y;
      }
    }
  }
  c.lineWidth = Math.max(1.5, s.u * 0.012);
  c.stroke();
}

function bubbles(c: Ctx, s: Scene): void {
  c.strokeStyle = "rgba(255,255,255,0.7)";
  c.lineWidth = Math.max(1, s.u * 0.004);
  for (let i = 0; i < 14; i++) {
    const p = ph(s.t, 1, rnd(i));
    const r = s.u * (0.012 + 0.022 * rnd(i, 1));
    const x = s.w * rnd(i, 2) + Math.sin(TAU * (p * 3 + rnd(i, 3))) * s.u * 0.025;
    const y = s.h * (1.06 - 1.14 * p);
    c.globalAlpha = Math.sin(Math.PI * p) ** 0.5;
    c.fillStyle = "rgba(255,255,255,0.14)";
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
    c.stroke();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(x - r * 0.35, y - r * 0.35, r * 0.2, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

function glint(c: Ctx, s: Scene): void {
  const pulse = 0.55 + 0.45 * sine(s.t, 2);
  const x = s.w * 0.8;
  const y = s.h * 0.14;
  c.save();
  c.globalCompositeOperation = "lighter";
  const glow = c.createRadialGradient(x, y, 0, x, y, s.u * 0.2);
  glow.addColorStop(0, `rgba(255,252,225,${0.8 * pulse})`);
  glow.addColorStop(1, "rgba(255,240,170,0)");
  c.fillStyle = glow;
  c.fillRect(x - s.u * 0.2, y - s.u * 0.2, s.u * 0.4, s.u * 0.4);
  c.fillStyle = `rgba(255,255,255,${0.35 + 0.6 * pulse})`;
  c.beginPath();
  star(c, x, y, s.u * (0.07 + 0.09 * pulse));
  c.fill();
  c.restore();
}

const EFFECTS: Record<EffectId, (c: Ctx, s: Scene, look: Look) => void> = {
  petals,
  butterflies,
  balloon,
  sprinkles,
  steam,
  flour,
  fireworks,
  beam,
  flare,
  dustDevil,
  tumbleweed,
  confetti,
  snow,
  frost,
  glitter: (c, s) => sparkles(c, s, 8, 0.035, "#fff", 11),
  embers,
  lava,
  shooting,
  twinkle: (c, s) => sparkles(c, s, 22, 0.018, "#e8e0ff", 21),
  planet,
  leaves,
  bubbles,
  glint,
};

/** The winner's crown, bobbing over the middle of the top, and their gold show. */
function crown(c: Ctx, s: Scene): void {
  c.save();
  c.globalCompositeOperation = "lighter";
  c.fillStyle = "#ffcf3a";
  burst(c, s.w * 0.2, s.h * 0.34, s.u * 0.3, ph(s.t, 1, 0.05) * 0.95, 20, 0.2, s.u * 0.011);
  burst(c, s.w * 0.8, s.h * 0.3, s.u * 0.3, ph(s.t, 1, 0.55) * 0.95, 20, 0.6, s.u * 0.011);
  burst(c, s.w * 0.5, s.h * 0.2, s.u * 0.22, ph(s.t, 1, 0.3) * 0.95, 16, 0.1, s.u * 0.009);
  c.restore();
  for (let i = 0; i < 14; i++) {
    const p = ph(s.t, 1, rnd(i, 9));
    c.fillStyle = i % 2 ? "#ffd60a" : "#fff1a8";
    c.fillRect(s.w * rnd(i, 10) + Math.sin(TAU * (p * 2 + i)) * s.u * 0.03, s.h * (-0.05 + 1.1 * p), s.u * 0.018, s.u * 0.011 * Math.cos(TAU * (p * 3 + i)));
  }
  const w = s.u * 0.2;
  const x = s.w * 0.3;
  const y = s.u * 0.15 + Math.sin(TAU * ph(s.t, 2)) * s.u * 0.008;
  const gold = c.createLinearGradient(x, y, x, y + w * 0.6);
  gold.addColorStop(0, "#fff1a8");
  gold.addColorStop(0.5, "#ffd60a");
  gold.addColorStop(1, "#d98f00");
  c.fillStyle = gold;
  c.strokeStyle = "rgba(120,70,0,0.8)";
  c.lineWidth = Math.max(1, s.u * 0.006);
  c.beginPath();
  c.moveTo(x - w / 2, y + w * 0.55);
  c.lineTo(x - w / 2, y + w * 0.1);
  c.lineTo(x - w * 0.25, y + w * 0.32);
  c.lineTo(x, y);
  c.lineTo(x + w * 0.25, y + w * 0.32);
  c.lineTo(x + w / 2, y + w * 0.1);
  c.lineTo(x + w / 2, y + w * 0.55);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "#ff4f7a";
  for (const dx of [-0.3, 0, 0.3]) {
    c.beginPath();
    c.arc(x + dx * w, y + w * 0.42, w * 0.045, 0, TAU);
    c.fill();
  }
  c.save();
  c.globalCompositeOperation = "lighter";
  c.fillStyle = "#fff4b8";
  c.beginPath();
  star(c, x + w * 0.5, y + w * 0.1, s.u * 0.035 * (0.6 + 0.4 * sine(s.t, 2)));
  c.fill();
  c.restore();
}

/** A podium place's sparkles: silver for second, bronze for third. */
function podium(c: Ctx, s: Scene, place: number): void {
  c.save();
  c.globalCompositeOperation = "lighter";
  sparkles(c, s, 7, 0.03, place === 2 ? "#e6edf8" : "#ffc58a", 31 + place);
  c.restore();
}

/** Last place's own little rain cloud, with drops. */
function cloud(c: Ctx, s: Scene): void {
  const x = s.w * 0.3;
  const y = s.h * 0.17 + Math.sin(TAU * ph(s.t, 1)) * s.u * 0.01;
  const r = s.u * 0.05;
  c.fillStyle = "rgba(205,214,228,0.95)";
  c.beginPath();
  c.arc(x - r * 1.1, y, r * 0.9, 0, TAU);
  c.arc(x, y - r * 0.5, r * 1.2, 0, TAU);
  c.arc(x + r * 1.2, y, r, 0, TAU);
  c.roundRect(x - r * 2, y - r * 0.2, r * 4.2, r * 1.2, r * 0.6);
  c.fill();
  c.fillStyle = "#3a4258";
  c.beginPath();
  c.arc(x - r * 0.4, y + r * 0.1, r * 0.1, 0, TAU);
  c.arc(x + r * 0.5, y + r * 0.1, r * 0.1, 0, TAU);
  c.fill();
  c.strokeStyle = "#3a4258";
  c.lineWidth = Math.max(1, r * 0.1);
  c.beginPath();
  c.arc(x + r * 0.05, y + r * 0.78, r * 0.28, Math.PI * 1.15, Math.PI * 1.85);
  c.stroke();
  c.strokeStyle = "rgba(120,190,255,0.9)";
  c.lineWidth = Math.max(1.5, r * 0.12);
  c.lineCap = "round";
  c.beginPath();
  for (let i = 0; i < 7; i++) {
    const p = ph(s.t, 2, rnd(i));
    const dx = x + (rnd(i, 1) - 0.5) * r * 3.6;
    const top = y + r * 1.1 + p * s.h * 0.4;
    c.moveTo(dx, top);
    c.lineTo(dx - r * 0.1, top + r * 0.4);
  }
  c.stroke();
}

/** Draws a track's effects and a place's flourish on a card `w` x `h` at time `t` (seconds): over a cleared canvas (or, with `clear` off, over what is there). */
export function drawFx(c: Ctx, w: number, h: number, t: number, look: Look, flourish: Flourish | null, place: number, clear = true): void {
  const s: Scene = { w, h, u: Math.min(w, h), t };
  c.save();
  if (clear) c.clearRect(0, 0, w, h);
  for (const id of look.effects) {
    c.save();
    EFFECTS[id](c, s, look);
    c.restore();
  }
  if (flourish === "crown") crown(c, s);
  else if (flourish === "sparkle") podium(c, s, place);
  else if (flourish === "cloud") cloud(c, s);
  c.restore();
}
