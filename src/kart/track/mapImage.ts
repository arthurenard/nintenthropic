/**
 * A top-down picture of a track as an SVG, for designing and checking it:
 * the road with its width, kerbs on the tight bends, the start line, ramps,
 * open edges (red), gaps (the road missing), verges, patches of ice, mud and
 * boost strip, hazards (with their paths), item rows, boost pads, landmarks
 * by name, and the duck; under it, the road's height along the lap (steep
 * stretches in red, crests sharp enough to fly over marked) and its lean.
 *
 * Drawn the way the minimap draws: north (+z) up the page and +x to the left,
 * the world as seen from above, so a right turn on the road turns right on
 * the page. Pure string-building: no DOM, no files (the test writes them).
 */
import { TrackGeometry, type Landmark, type Surface, type TrackDef } from "./geometry";
import { hazardAt } from "./hazards";

export interface MapOptions {
  /** Width and height of the picture in pixels (default 1100). */
  size?: number;
  /** A lap time to print (seconds), if known. */
  lapTime?: number;
}

const GROUND_COLOUR: Record<Surface | "grass", string> = {
  grass: "#3f7d3a",
  sand: "#c9a45a",
  snow: "#dbe9f5",
  ice: "#7fd3f0",
  mud: "#6b4a2b",
  boost: "#c8f21f",
};

const THEME_BACKGROUND: Record<string, string> = {
  meadow: "#cfe7b8",
  canyon: "#e6c9a0",
  harbour: "#1c2a3d",
  kitchen: "#f0e2c6",
  snow: "#cdd9e6",
  volcano: "#241816",
  funfair: "#241a3a",
  space: "#0b0f24",
  palm: "#bfe6df",
};

const DARK_THEMES = new Set(["harbour", "volcano", "funfair", "space"]);

