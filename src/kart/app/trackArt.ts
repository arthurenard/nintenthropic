/**
 * The pictures of the tracks the menus show: a postcard for each
 * (assets/kart/tracks/<id>.webp, 960 x 540) in the lobby's carousel, on the
 * cup cards and behind the loading screen and the results.
 *
 * Until a postcard is drawn, or where it never comes (a track whose art is not
 * rendered yet), the track is its own picture: its outline, from the same
 * TrackGeometry the sim drives on, in white over the colours of its world, with
 * a flag at the start line. The postcard fades in over it when it arrives, so
 * a card never changes size or goes blank.
 */
import { TrackGeometry, type TrackDef, type TrackTheme } from "../track/geometry";
import { CUPS, trackById } from "../track/tracks";

/** Where a track's postcard is, relative to the page. */
export const postcardUrl = (id: string): string => `assets/kart/tracks/${id}.webp`;

/** Each world's sky and ground, top and foot of the card: the colours its outline stands on. */
export const THEME_COLOURS: Record<TrackTheme, readonly [string, string]> = {
  meadow: ["#4aa0f0", "#79cf5c"],
  canyon: ["#f4b373", "#c2622f"],
  harbour: ["#10305e", "#2f78ac"],
  kitchen: ["#f8dfae", "#e4a064"],
  snow: ["#d6ebfd", "#86b5e6"],
  volcano: ["#40160f", "#e5592a"],
  funfair: ["#3f1f78", "#ff74b8"],
  space: ["#080c26", "#5f31a6"],
  palm: ["#52d4c8", "#f6e3a0"],
};

/** The picture's own size: its outline is drawn in a box of this many units (16 x 9, like a postcard). */
export const OUTLINE_BOX = { width: 160, height: 90 } as const;

/** Where in the box the outline goes: the upper part, leaving the foot clear for a name written over the picture. */
export const OUTLINE_AREA = { x: 0, y: 3, width: 160, height: 66 } as const;

export interface Outline {
  /** An SVG path (M, L, Z) in OUTLINE_BOX units. */
  d: string;
  /** The start line: where, and which way the cars go (degrees, 0 pointing right, clockwise on the page). */
  start: { x: number; y: number; angle: number };
  /** Metres of road to one unit of the box (what the road's width becomes). */
  scale: number;
}

const cache = new Map<string, Outline>();

/**
 * The track's outline fitted to an area of the picture (the upper part of 160 x 90) with `pad` units
 * clear all round, drawn the way the minimap draws it: north (+z) up the
 * page and +x to the left, the world as seen from above, so a right turn on
 * the road turns right on the card.
 */
export function trackOutline(def: TrackDef, pad = 10, box: { x: number; y: number; width: number; height: number } = OUTLINE_AREA): Outline {
  const key = `${def.id}|${pad}|${box.x},${box.y},${box.width}x${box.height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const geometry = TrackGeometry.build(def, 3);
  const points = geometry.samples.map((sample) => [-sample.x, -sample.z] as const);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const scale = Math.min((box.width - pad * 2) / Math.max(1, maxX - minX), (box.height - pad * 2) / Math.max(1, maxY - minY));
  const offsetX = box.x + (box.width - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = box.y + (box.height - (maxY - minY) * scale) / 2 - minY * scale;
  const at = (x: number, y: number) => [x * scale + offsetX, y * scale + offsetY] as const;
  const round = (n: number) => Math.round(n * 10) / 10;
  const d =
    points
      .map(([x, y], i) => {
        const [px, py] = at(x, y);
        return `${i === 0 ? "M" : "L"}${round(px)} ${round(py)}`;
      })
      .join("") + "Z";
  const first = geometry.samples[0]!;
  const [sx, sy] = at(-first.x, -first.z);
  // The page's direction of travel: x is flipped and z is up, so (tx, tz) becomes (-tx, -tz) in page units.
  const angle = (Math.atan2(-first.tz, -first.tx) * 180) / Math.PI;
  const outline: Outline = { d, start: { x: round(sx), y: round(sy), angle: round(angle) }, scale };
  cache.set(key, outline);
  return outline;
}

const SVG = "http://www.w3.org/2000/svg";

/** The track drawn as a picture: its outline in white on its world's colours, the start line marked. */
export function outlinePicture(def: TrackDef, className = "outline-art"): SVGSVGElement {
  const outline = trackOutline(def);
  const [sky, ground] = THEME_COLOURS[def.theme];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${OUTLINE_BOX.width} ${OUTLINE_BOX.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  svg.style.setProperty("--sky", sky);
  svg.style.setProperty("--ground", ground);
  const make = (name: string, attrs: Record<string, string>) => {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  // The world's colours are the card's own background (a gradient in a hidden svg would not draw where it is used again).
  svg.style.background = `linear-gradient(180deg, ${sky}, ${ground})`;
  // A soft glow of light in the sky's corner, then the road: a dark edge under a white line, so it reads on any colour.
  svg.append(make("circle", { cx: "132", cy: "16", r: "46", fill: "rgba(255,255,255,0.22)" }));
  const road = Math.max(2.4, Math.min(4.2, def.width * outline.scale * 0.95));
  svg.append(
    make("path", { d: outline.d, fill: "none", stroke: "rgba(0,0,0,0.28)", "stroke-width": String(road + 2.4), "stroke-linejoin": "round", "stroke-linecap": "round" }),
    make("path", { d: outline.d, fill: "none", stroke: "#ffffff", "stroke-width": String(road), "stroke-linejoin": "round", "stroke-linecap": "round" }),
  );
  const { x, y, angle } = outline.start;
  const flag = make("g", { transform: `translate(${x} ${y}) rotate(${angle + 90})` });
  flag.append(
    make("rect", { x: "-4.2", y: "-1.5", width: "8.4", height: "3", rx: "0.6", fill: "#0b1f4d", stroke: "#fff", "stroke-width": "0.7" }),
    make("rect", { x: "-4.2", y: "-1.5", width: "2.1", height: "1.5", fill: "#fff" }),
    make("rect", { x: "0", y: "-1.5", width: "2.1", height: "1.5", fill: "#fff" }),
    make("rect", { x: "-2.1", y: "0", width: "2.1", height: "1.5", fill: "#fff" }),
    make("rect", { x: "2.1", y: "0", width: "2.1", height: "1.5", fill: "#fff" }),
  );
  svg.append(flag);
  return svg;
}

/**
 * A track's postcard: the outline underneath, and over it the rendered
 * picture once it has come (it fades in; if it never does, the outline is the
 * picture). The box keeps the postcard's own shape, 16 x 9.
 */
export function postcard(id: string, className = "postcard-art"): HTMLElement {
  const def = trackById(id);
  const box = document.createElement("span");
  box.className = className;
  box.append(outlinePicture(def));
  const image = document.createElement("img");
  image.alt = "";
  image.width = 960;
  image.height = 540;
  image.decoding = "async";
  image.loading = "lazy";
  image.className = "postcard-image";
  image.addEventListener("load", () => image.classList.add("ready"));
  image.addEventListener("error", () => image.remove());
  image.src = postcardUrl(id);
  box.append(image);
  return box;
}

/** Which cup a track is in, and which race of it (1-based); the secret track is in none. */
export function cupOfTrack(id: string): { cup: string; race: number } | null {
  for (const cup of CUPS) {
    const at = cup.tracks.indexOf(id);
    if (at >= 0) return { cup: cup.name, race: at + 1 };
  }
  return null;
}
