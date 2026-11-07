/**
 * The small animations that play over a finish-line photo (looks.ts says which, by track and place). Every one is a pure
 * function of the clock and the card's size: no state, no allocation to speak of, so it can be drawn at any moment, frozen
 * on its best frame for the shared picture, or stepped through for a clip. And every one repeats within LOOP seconds, so
 * the clip joins up with itself.
 */
import { fireworks } from "./fireworks";
import { frost } from "./frost";
import { clamp01, clearOf, easeOut, frac, ph, rnd, sine, sparkles, star, TAU, type Ctx, type Scene } from "./fxKit";
import type { EffectId, Flourish, Look } from "./looks";
import { cloud, crown, podium } from "./places";
import { glint, leaves } from "./palms";

const CONFETTI = ["#ff5fa8", "#ffd60a", "#5fe0ff", "#9d7bff", "#7dff9a"];

/** The lighthouse's beam: it swings slowly across the top of the picture, up and away from the face, never down over it. */
function beam(c: Ctx, s: Scene): void {
  const ox = s.w * 0.97;
  const oy = s.h * 0.2;
  const a = Math.PI + (0.05 + 0.2 * (0.5 + 0.5 * sine(s.t, 1)));
  const len = s.w * 1.4;
  const spread = 0.06 + 0.02 * Math.abs(sine(s.t, 1));
  const grad = c.createLinearGradient(ox, oy, ox + Math.cos(a) * len * 0.9, oy + Math.sin(a) * len * 0.9);
  grad.addColorStop(0, "rgba(255, 244, 190, 0.5)");
  grad.addColorStop(0.7, "rgba(255, 244, 190, 0.1)");
  grad.addColorStop(1, "rgba(255, 244, 190, 0)");
  c.save();
  c.globalCompositeOperation = "lighter";
  c.fillStyle = grad;
  c.beginPath();
  c.moveTo(ox, oy);
  c.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
  c.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
  c.closePath();
  c.fill();
  const lamp = c.createRadialGradient(ox, oy, 0, ox, oy, s.u * 0.06);
  lamp.addColorStop(0, "rgba(255, 252, 230, 0.95)");
  lamp.addColorStop(1, "rgba(255, 240, 180, 0)");
  c.fillStyle = lamp;
  c.fillRect(ox - s.u * 0.06, oy - s.u * 0.06, s.u * 0.12, s.u * 0.12);
  c.restore();
}

function petals(c: Ctx, s: Scene): void {
  for (let i = 0; i < 12; i++) {
    const p = ph(s.t, 1, rnd(i));
    const x = s.w * (rnd(i, 1) * 1.1 - 0.05) + Math.sin(TAU * (p * 2 + rnd(i, 2))) * s.u * 0.05 + p * s.w * 0.12;
    const y = s.h * (-0.08 + 1.16 * p);
    const turn = TAU * (p * 2 + rnd(i, 3));
    const r = s.u * (0.016 + 0.01 * rnd(i, 4)) * clearOf(s, x, y);
    c.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.85)" : "rgba(255,170,205,0.88)";
    c.beginPath();
    c.ellipse(x, y, r * 1.6, r * (0.5 + 0.5 * Math.abs(Math.cos(turn * 0.5))), turn, 0, TAU);
    c.fill();
  }
}

function butterflies(c: Ctx, s: Scene): void {
  for (let i = 0; i < 2; i++) {
    // Each flutters at its own side, out of the way of the face.
    const x = s.w * ((i === 0 ? 0.13 : 0.87) + 0.06 * sine(s.t, 1, i * 0.5));
    const y = s.h * (0.42 + 0.2 * sine(s.t, 2, i * 0.3)) + s.u * 0.02 * i;
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
  const y = s.h * 0.13 + Math.sin(TAU * p * 2) * s.h * 0.02;
  c.save();
  // Over the face, it goes faint.
  c.globalAlpha = 0.3 + 0.7 * clearOf(s, x, y + r);
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
    const l = s.u * 0.018 * clearOf(s, x, y);
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
    c.fillStyle = CONFETTI[i % CONFETTI.length]!;
    const k = clearOf(s, x, y);
    c.fillRect(x, y, s.u * 0.022 * k, s.u * 0.014 * flip * k);
  }
}

function snow(c: Ctx, s: Scene): void {
  c.fillStyle = "#fff";
  c.beginPath();
  for (let i = 0; i < 34; i++) {
    const p = ph(s.t, 1, rnd(i));
    const x = s.w * rnd(i, 2) + Math.sin(TAU * (p * 2 + rnd(i, 3))) * s.u * 0.03;
    const y = s.h * (-0.04 + 1.08 * p);
    const size = s.u * (0.005 + 0.011 * rnd(i, 1)) * clearOf(s, x, y);
    c.moveTo(x + size, y);
    c.arc(x, y, size, 0, TAU);
  }
  c.globalAlpha = 0.85;
  c.fill();
  c.globalAlpha = 1;
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

function bubbles(c: Ctx, s: Scene): void {
  c.strokeStyle = "rgba(255,255,255,0.7)";
  c.lineWidth = Math.max(1, s.u * 0.004);
  for (let i = 0; i < 14; i++) {
    const p = ph(s.t, 1, rnd(i));
    const x = s.w * rnd(i, 2) + Math.sin(TAU * (p * 3 + rnd(i, 3))) * s.u * 0.025;
    const y = s.h * (1.06 - 1.14 * p);
    const r = s.u * (0.012 + 0.022 * rnd(i, 1)) * clearOf(s, x, y);
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

/** Draws a track's effects and a place's flourish on a card `w` x `h` at time `t` (seconds): over a cleared canvas (or, with `clear` off, over what is there). */
export function drawFx(c: Ctx, w: number, h: number, t: number, look: Look, flourish: Flourish | null, place: number, clear = true, intro?: number): void {
  const s: Scene = { w, h, u: Math.min(w, h), t, intro };
  c.save();
  if (clear) c.clearRect(0, 0, w, h);
  for (const id of look.effects) {
    c.save();
    EFFECTS[id](c, s, look);
    c.restore();
  }
  if (flourish === "crown") crown(c, s, !look.effects.includes("fireworks"));
  else if (flourish === "sparkle") podium(c, s, place);
  else if (flourish === "cloud") cloud(c, s);
  c.restore();
}
