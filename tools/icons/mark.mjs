// The mark of Super Claude Bros.: a sight, in white, on a sunset gradient (orange into pink):
// a ring, four ticks reaching out from it and a dot in the middle, lifted off
// the colour by a soft shadow. Pure vector, on a 100 grid.
// tools/icons/render.mjs writes the app icons from it.

/** The sight: its centre, the ring's radius and weight, the ticks' length and weight, the dot. */
const C = 50;
const RING_R = 23;
const RING_W = 6.5;
const TICK_LEN = 9.5;
const TICK_W = 6;
const DOT_R = 4.6;

/** The sight's measures, for the trailer's cards (tools/trailer/cards/), which draw it large and move its parts. */
export const SIGHT = { C, RING_R, RING_W, TICK_LEN, TICK_W, DOT_R };

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
  // Each tick runs from outside the ring to the ring's centre line, so its round end hides in the ring.
  const ticks = [0, 90, 180, 270]
    .map((a) => `<line x1="${C}" y1="${C - RING_R - TICK_LEN}" x2="${C}" y2="${C - RING_R}" transform="rotate(${a} ${C} ${C})"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa40f"/><stop offset="1" stop-color="#ff2d55"/></linearGradient>
    <radialGradient id="shine" cx="28" cy="-4" r="92" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="2.2" stdDeviation="2.6" flood-color="#7a0b1d" flood-opacity="0.32"/></filter>
    <clipPath id="shape"><rect width="100" height="100" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="100" height="100" fill="url(#bg)"/>
    <rect width="100" height="100" fill="url(#shine)"/>
    <g transform="translate(${offset} ${offset}) scale(${k})" filter="url(#lift)">
      <g fill="none" stroke="#fff" stroke-linecap="round">
        <circle cx="${C}" cy="${C}" r="${RING_R}" stroke-width="${RING_W}"/>
        <g stroke-width="${TICK_W}">${ticks}</g>
      </g>
      <circle cx="${C}" cy="${C}" r="${DOT_R}" fill="#fff"/>
    </g>
  </g>
  ${radius ? `<rect x="0.4" y="0.4" width="99.2" height="99.2" rx="${radius - 0.4}" fill="none" stroke="#fff" stroke-opacity="0.14" stroke-width="0.8"/>` : ""}
</svg>
`;
}
