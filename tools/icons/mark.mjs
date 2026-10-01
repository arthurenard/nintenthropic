// Handy's mark: a sculpted hand making a finger pistol, aimed at the game's
// own green crosshair, on a dark rounded square. The hand is a Cycles render
// (tools/icons/hand.py, built from real bone lengths); this lays it out with
// the crosshair, the glow and the shape. tools/icons/render.mjs writes the
// app icons from it.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HAND = `data:image/png;base64,${readFileSync(resolve(here, "hand.png")).toString("base64")}`;
/** Where the fingertip and the aim point fall in hand.png (0-1), from hand.py. */
const LAYOUT = JSON.parse(readFileSync(resolve(here, "hand.json"), "utf8"));

/** The hand image on the 100 grid: its size and top-left corner. */
const SIZE = 108;
const AT = [-7, 1];
/** How far past the fingertip the crosshair floats, in hand-image widths. */
const GAP = 0.1;

/**
 * The mark as an SVG document.
 * @param {{ shape?: "rounded" | "square", inset?: number }} options
 *   shape: a rounded square with clear corners (web icons, the wordmark), or
 *   full bleed (iOS and maskable icons, which the system rounds itself).
 *   inset: how much of the canvas the artwork fills, 1 = all of it (a
 *   maskable icon keeps its artwork inside the middle 80%).
 */
export function markSvg({ shape = "rounded", inset = 1 } = {}) {
  const radius = shape === "rounded" ? 22.5 : 0;
  const k = inset;
  const offset = (100 - 100 * k) / 2;
  const [tx, ty] = LAYOUT.tip;
  const dx = LAYOUT.aim[0] - tx;
  const dy = LAYOUT.aim[1] - ty;
  const n = Math.hypot(dx, dy);
  const aimX = AT[0] + (tx + (dx / n) * GAP) * SIZE;
  const aimY = AT[1] + (ty + (dy / n) * GAP) * SIZE;
  const gx = offset + k * aimX;
  const gy = offset + k * aimY;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c2e"/><stop offset="1" stop-color="#0a0a0b"/></linearGradient>
    <radialGradient id="glow" cx="${gx}" cy="${gy}" r="${26 * k}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#30d158" stop-opacity="0.34"/><stop offset="1" stop-color="#30d158" stop-opacity="0"/></radialGradient>
    <clipPath id="shape"><rect width="100" height="100" rx="${radius}"/></clipPath>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1.6" stdDeviation="2" flood-color="#000" flood-opacity="0.6"/></filter>
    <linearGradient id="fadeRamp" gradientUnits="userSpaceOnUse" x1="6" y1="94" x2="30" y2="66"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="url(#fadeRamp)"/></mask>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="100" height="100" fill="url(#bg)"/>
    <rect width="100" height="100" fill="url(#glow)"/>
    <g transform="translate(${offset} ${offset}) scale(${k})">
      <g mask="url(#fade)"><image href="${HAND}" x="${AT[0]}" y="${AT[1]}" width="${SIZE}" height="${SIZE}" filter="url(#shadow)"/></g>
      <circle cx="${aimX}" cy="${aimY}" r="5.6" fill="none" stroke="#30d158" stroke-width="2.6"/>
      <circle cx="${aimX}" cy="${aimY}" r="1.6" fill="#30d158"/>
    </g>
  </g>
  ${radius ? `<rect x="0.4" y="0.4" width="99.2" height="99.2" rx="${radius - 0.4}" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="0.8"/>` : ""}
</svg>
`;
}