const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The SVG of `def`. */
export function trackMapSvg(def: TrackDef, options: MapOptions = {}): string {
  const geo = TrackGeometry.build(def);
  const size = options.size ?? 1100;
  const dark = DARK_THEMES.has(def.theme);
  const ink = dark ? "#f2f4f8" : "#1b2230";
  const background = THEME_BACKGROUND[def.theme] ?? "#dddddd";
  const road = dark ? "#4b5568" : "#59606c";

  // Bounds, over the road and everything placed beside it.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const extend = (x: number, z: number, pad = 0) => {
    minX = Math.min(minX, x - pad);
    maxX = Math.max(maxX, x + pad);
    minZ = Math.min(minZ, z - pad);
    maxZ = Math.max(maxZ, z + pad);
  };
  for (const c of geo.samples) extend(c.x, c.z, c.width / 2 + 10);
  const landmarkPoint = (l: Landmark) => geo.point(l.at * geo.length, l.offset);
  for (const l of def.landmarks ?? []) {
    const p = landmarkPoint(l);
    extend(p.x, p.z, 12);
  }
  for (const rr of geo.routes) {
    for (const c of rr.samples) extend(c.x, c.z, c.width / 2 + 10);
    for (const l of rr.def.landmarks ?? []) {
      const p = rr.point(l.at * geo.length, l.offset);
      extend(p.x, p.z, 12);
    }
  }
  const header = 92;
  const margin = 26;
  /** The strip under the map: the height profile and the lean. */
  const footer = 150;
  const scale = Math.min((size - margin * 2) / (maxX - minX), (size - footer - header) / (maxZ - minZ));
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const px = (x: number) => size / 2 - (x - cx) * scale;
  const py = (z: number) => header + (size - header - footer) / 2 - (z - cz) * scale;
  const at = (s: number, offset: number): string => {
    const p = geo.point(s, offset);
    return `${px(p.x).toFixed(1)},${py(p.z).toFixed(1)}`;
  };
  const step = 2;
  const samples: number[] = [];
  for (let s = 0; s < geo.length; s += step) samples.push(s);
  samples.push(geo.length);

  /** A closed polygon between offsets `lo` and `hi` over the metres [from, to] (wrapping). */
  const band = (from: number, to: number, lo: (s: number) => number, hi: (s: number) => number): string => {
    const len = geo.wrap(to - from) || geo.length;
    const n = Math.max(2, Math.ceil(len / step));
    const a: string[] = [];
    const b: string[] = [];
    for (let i = 0; i <= n; i++) {
      const s = from + (len * i) / n;
      a.push(at(s, lo(s)));
      b.push(at(s, hi(s)));
    }
    return [...a, ...b.reverse()].join(" ");
  };
  /** An open polyline at offset `off(s)` over [from, to]. */
  const line = (from: number, to: number, off: (s: number) => number): string => {
    const len = geo.wrap(to - from) || geo.length;
    const n = Math.max(2, Math.ceil(len / step));
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const s = from + (len * i) / n;
      pts.push(at(s, off(s)));
    }
    return pts.join(" ");
  };
  const half = (s: number) => geo.at(s).width / 2;
  const out: string[] = [];
  const push = (text: string) => out.push(text);

  // The gaps, in metres, so the road can be drawn around them.
  const gaps = (def.drops ?? []).filter((d) => d.gap).map((d) => ({ from: d.from * geo.length, to: d.to * geo.length }));
  const inGap = (s: number) => gaps.some((g) => (g.from <= g.to ? s >= g.from && s <= g.to : s >= g.from || s <= g.to));

  push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" font-family="Helvetica, Arial, sans-serif">`);
  push(`<rect width="${size}" height="${size}" fill="${background}"/>`);

  // Verges and the ground they cover.
  for (const v of def.verges ?? []) {
    const sign = v.side === "right" ? 1 : -1;
    const from = v.from * geo.length;
    const to = v.to * geo.length;
    const colour = GROUND_COLOUR[v.surface ?? "grass"];
    push(`<polygon points="${band(from, to, (s) => sign * half(s), (s) => sign * (half(s) + v.distance))}" fill="${colour}" opacity="0.55"/>`);
    push(`<polyline points="${line(from, to, (s) => sign * (half(s) + v.distance))}" fill="none" stroke="#e8890c" stroke-width="2" stroke-dasharray="7 4"/>`);
  }
  // Open edges: where there is nothing to stop a kart.
  for (const d of def.drops ?? []) {
    if (d.gap) continue;
    const from = d.from * geo.length;
    const to = d.to * geo.length;
    for (const sign of [-1, 1]) {
      if ((sign < 0 && d.side === "right") || (sign > 0 && d.side === "left")) continue;
      push(`<polygon points="${band(from, to, (s) => sign * half(s), (s) => sign * (half(s) + 7))}" fill="#e5334b" opacity="0.28"/>`);
    }
  }

  // The road, in pieces round the gaps.
  const pieces: [number, number][] = [];
  if (gaps.length === 0) {
    pieces.push([0, geo.length]);
  } else {
    let from = 0;
    const ordered = gaps.slice().sort((a, b) => a.from - b.from);
    for (const g of ordered) {
      if (g.from > from) pieces.push([from, g.from]);
      from = Math.max(from, g.to);
    }
    if (from < geo.length) pieces.push([from, geo.length]);
  }
  for (const [from, to] of pieces) {
    push(`<polygon points="${band(from, to, (s) => -half(s), (s) => half(s))}" fill="${road}" stroke="${dark ? "#cfd6e4" : "#ffffff"}" stroke-width="1.2" stroke-linejoin="round"/>`);
  }
  for (const g of gaps) {
    push(`<polygon points="${band(g.from, g.to, (s) => -half(s) - 3, (s) => half(s) + 3)}" fill="#e5334b" opacity="0.55"/>`);
    push(`<polygon points="${band(g.from, g.to, (s) => -half(s) - 3, (s) => half(s) + 3)}" fill="none" stroke="#e5334b" stroke-width="2" stroke-dasharray="4 3"/>`);
  }

  // Patches across the road.
  for (const patch of def.surfaces ?? []) {
    const middle = patch.offset ?? 0;
    const w = patch.width ?? 1e6;
    const lo = (s: number) => Math.max(-half(s), middle - w / 2);
    const hi = (s: number) => Math.min(half(s), middle + w / 2);
    push(`<polygon points="${band(patch.from * geo.length, patch.to * geo.length, lo, hi)}" fill="${GROUND_COLOUR[patch.kind]}" opacity="0.85"/>`);
  }

  // The centre line, dashed.
  push(`<polyline points="${line(0, geo.length, () => 0)}" fill="none" stroke="${dark ? "#e8edf6" : "#f6f6f2"}" stroke-width="1" stroke-dasharray="10 12" opacity="0.7"/>`);

  // Kerbs on the outside of the tight bends (red and white).
  for (let s = 0; s < geo.length; s += 3) {
    const c = geo.at(s);
    if (Math.abs(c.curvature) < 1 / 45) continue;
    const outer = c.curvature > 0 ? -1 : 1;
    const odd = Math.floor(s / 3) % 2 === 0;
    push(`<polyline points="${at(s, outer * c.width / 2)} ${at(s + 3, outer * (geo.at(s + 3).width / 2))}" stroke="${odd ? "#e5334b" : "#ffffff"}" stroke-width="3" fill="none"/>`);
  }

  // Direction arrows, every 120 m or so.
  for (let s = 40; s < geo.length - 20; s += 120) {
    if (inGap(s)) continue;
    const c = geo.at(s);
    const a = geo.point(s, 0);
    const tip = { x: px(a.x - c.tx * -5), z: py(a.z - c.tz * -5) };
    const base = { x: px(a.x - c.tx * 4), z: py(a.z - c.tz * 4) };
    const wing = (sign: number) => `${px(a.x - c.tx * 1 - c.tz * sign * 3.2).toFixed(1)},${py(a.z - c.tz * 1 + c.tx * sign * 3.2).toFixed(1)}`;
    push(`<polygon points="${tip.x.toFixed(1)},${tip.z.toFixed(1)} ${wing(1)} ${base.x.toFixed(1)},${base.z.toFixed(1)} ${wing(-1)}" fill="#ffffff" opacity="0.8"/>`);
  }

  // The start line.
  {
    const s0 = geo.at(0);
    const w = s0.width / 2;
    push(`<polyline points="${at(0, -w)} ${at(0, w)}" stroke="#ffffff" stroke-width="5" stroke-dasharray="4 4"/>`);
    push(`<polyline points="${at(0, -w)} ${at(0, w)}" stroke="#111" stroke-width="5" stroke-dasharray="4 4" stroke-dashoffset="4"/>`);
    const p = geo.point(0, w + 2);
    push(`<text x="${px(p.x) + 8}" y="${py(p.z) + 4}" font-size="13" font-weight="700" fill="${ink}">START</text>`);
  }

  // The alternate routes: the branch road over the main road's map, with what it adds.
  for (const rr of geo.routes) {
    const rdef = rr.routeDef;
    const colour = rdef.kind === "shortcut" ? "#ff9f0a" : "#30b0c7";
    const rhalf = (s: number) => rr.at(s).width / 2;
    const rat = (s: number, offset: number): string => {
      const p = rr.point(s, offset);
      return `${px(p.x).toFixed(1)},${py(p.z).toFixed(1)}`;
    };
    const rband = (from: number, to: number, lo: (s: number) => number, hi: (s: number) => number): string => {
      const n = Math.max(2, Math.ceil((to - from) / step));
      const a: string[] = [];
      const b: string[] = [];
      for (let i = 0; i <= n; i++) {
        const s = from + ((to - from) * i) / n;
        a.push(rat(s, lo(s)));
        b.push(rat(s, hi(s)));
      }
      return [...a, ...b.reverse()].join(" ");
    };
    push(`<polygon points="${rband(rr.from, rr.to, (s) => -rhalf(s), (s) => rhalf(s))}" fill="${dark ? "#586478" : "#6b7280"}" stroke="${colour}" stroke-width="2.2" stroke-linejoin="round"/>`);
    for (const d of rr.def.drops ?? []) {
      for (const sign of [-1, 1]) {
        if (d.gap || (sign < 0 && d.side === "right") || (sign > 0 && d.side === "left")) continue;
        push(`<polygon points="${rband(d.from * geo.length, d.to * geo.length, (s) => sign * rhalf(s), (s) => sign * (rhalf(s) + 6))}" fill="#e5334b" opacity="0.28"/>`);
      }
    }
    {
      const n = Math.max(2, Math.ceil((rr.to - rr.from) / step));
      const pts: string[] = [];
      for (let i = 0; i <= n; i++) pts.push(rat(rr.from + ((rr.to - rr.from) * i) / n, 0));
      push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#f6f6f2" stroke-width="1" stroke-dasharray="8 10" opacity="0.8"/>`);
    }
    for (const pad of rr.def.boostPads ?? []) {
      const s = pad.at * geo.length;
      push(`<polygon points="${rband(s - 3.5, s + 3.5, () => pad.offset - 3, () => pad.offset + 3)}" fill="${GROUND_COLOUR.boost}" stroke="#4a5a00" stroke-width="1"/>`);
    }
    for (const ramp of rr.def.ramps ?? []) {
      const s = ramp.at * geo.length;
      push(`<polygon points="${rband(s - 8, s, (x) => -rhalf(x), (x) => rhalf(x))}" fill="#ffd60a" opacity="0.85" stroke="#8a6d00" stroke-width="1"/>`);
    }
    for (const h of rr.def.hazards ?? []) {
      const first = hazardAt(rr, h, 0);
      push(`<circle cx="${px(first.x).toFixed(1)}" cy="${py(first.z).toFixed(1)}" r="${Math.max(4, h.radius * scale).toFixed(1)}" fill="#ff6a00" opacity="0.85" stroke="#fff" stroke-width="1.5"/>`);
      push(`<text x="${(px(first.x) + 7).toFixed(1)}" y="${(py(first.z) - 6).toFixed(1)}" font-size="11" font-weight="700" fill="#ff6a00" stroke="${background}" stroke-width="3" paint-order="stroke">${esc(h.kind)}</text>`);
    }
    for (const l of rr.def.landmarks ?? []) {
      const s = l.at * geo.length;
      const p = rr.point(s, l.offset);
      if (l.span) push(`<polygon points="${rband(s - l.span / 2, s + l.span / 2, (x) => -rhalf(x) - 2, (x) => rhalf(x) + 2)}" fill="#8b5cf6" opacity="0.5" stroke="#5b2fd0" stroke-width="1.5"/>`);
      push(`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.z).toFixed(1)}" r="${l.span ? 3 : 5}" fill="#5b2fd0" stroke="#fff" stroke-width="1.5"/>`);
      push(`<text x="${(px(p.x) + 7).toFixed(1)}" y="${(py(p.z) + 4).toFixed(1)}" font-size="11" fill="${ink}" stroke="${background}" stroke-width="3" paint-order="stroke">${esc(l.kind)}</text>`);
    }
    const mid = rr.point((rr.from + rr.to) / 2, rhalf((rr.from + rr.to) / 2) + 5);
    push(`<text x="${(px(mid.x) + 4).toFixed(1)}" y="${(py(mid.z) + 4).toFixed(1)}" font-size="12" font-weight="700" fill="${colour}" stroke="${background}" stroke-width="3" paint-order="stroke">${esc(rdef.id)} (${rdef.kind}, ${Math.round(rr.realLength)} m for ${Math.round(rr.span)})</text>`);
  }

  // Distance marks every 100 m along the lap, to read positions off.
  for (let s = 100; s < geo.length - 30; s += 100) {
    const p = geo.point(s, half(s) + 3.5);
    push(`<text x="${(px(p.x) - 8).toFixed(1)}" y="${(py(p.z) + 4).toFixed(1)}" font-size="10" fill="${ink}" opacity="0.65" stroke="${background}" stroke-width="2.5" paint-order="stroke">${s}</text>`);
  }

  // Boost pads and item rows, sized and spaced as the sim lays them (TUNING.boost.padHalfLength and padHalfWidth,
  // TUNING.items.rowSpread and boxesPerRow): the track's files do not import the sim, so the numbers are copied here.
  for (const pad of def.boostPads ?? []) {
    const s = pad.at * geo.length;
    push(`<polygon points="${band(s - 3.5, s + 3.5, () => pad.offset - 3.2, () => pad.offset + 3.2)}" fill="${GROUND_COLOUR.boost}" stroke="#4a5a00" stroke-width="1"/>`);
  }
  for (const row of def.itemRows) {
    const s = row * geo.length;
    const w = geo.at(s).width * 0.68;
    for (let k = 0; k < 5; k++) {
      const o = (k - 2) * (w / 4);
      const p = geo.point(s, o);
      push(`<rect x="${(px(p.x) - 4).toFixed(1)}" y="${(py(p.z) - 4).toFixed(1)}" width="8" height="8" fill="#ffb020" stroke="#7a4a00" stroke-width="1" transform="rotate(45 ${px(p.x).toFixed(1)} ${py(p.z).toFixed(1)})"/>`);
    }
  }

  // Ramps.
  for (const ramp of def.ramps ?? []) {
    const s = ramp.at * geo.length;
    push(`<polygon points="${band(s - 8, s, (x) => -half(x), (x) => half(x))}" fill="#ffd60a" opacity="0.8" stroke="#8a6d00" stroke-width="1"/>`);
    const p = geo.point(s, half(s) + 4);
    push(`<text x="${px(p.x) + 3}" y="${py(p.z) + 4}" font-size="12" font-weight="700" fill="#b88700" stroke="${background}" stroke-width="3" paint-order="stroke">ramp${ramp.trick === false ? "" : " *"}</text>`);
  }

  // Hazards: their paths in orange, and a ring where each is at time 0.
  for (const h of def.hazards ?? []) {
    const path: string[] = [];
    for (let i = 0; i <= 48; i++) {
      const pose = hazardAt(geo, h, (i / 48) * h.period - (h.phase ?? 0) * h.period);
      path.push(`${px(pose.x).toFixed(1)},${py(pose.z).toFixed(1)}`);
    }
    push(`<polyline points="${path.join(" ")}" fill="none" stroke="#ff6a00" stroke-width="2.5" stroke-dasharray="3 3"/>`);
    const first = hazardAt(geo, h, 0);
    push(`<circle cx="${px(first.x).toFixed(1)}" cy="${py(first.z).toFixed(1)}" r="${Math.max(4, h.radius * scale).toFixed(1)}" fill="#ff6a00" opacity="0.85" stroke="#fff" stroke-width="1.5"/>`);
    push(`<text x="${(px(first.x) + 7).toFixed(1)}" y="${(py(first.z) - 6).toFixed(1)}" font-size="11" font-weight="700" fill="#ff6a00" stroke="${background}" stroke-width="3" paint-order="stroke">${esc(h.kind)}</text>`);
  }

  // Landmarks: a dot, a bar across the road for a span, a name.
  for (const l of def.landmarks ?? []) {
    const s = l.at * geo.length;
    const p = geo.point(s, l.offset);
    if (l.span) {
      push(`<polygon points="${band(s - l.span / 2, s + l.span / 2, (x) => -half(x) - 2, (x) => half(x) + 2)}" fill="#8b5cf6" opacity="0.5" stroke="#5b2fd0" stroke-width="1.5"/>`);
    }
    push(`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.z).toFixed(1)}" r="${l.span ? 3 : 5}" fill="#5b2fd0" stroke="#fff" stroke-width="1.5"/>`);
    push(`<text x="${(px(p.x) + 7).toFixed(1)}" y="${(py(p.z) + 4).toFixed(1)}" font-size="11" fill="${ink}" stroke="${background}" stroke-width="3" paint-order="stroke">${esc(l.kind)}</text>`);
  }

  // The duck.
  if (def.duck) {
    const p = geo.point(def.duck.at * geo.length, def.duck.offset);
    push(`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.z).toFixed(1)}" r="8" fill="#ffd60a" stroke="#6b4e00" stroke-width="2"/>`);
    push(`<text x="${(px(p.x) + 11).toFixed(1)}" y="${(py(p.z) + 4).toFixed(1)}" font-size="12" font-weight="700" fill="${ink}" stroke="${background}" stroke-width="3" paint-order="stroke">duck</text>`);
  }

  // The height along the lap, and the lean.
  push(profileSvg(geo, { x: margin, y: size - footer + 12, width: size - margin * 2, height: footer - 40 }, ink, background));

  // Scale bar and the header.
  const bar = 100 * scale;
  push(`<line x1="${margin}" y1="${size - footer}" x2="${margin + bar}" y2="${size - footer}" stroke="${ink}" stroke-width="3"/>`);
  push(`<text x="${margin + bar + 8}" y="${size - footer + 5}" font-size="12" fill="${ink}">100 m</text>`);
  const lap = options.lapTime ? `  ·  lap ${options.lapTime.toFixed(0)} s` : "";
  push(`<text x="${margin}" y="34" font-size="26" font-weight="700" fill="${ink}">${esc(def.name)}${def.secret ? " (secret)" : ""}</text>`);
  push(`<text x="${margin}" y="56" font-size="14" fill="${ink}">${def.theme}  ·  ${geo.length.toFixed(0)} m  ·  road ${def.width} m  ·  ${def.laps} laps${lap}</text>`);
  push(`<text x="${margin}" y="76" font-size="12" fill="${ink}" opacity="0.8">${esc(def.blurb ?? "")}</text>`);
  // Legend.
  const legend: [string, string][] = [
    ["#e5334b", "open edge / gap"],
    ["#e8890c", "verge barrier"],
    ["#ffd60a", "ramp (* trick)"],
    ["#ff6a00", "hazard path"],
    ["#5b2fd0", "landmark"],
    ["#ffb020", "item row"],
  ];
  legend.forEach(([colour, label], i) => {
    const x = size - 170;
    const y = 30 + i * 17;
    push(`<rect x="${x}" y="${y - 9}" width="12" height="12" fill="${colour}"/>`);
    push(`<text x="${x + 18}" y="${y + 1}" font-size="12" fill="${ink}">${label}</text>`);
  });
  push("</svg>");
  return out.join("\n");
}

