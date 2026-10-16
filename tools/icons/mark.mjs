// Handheld's mark: a finger pistol, drawn flat like an SF Symbol, aimed at a
// sight, on a sunset gradient (orange into pink). Pure vector, on a 100 grid:
// one silhouette for the hand, the curled fingers parted by cut creases.
// tools/icons/render.mjs writes the app icons from it.

/** The hand, pointing right, on its own 100 grid. */
const HAND = [
  "M 23.4 21.4", // thumb, back edge near the tip
  "A 5.8 5.8 0 0 1 34.8 19.2", // thumb tip
  "L 39.6 32.4", // thumb, front edge
  "C 40.6 35.2 42.6 36 45.6 36", // webbing into the index
  "L 78.5 36", // index, top
  "A 6.5 6.5 0 0 1 78.5 49", // index tip
  "L 63.5 49", // index, underside
  "A 5.25 5.25 0 0 1 63.5 59.5", // middle finger's knuckle
  "L 62 59.5",
  "A 5.25 5.25 0 0 1 62 70", // ring finger's knuckle
  "L 58.5 70",
  "A 4.75 4.75 0 0 1 58.5 79.5", // little finger's knuckle
  "L 47 79.5",
  "C 38 79.5 28 76.5 17.75 73.93", // under the wrist
  "Q 16 73.5 15.75 71.72",
  "L 12.85 51.28", // the cut across the wrist, its corners eased
  "Q 12.6 49.5 14.27 48.85",
  "C 19 47 23 45.6 26.4 42.6", // top of the wrist into the back of the hand
  "C 27.6 41.4 28 39.6 27.5 37.6", // into the thumb
  "Z",
].join(" ");
/** The creases between the index and the curled fingers, and between those: [x1, y, x2]. */
const CREASES = [
  [52, 49.6, 100],
  [53, 60, 100],
  [52, 70.5, 100],
];
/** The index fingertip and the hand's left edge and vertical middle, on the hand's grid. */
const TIP = [85, 42.5];
const LEFT = 12.6;
const MIDDLE = 46.5;

/** The hand's scale on the icon, where its left edge falls, and where its middle sits (a little high, for the eye). */
const SCALE = 0.8;
const AT = [12, 47.6];
/** The sight: its radius, and the gap between it and the fingertip. */
const SIGHT = 6.4;
const GAP = 4.2;

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
  const tx = AT[0] - LEFT * SCALE;
  const ty = AT[1] - MIDDLE * SCALE;
  const aimX = tx + TIP[0] * SCALE + GAP + SIGHT;
  const aimY = ty + TIP[1] * SCALE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa40f"/><stop offset="1" stop-color="#ff2d55"/></linearGradient>
    <radialGradient id="shine" cx="30" cy="0" r="90" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="ink" x1="0" y1="15" x2="0" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e8e8ed"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.2" stdDeviation="2.6" flood-color="#000" flood-opacity="0.22"/></filter>
    <mask id="creases" maskUnits="userSpaceOnUse" x="-100" y="-100" width="300" height="300">
      <rect x="-100" y="-100" width="300" height="300" fill="#fff"/>
      <g stroke="#000" stroke-width="2.2" stroke-linecap="round">${CREASES.map(([x1, y, x2]) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`).join("")}</g>
    </mask>
    <clipPath id="shape"><rect width="100" height="100" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="100" height="100" fill="url(#bg)"/>
    <rect width="100" height="100" fill="url(#shine)"/>
    <g transform="translate(${offset} ${offset}) scale(${k})" filter="url(#shadow)">
      <g transform="translate(${tx} ${ty}) scale(${SCALE})"><path d="${HAND}" fill="url(#ink)" mask="url(#creases)"/></g>
      <circle cx="${aimX}" cy="${aimY}" r="${SIGHT}" fill="none" stroke="#fff" stroke-width="2.4"/>
      <circle cx="${aimX}" cy="${aimY}" r="1.7" fill="#fff"/>
    </g>
  </g>
  ${radius ? `<rect x="0.4" y="0.4" width="99.2" height="99.2" rx="${radius - 0.4}" fill="none" stroke="#fff" stroke-opacity="0.14" stroke-width="0.8"/>` : ""}
</svg>
`;
}
