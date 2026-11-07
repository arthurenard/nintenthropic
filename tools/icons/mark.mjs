// The mark of Nintenthropic: a white tile, an orange-red ring and a black serif "N",
// the wordmark's own language (the white pill, the orange-red ring, the black serif).
// Pure vector, on a 100 grid. tools/icons/render.mjs writes the app icons from it.

/** The ring: its centre, radius and weight. */
const C = 50;
const RING_R = 35;
const RING_W = 7;
/** The wordmark's ring orange. */
const RING = "#e1501b";

/**
 * The old sight's measures, kept only for the trailer's cards (tools/trailer/cards/), which draw
 * that sight themselves. The app icon is no longer the sight.
 */
export const SIGHT = { C: 50, RING_R: 23, RING_W: 6.5, TICK_LEN: 9.5, TICK_W: 6, DOT_R: 4.6 };

/**
 * The serif N, as one set of shapes on the 100 grid: a thin left stem with serifs top and bottom,
 * a thick diagonal, a thin right stem with a serif on top. Cap height 34, centred.
 */
const N = [
  "M27 33H44V35.6H27Z", // top-left serif
  "M33.2 33H37.2V67H33.2Z", // left stem
  "M27 64.4H44V67H27Z", // bottom-left serif
  "M33.2 33H42.4L67 67H57.6Z", // the thick diagonal
  "M63.4 33H67V67H63.4Z", // right stem
  "M58 33H72V35.6H58Z", // top-right serif
]
  .map((d) => `<path d="${d}"/>`)
  .join("");

/**
 * The mark as an SVG document.
 * @param {{ shape?: "rounded" | "square", inset?: number }} options
 *   shape: a rounded square with clear corners (web icons), or
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
    <clipPath id="shape"><rect width="100" height="100" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="100" height="100" fill="#fff"/>
    <g transform="translate(${offset} ${offset}) scale(${k})">
      <circle cx="${C}" cy="${C}" r="${RING_R}" fill="none" stroke="${RING}" stroke-width="${RING_W}"/>
      <g fill="#0a0a0a">${N}</g>
    </g>
  </g>
  ${radius ? `<rect x="0.4" y="0.4" width="99.2" height="99.2" rx="${radius - 0.4}" fill="none" stroke="#000" stroke-opacity="0.12" stroke-width="0.8"/>` : ""}
</svg>
`;
}
