/**
 * What sits over a card by its place: the winner's crown, a gold show at the sides and a gold shimmer running round the
 * frame (and, in a clip, the flash of a camera as it opens); silver and bronze sparkles for second and third; and the last
 * place's own little rain cloud, dripping on the card. Like every effect, pure functions of the clock.
 */
import { bloom } from "./fireworks";
import { clamp01, easeOut, frac, ph, rnd, sine, sparkles, star, TAU, type Ctx, type Scene } from "./fxKit";

const GOLD = { colour: "#ffc82e", accent: "#fff3b0" };

/** The gold ring round the winner's frame: a bright band sweeps round it once a loop, and a warm glow breathes inside. */
function goldFrame(c: Ctx, s: Scene): void {
  const { w, h, u } = s;
  const r = Math.min(22, h * 0.1);
  const edge = Math.max(1.6, u * 0.0065);
  c.save();
  // A soft gold glow just inside the edge, breathing.
  const glow = 0.1 + 0.06 * sine(s.t, 1);
  c.beginPath();
  c.roundRect(0, 0, w, h, r);
  c.roundRect(u * 0.03, u * 0.03, w - u * 0.06, h - u * 0.06, Math.max(2, r * 0.8));
  c.clip("evenodd");
  const g = c.createRadialGradient(w / 2, h / 2, u * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, "rgba(255,200,46,0)");
  g.addColorStop(1, `rgba(255,200,46,${glow * 1.5})`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.restore();
  // The ring and the sheen sweeping across it, corner to corner.
  c.save();
  c.beginPath();
  c.roundRect(0, 0, w, h, r);
  c.roundRect(edge, edge, w - edge * 2, h - edge * 2, Math.max(1, r - edge));
  c.clip("evenodd");
  const sweep = ph(s.t, 1, 0.1) * 1.7 - 0.35;
  const lin = c.createLinearGradient(0, 0, w, h);
  const stop = (at: number, colour: string) => lin.addColorStop(clamp01(at), colour);
  stop(0, "rgba(255,206,48,0.5)");
  stop(sweep - 0.2, "rgba(255,206,48,0.5)");
  stop(sweep - 0.03, "rgba(255,236,140,0.95)");
  stop(sweep, "rgba(255,255,236,1)");
  stop(sweep + 0.03, "rgba(255,236,140,0.95)");
  stop(sweep + 0.2, "rgba(255,206,48,0.5)");
  stop(1, "rgba(255,206,48,0.5)");
  c.fillStyle = lin;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/** The flash of a camera as it fires: a white pop with a starburst, over the first moments (`q` 0..1). */
function flash(c: Ctx, s: Scene, q: number): void {
  const k = (1 - q) ** 2;
  c.save();
  c.fillStyle = `rgba(255,255,255,${0.9 * k})`;
  c.fillRect(0, 0, s.w, s.h);
  c.globalCompositeOperation = "lighter";
  const x = s.w * 0.5;
  const y = s.h * 0.4;
  const r = s.u * (0.3 + 0.5 * easeOut(q));
  const burst = c.createRadialGradient(x, y, 0, x, y, r);
  burst.addColorStop(0, `rgba(255,255,255,${k})`);
  burst.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = burst;
  c.fillRect(0, 0, s.w, s.h);
  c.restore();
}

/** The winner's crown, bobbing near the top, their gold show at the sides, and the gold on the frame. */
export function crown(c: Ctx, s: Scene, show = true): void {
  c.save();
  c.globalCompositeOperation = "lighter";
  // Two gold blooms at the sides, off the face, taking turns (a track with fireworks of its own has no need).
  if (show) bloom(c, s.w * 0.15, s.h * 0.3, s.u * 0.23, ph(s.t, 1, 0.05) * 0.96 + 0.02, { n: 24, ...GOLD, seed: 3 }, s.u);
  if (show) bloom(c, s.w * 0.85, s.h * 0.27, s.u * 0.23, ph(s.t, 1, 0.55) * 0.96 + 0.02, { n: 24, ...GOLD, seed: 5 }, s.u);
  c.restore();
  // Gold confetti, glinting, falling at the sides more than the middle.
  for (let i = 0; i < 14; i++) {
    const p = ph(s.t, 1, rnd(i, 9));
    const side = rnd(i, 10) < 0.5 ? 0.04 + 0.2 * rnd(i, 12) : 0.76 + 0.2 * rnd(i, 12);
    c.fillStyle = i % 2 ? "#ffd60a" : "#fff1a8";
    c.fillRect(s.w * side + Math.sin(TAU * (p * 2 + i)) * s.u * 0.03, s.h * (-0.05 + 1.1 * p), s.u * 0.018, s.u * 0.011 * Math.cos(TAU * (p * 3 + i)));
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
  goldFrame(c, s);
  // The flash of the camera, in a clip's first moments.
  if (s.intro !== undefined && s.intro >= 0 && s.intro < 0.4) flash(c, s, s.intro / 0.4);
}

/** A podium place's sparkles: silver for second, bronze for third. */
export function podium(c: Ctx, s: Scene, place: number): void {
  c.save();
  c.globalCompositeOperation = "lighter";
  sparkles(c, s, 7, 0.03, place === 2 ? "#e6edf8" : "#ffc58a", 31 + place);
  c.restore();
}

/** One teardrop, point up, falling: its top at x, y. */
function drop(c: Ctx, x: number, y: number, r: number): void {
  c.moveTo(x, y - r * 1.5);
  c.quadraticCurveTo(x + r * 0.9, y - r * 0.2, x + r * 0.9, y + r * 0.4);
  c.arc(x, y + r * 0.4, r * 0.9, 0, Math.PI);
  c.quadraticCurveTo(x - r * 0.9, y - r * 0.2, x, y - r * 1.5);
}

/**
 * Last place's own little rain cloud, over the left of the top: it drips. Drops fall from under it and land low on the
 * card with a small splash, and a few stay on the glass and run.
 */
export function cloud(c: Ctx, s: Scene): void {
  const x = s.w * 0.15;
  const y = s.h * 0.15 + Math.sin(TAU * ph(s.t, 1)) * s.u * 0.01;
  const r = s.u * 0.05;
  const floor = s.h * 0.84;
  // The drops, under the cloud: each falls, speeding up, and splashes where it lands.
  c.fillStyle = "rgba(130,200,255,0.95)";
  c.strokeStyle = "rgba(150,210,255,0.8)";
  c.lineWidth = Math.max(1, r * 0.07);
  const splashes: [number, number, number][] = [];
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const p = ph(s.t, 1 + (i % 2), rnd(i, 4));
    const dx = x + (rnd(i, 1) - 0.5) * r * 3.4;
    const top = y + r * 1.0;
    const fall = p < 0.82 ? p / 0.82 : -1;
    if (fall >= 0) {
      const dy = top + (floor - top) * fall * fall;
      drop(c, dx, dy, r * 0.2);
    } else {
      splashes.push([dx, floor, (p - 0.82) / 0.18]);
    }
  }
  c.fill();
  for (const [sx, sy, q] of splashes) {
    c.globalAlpha = 1 - q;
    c.beginPath();
    c.ellipse(sx, sy, r * (0.2 + 0.7 * q), r * (0.06 + 0.16 * q), 0, 0, TAU);
    c.stroke();
    for (const side of [-1, 1]) {
      c.beginPath();
      c.arc(sx + side * r * (0.3 + 0.5 * q), sy - r * 0.7 * Math.sin(Math.PI * q), r * 0.07, 0, TAU);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  // A few beads of water on the glass, sliding slowly down the left and right.
  for (let i = 0; i < 4; i++) {
    const p = ph(s.t, 1, rnd(i, 14));
    const bx = s.w * (i % 2 ? 0.9 - 0.03 * i : 0.06 + 0.04 * i);
    const by = s.h * (0.3 + 0.5 * p);
    const br = s.u * (0.014 + 0.008 * rnd(i, 15));
    c.globalAlpha = Math.sin(Math.PI * p) ** 0.4;
    c.fillStyle = "rgba(150,200,255,0.3)";
    c.strokeStyle = "rgba(255,255,255,0.55)";
    c.lineWidth = Math.max(1, br * 0.15);
    c.beginPath();
    c.ellipse(bx, by, br * 0.8, br, 0, 0, TAU);
    c.fill();
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.beginPath();
    c.arc(bx - br * 0.3, by - br * 0.35, br * 0.22, 0, TAU);
    c.fill();
    // Its trail.
    c.strokeStyle = "rgba(180,215,255,0.22)";
    c.beginPath();
    c.moveTo(bx, by - br);
    c.lineTo(bx, by - br - s.h * 0.12 * frac(p * 1));
    c.stroke();
  }
  c.globalAlpha = 1;
  // The cloud itself, over the drops' start.
  c.fillStyle = "rgba(205,214,228,0.97)";
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
}
