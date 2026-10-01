// Handy's mark: a finger pistol aimed at the game's own crosshair, on a dark
// rounded square. One source for the favicon, the app icons, the wordmark,
// the share card and the promo (tools/icons/render.mjs writes the files).

/** The hand, drawn on a 100 grid pointing right: thumb up, index out, three fingers curled. */
const HAND =
  "M30 96 L49 96 L48.5 82 C48.6 80 49.6 78.4 51 78 C54 78 57 77.5 60 77 C66 77 66 66.5 60 66.5 " +
  "C68 66.5 68 57 61 57 C69 57 69 48.5 62 48.5 L84 47 C91 46.5 91 33.5 84 33.5 L49.5 35 " +
  "C47 34.5 45.2 32.5 44.5 30 C43.6 26.6 43.2 23 43 20 A5.6 5.6 0 0 0 31.8 21 " +
  "C32.4 27 32.6 33 31.8 39 C29 45 28 51 28.3 58 C28.6 66 30 73 30.6 80 Z";

/** The creases between the curled fingers. */
const CREASES = ["M53.5 48.9 Q57.5 48.2 61.5 48.6", "M53.8 57.3 Q57.2 56.6 60.6 57", "M53.2 66.8 Q56.4 66.1 59.6 66.5"];

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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c2e"/><stop offset="1" stop-color="#0a0a0b"/></linearGradient>
    <radialGradient id="glow" cx="${offset + k * 86.7}" cy="${offset + k * 42.1}" r="${24 * k}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#30d158" stop-opacity="0.32"/><stop offset="1" stop-color="#30d158" stop-opacity="0"/></radialGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d8d8de"/></linearGradient>
    <linearGradient id="fadeRamp" x1="0" y1="70" x2="0" y2="92" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="url(#fadeRamp)"/></mask>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.2" stdDeviation="2.4" flood-color="#000" flood-opacity="0.55"/></filter>
  </defs>
  <rect width="100" height="100" rx="${radius}" fill="url(#bg)" stroke="none"/>
  <rect width="100" height="100" rx="${radius}" fill="url(#glow)" stroke="none"/>
  <g transform="translate(${offset} ${offset}) scale(${k})">
    <g filter="url(#shadow)">
      <g transform="rotate(-5 50 60) translate(-4 9) scale(0.88)">
        <g mask="url(#fade)"><path d="${HAND}" fill="url(#skin)" stroke="none"/></g>
        <g fill="none" stroke="#8e8e93" stroke-width="1.5" stroke-linecap="round">${CREASES.map((d) => `<path d="${d}"/>`).join("")}</g>
      </g>
    </g>
    <g transform="translate(86.7 42.1)"><circle r="6" fill="none" stroke="#30d158" stroke-width="2.8"/><circle r="1.7" fill="#30d158" stroke="none"/></g>
  </g>
  ${radius ? `<rect x="0.4" y="0.4" width="99.2" height="99.2" rx="${radius - 0.4}" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="0.8"/>` : ""}
</svg>
`;
}