/** How steep counts as steep on the profile (a rise of 8 m in 100). */
const STEEP = 0.08;
/** A crest whose road turns down faster than this (1/m: a radius of 60 m) throws a kart at top speed into the air. */
const FLYING_CREST = 1 / 60;

/**
 * The road's height along the lap as a strip: the profile (red where it climbs or falls more than 8%), a mark on every
 * crest sharp enough to fly over at speed, the lowest and highest point, and under it the road's lean (blue: the right side
 * low, orange: the left; the taller, the steeper).
 */
function profileSvg(geo: TrackGeometry, box: { x: number; y: number; width: number; height: number }, ink: string, background: string): string {
  const out: string[] = [];
  const step = 2;
  const ys: number[] = [];
  for (let s = 0; s <= geo.length; s += step) ys.push(geo.at(s).y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const leanHeight = 22;
  const plotHeight = box.height - leanHeight - 6;
  const range = Math.max(4, hi - lo);
  const sx = (s: number) => box.x + (s / geo.length) * box.width;
  const sy = (y: number) => box.y + plotHeight - ((y - lo) / range) * plotHeight;
  out.push(`<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${plotHeight}" fill="${ink}" opacity="0.06"/>`);
  const area = ys.map((y, k) => `${sx(k * step).toFixed(1)},${sy(y).toFixed(1)}`);
  out.push(`<polygon points="${sx(0).toFixed(1)},${box.y + plotHeight} ${area.join(" ")} ${sx((ys.length - 1) * step).toFixed(1)},${box.y + plotHeight}" fill="${ink}" opacity="0.14"/>`);
  for (let k = 0; k + 1 < ys.length; k++) {
    const grade = Math.abs(ys[k + 1]! - ys[k]!) / step;
    const colour = grade > STEEP ? "#e5334b" : ink;
    out.push(`<line x1="${sx(k * step).toFixed(1)}" y1="${sy(ys[k]!).toFixed(1)}" x2="${sx((k + 1) * step).toFixed(1)}" y2="${sy(ys[k + 1]!).toFixed(1)}" stroke="${colour}" stroke-width="2"/>`);
  }
  // Crests: where the road bends down over a few metres faster than a kart at speed can follow.
  for (let s = 6; s < geo.length - 6; s += 2) {
    const bend = (geo.at(s + 6).y - 2 * geo.at(s).y + geo.at(s - 6).y) / 36;
    const prev = (geo.at(s + 4).y - 2 * geo.at(s - 2).y + geo.at(s - 8).y) / 36;
    const next = (geo.at(s + 8).y - 2 * geo.at(s + 2).y + geo.at(s - 4).y) / 36;
    if (bend < -FLYING_CREST && bend <= prev && bend <= next) {
      out.push(`<circle cx="${sx(s).toFixed(1)}" cy="${(sy(geo.at(s).y) - 6).toFixed(1)}" r="4" fill="#ffd60a" stroke="#8a6d00" stroke-width="1"/>`);
    }
  }
  out.push(`<text x="${box.x + 4}" y="${box.y + 12}" font-size="11" fill="${ink}" stroke="${background}" stroke-width="3" paint-order="stroke">height ${lo.toFixed(1)} to ${hi.toFixed(1)} m (red: steeper than ${STEEP * 100}%, dot: a crest to fly over)</text>`);
  // The lean: + (blue) the right side low, - (orange) the left.
  const mid = box.y + plotHeight + 6 + leanHeight / 2;
  out.push(`<line x1="${box.x}" y1="${mid}" x2="${box.x + box.width}" y2="${mid}" stroke="${ink}" stroke-width="0.6" opacity="0.5"/>`);
  for (let s = 0; s < geo.length; s += 4) {
    const c = geo.at(s);
    const roll = Math.max(-0.35, Math.min(0.35, c.bank + (geo.def.bank ?? 0) * c.curvature));
    if (Math.abs(roll) < 0.01) continue;
    const h = (roll / 0.35) * (leanHeight / 2);
    out.push(`<rect x="${sx(s).toFixed(1)}" y="${(h > 0 ? mid - h : mid).toFixed(1)}" width="${Math.max(1, (4 / geo.length) * box.width).toFixed(1)}" height="${Math.abs(h).toFixed(1)}" fill="${roll > 0 ? "#0a84ff" : "#ff9f0a"}"/>`);
  }
  out.push(`<text x="${box.x + 4}" y="${mid + leanHeight / 2 + 12}" font-size="11" fill="${ink}" opacity="0.8">lean (blue: right side low, orange: left)  ·  s along the lap, 0 to ${geo.length.toFixed(0)} m</text>`);
  return out.join("\n");
}
