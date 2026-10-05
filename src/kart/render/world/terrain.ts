/**
 * The ground under and around the track: a height field built from the
 * track's own heights, so a road that climbs a hill sits on an embankment
 * instead of floating over a flat plane.
 *
 * Close to the road the ground follows the nearest stretch of road exactly
 * (a little below it, so the verge strip lies on top without a crack). Farther
 * out it relaxes to the theme's landscape: rolling hills in the meadow, stepped
 * canyon walls, a quay that ends in water at the harbour; a flat marble
 * counter, snowfields under mountains, black basalt among rivers of lava, a
 * fairground, a sandy island in a turquoise sea. Everything is computed from
 * distance to the centre line, so it is continuous even where two parts of
 * the track run side by side.
 *
 * Where a track leaves an edge open (a drop) the ground on that side falls
 * away to the world's floor: the counter's edge with the room far below, a
 * crevasse, a lake of lava. Space has no ground at all; the terrain is still
 * built there (the scenery asks it where things are) but never drawn.
 */
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import type { TrackGeometry } from "../../track/geometry";
import { clamp, fbm2, lerp, noise2, smoothstep } from "../math";
import { mixRgb, rgb, scaleRgb, type Rgb } from "./builder";
import { analyseFeatures, DROP_DEPTH, DROP_REACH, type Features } from "./features";
import type { ThemeStyle } from "./themes";

/** How far below the road the ground sits next to it, so the verge ribbon covers it cleanly. */
export const GROUND_SINK = 0.7;
/** The harbour's water level. */
export const WATER_LEVEL = -1.5;
/** The palm island's sea level, and the volcano's lava (relative to the ground beside it). */
export const SEA_LEVEL = -0.9;
export const LAVA_DEPTH = 2.2;

export interface GroundInfo {
  /** Distance to the nearest centre-line sample, metres. */
  d: number;
  /** Distance beyond the road's edge there (negative on the road). */
  edge: number;
  /** The road's own height at the nearest sample. */
  roadY: number;
  /** The smoothed height of the roads around, for hills that follow them. */
  level: number;
  /** s of the nearest sample. */
  s: number;
  /** Index of the nearest sample. */
  i: number;
  /** Metres right of the centre line there (negative: left). */
  lateral: number;
}

interface Palette {
  stops: Rgb[];
}

function strata(hexes: string[]): Palette {
  return { stops: hexes.map(rgb) };
}

export class Terrain {
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;
  /** Distance beyond the road's edge at each grid vertex (negative on the road). */
  readonly edges: Float32Array;
  readonly colours: Float32Array;
  /** Self-lit glow, 0..1 per vertex (cracks and banks beside lava). */
  readonly glow: Float32Array;
  /** The volcano's lava: a surface height per vertex, or NaN where there is none. */
  readonly lavaY: Float32Array;
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;
  readonly features: Features;
  /** The world's floor under an open edge, relative to the road (negative). */
  readonly dropDepth: number;
  private anyLava = false;

  private constructor(
    readonly track: TrackGeometry,
    readonly style: ThemeStyle,
    minX: number,
    minZ: number,
    nx: number,
    nz: number,
    cell: number,
    features: Features,
  ) {
    this.minX = minX;
    this.minZ = minZ;
    this.nx = nx;
    this.nz = nz;
    this.cell = cell;
    this.features = features;
    this.dropDepth = -DROP_DEPTH[style.id];
    this.heights = new Float32Array(nx * nz);
    this.edges = new Float32Array(nx * nz);
    this.colours = new Float32Array(nx * nz * 3);
    this.glow = new Float32Array(nx * nz);
    this.lavaY = new Float32Array(nx * nz).fill(NaN);
  }

  get maxX(): number {
    return this.minX + (this.nx - 1) * this.cell;
  }

  get maxZ(): number {
    return this.minZ + (this.nz - 1) * this.cell;
  }

  get hasLava(): boolean {
    return this.anyLava;
  }

  static build(track: TrackGeometry, style: ThemeStyle, cell: number, features: Features = analyseFeatures(track)): Terrain {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const m = style.margin;
    minX -= m;
    maxX += m;
    minZ -= m;
    maxZ += m;
    const nx = Math.ceil((maxX - minX) / cell) + 1;
    const nz = Math.ceil((maxZ - minZ) / cell) + 1;
    const t = new Terrain(track, style, minX, minZ, nx, nz, cell, features);
    t.fill();
    return t;
  }

  /** Ground facts at a point, by brute force over the centre line. */
  info(x: number, z: number): GroundInfo {
    const samples = this.track.samples;
    const R = 28;
    const R2 = R * R;
    let best = Infinity;
    let bi = 0;
    let sumW = 0;
    let sumWY = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i]!;
      const dx = a.x - x;
      const dz = a.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
      if (d2 < R2 * 7 && (i & 1) === 0) {
        const w = Math.exp(-d2 / R2);
        sumW += w;
        sumWY += w * a.y;
      }
    }
    const near = samples[bi]!;
    const d = Math.sqrt(best);
    const lateral = (x - near.x) * -near.tz + (z - near.z) * near.tx;
    return { d, edge: d - near.width / 2, roadY: near.y, level: sumW > 1e-6 ? sumWY / sumW : near.y, s: near.s, i: bi, lateral };
  }

  private fill(): void {
    const { nx, nz, cell } = this;
    const cx = (this.minX + this.maxX) / 2;
    const cz = (this.minZ + this.maxZ) / 2;
    const hx = (this.maxX - this.minX) / 2;
    const hz = (this.maxZ - this.minZ) / 2;
    const info: GroundInfo[] = new Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = this.minX + i * cell;
        const z = this.minZ + j * cell;
        const g = this.info(x, z);
        info[j * nx + i] = g;
        this.edges[j * nx + i] = g.edge;
        const rim = Math.max(Math.abs(x - cx) / hx, Math.abs(z - cz) / hz);
        this.heights[j * nx + i] = this.heightOf(x, z, g, rim, j * nx + i);
      }
    }
    // Colour needs the slope, so a second pass.
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = this.minX + i * cell;
        const z = this.minZ + j * cell;
        const h = this.heights[j * nx + i]!;
        const hl = this.heights[j * nx + Math.max(0, i - 1)]!;
        const hr = this.heights[j * nx + Math.min(nx - 1, i + 1)]!;
        const hd = this.heights[Math.max(0, j - 1) * nx + i]!;
        const hu = this.heights[Math.min(nz - 1, j + 1) * nx + i]!;
        const slope = Math.hypot(hr - hl, hu - hd) / (2 * cell);
        const c = this.colourOf(x, z, h, slope, info[j * nx + i]!, [(hl - hr) / (2 * cell), (hd - hu) / (2 * cell)], j * nx + i);
        const o = (j * nx + i) * 3;
        this.colours[o] = c[0];
        this.colours[o + 1] = c[1];
        this.colours[o + 2] = c[2];
      }
    }
  }

  /** How open the ground on the side of `g.lateral` is at its nearest sample, 0..1, within the theme's reach. */
  private openness(g: GroundInfo): number {
    const f = this.features;
    if (!f.anyDrop) return 0;
    const raw = g.lateral < 0 ? f.dropLeft[g.i]! : f.dropRight[g.i]!;
    if (raw < 0.001) return 0;
    const reach = DROP_REACH[this.style.id];
    if (reach > 0) return raw * (1 - smoothstep(reach - 12, reach, g.edge));
    return raw;
  }

  private heightOf(x: number, z: number, g: GroundInfo, rim: number, idx: number): number {
    const near = g.roadY - GROUND_SINK;
    const e = g.edge;
    const follow = 1 - smoothstep(14, 80, e);
    let far: number;
    switch (this.style.id) {
      case "meadow": {
        const amp = 2.2 + 24 * smoothstep(50, 260, e);
        const hills = (fbm2(x / 95, z / 95, 4) - 0.42) * amp;
        const small = (fbm2(x / 24, z / 24, 2) - 0.5) * 1.6 * smoothstep(22, 70, e);
        far = lerp(hills + small, g.level - GROUND_SINK, follow);
        far += 85 * Math.pow(smoothstep(0.7, 1.0, rim), 1.6);
        break;
      }
      case "canyon": {
        const wall = smoothstep(46, 135, e);
        let h = 58 * wall * (0.5 + 0.95 * fbm2(x / 70, z / 70, 4));
        h += 9 * (fbm2(x / 26, z / 26, 3) - 0.4) * smoothstep(18, 80, e);
        // Terraces: the walls climb in steps, the way layered rock weathers.
        const step = 6.5;
        const t = h / step;
        const f = Math.floor(t);
        h = lerp(h, (f + smoothstep(0.3, 0.7, t - f)) * step, smoothstep(0, 0.25, wall));
        h += (fbm2(x / 38, z / 38, 3) - 0.45) * 2.4 * (1 - wall);
        far = lerp(h, g.level - GROUND_SINK, follow * (1 - wall * 0.6));
        far += 60 * Math.pow(smoothstep(0.78, 1.0, rim), 1.4);
        break;
      }
      case "harbour": {
        const quay = 48 + 80 * fbm2(x / 150, z / 150, 3) + 16 * (fbm2(x / 34, z / 34, 2) - 0.5);
        const level = lerp(0, g.level - GROUND_SINK, follow);
        const drop = smoothstep(quay, quay + 7, e);
        far = lerp(level, -3.6, drop);
        break;
      }
      case "kitchen": {
        // The counter: dead flat, only loosely following a road that climbs. Its far edge is a cliff to the room's floor.
        far = lerp(0, g.level - GROUND_SINK, follow);
        far = lerp(far, this.dropDepth - 8, smoothstep(0.935, 0.95, rim));
        break;
      }
      case "snow": {
        const amp = 2.2 + 26 * smoothstep(70, 280, e);
        const drifts = (fbm2(x / 100, z / 100, 4) - 0.42) * amp + (fbm2(x / 22, z / 22, 2) - 0.5) * 0.9 * smoothstep(20, 60, e);
        const ridge = 1 - Math.abs(2 * fbm2(x / 170 + 9, z / 170 - 4, 4) - 1);
        far = lerp(drifts, g.level - GROUND_SINK, follow);
        far += (60 + 150 * ridge) * Math.pow(smoothstep(0.62, 1.0, rim), 1.5);
        break;
      }
      case "volcano": {
        const rough = (fbm2(x / 55, z / 55, 4) - 0.45) * (1.2 + 15 * smoothstep(30, 220, e));
        const base = lerp(rough, g.level - GROUND_SINK, follow);
        const ridge = 1 - Math.abs(2 * fbm2(x / 150 + 3, z / 150 + 8, 4) - 1);
        let h = base + (50 + 120 * ridge) * Math.pow(smoothstep(0.7, 1.0, rim), 1.5);
        // Rivers of lava wind across the black rock, well away from the road; the bed is carved below a lava surface that follows the ground.
        const n = fbm2(x / 150 + 11, z / 150 - 5, 3);
        const dist = Math.abs(n - 0.5);
        const river = smoothstep(0.075, 0.02, dist) * smoothstep(20, 40, e) * (1 - smoothstep(0.6, 0.75, rim));
        if (river > 0.01) {
          this.lavaY[idx] = base - LAVA_DEPTH;
          this.anyLava = true;
          h -= river * 6.2;
        }
        far = h;
        break;
      }
      case "funfair": {
        const bumps = (fbm2(x / 70, z / 70, 3) - 0.5) * 3;
        far = lerp(bumps, g.level - GROUND_SINK, follow);
        far += 55 * Math.pow(smoothstep(0.74, 1.0, rim), 1.5);
        break;
      }
      case "space": {
        far = g.level - GROUND_SINK;
        break;
      }
      case "palm": {
        // An island that follows the road: land for a shore's width either side, then the beach shelves into the sea.
        const shore = 55 + 90 * fbm2(x / 110 + 4, z / 110 - 8, 3);
        const land = 1 - smoothstep(shore - 16, shore + 8, e);
        const dunes = 0.55 + 1.8 * fbm2(x / 42, z / 42, 3) * smoothstep(10, 40, e);
        const inland = lerp(dunes, g.level - GROUND_SINK, follow);
        const seabed = -4.8 + 1.2 * fbm2(x / 60, z / 60, 2);
        far = lerp(seabed, inland, land);
        break;
      }
    }
    let h = lerp(near, far, smoothstep(10, 26, e));
    // An open edge: beyond the centre line on that side the ground falls to the world's floor.
    const open = this.openness(g);
    if (open > 0) {
      const floor = g.roadY + this.dropDepth;
      if (this.style.id === "volcano") {
        // The floor is a lake of lava: the bed under it, the surface a little above.
        this.lavaY[idx] = g.roadY + this.dropDepth + 1.4;
        this.anyLava = true;
      }
      h = lerp(h, Math.min(h, floor), open);
    }
    return h;
  }

  private colourOf(x: number, z: number, h: number, slope: number, g: GroundInfo, grad: [number, number], idx: number): Rgb {
    const n = fbm2(x / 30, z / 30, 3);
    const speck = noise2(x / 5, z / 5);
    switch (this.style.id) {
      case "meadow": {
        const a = MEADOW.near;
        const b = MEADOW.far;
        let c = mixRgb(a, b, smoothstep(30, 200, g.edge));
        c = mixRgb(c, MEADOW.light, smoothstep(0.55, 0.85, n) * 0.55);
        c = mixRgb(c, MEADOW.dark, smoothstep(0.45, 0.2, n) * 0.5);
        c = mixRgb(c, MEADOW.rock, smoothstep(0.35, 0.9, slope) * 0.8);
        const k = 0.95 + speck * 0.1;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "canyon": {
        const band = h / 3.25 + fbm2(x / 50, z / 50, 2) * 2.2;
        const idxB = ((Math.floor(band) % CANYON.strata.stops.length) + CANYON.strata.stops.length) % CANYON.strata.stops.length;
        const rock = CANYON.strata.stops[idxB]!;
        const floor = mixRgb(CANYON.sand, CANYON.sandDark, smoothstep(0.35, 0.75, n));
        const wallness = smoothstep(6, 18, h) * 0.6 + smoothstep(0.25, 0.7, slope) * 0.7;
        let c = mixRgb(floor, rock, clamp(wallness));
        c = mixRgb(c, CANYON.top, smoothstep(40, 70, h) * (1 - smoothstep(0.3, 0.6, slope)) * 0.6);
        const k = 0.94 + speck * 0.12;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "harbour": {
        const under = smoothstep(WATER_LEVEL + 0.6, WATER_LEVEL - 1.0, h);
        const wet = smoothstep(0.2, -1.0, h);
        let c = mixRgb(HARBOUR.concrete, HARBOUR.concreteDark, smoothstep(0.4, 0.8, n) * 0.5);
        c = mixRgb(c, HARBOUR.wet, wet * 0.8);
        c = mixRgb(c, HARBOUR.seabed, under);
        const k = 0.96 + speck * 0.08;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "kitchen": {
        const rel = h - (g.roadY + 0);
        if (h < -6 || slope > 0.9) {
          // The room's floor far below (checkered tiles, darkening with depth) and the cabinet fronts that hold the counter up.
          const deep = smoothstep(-46, -8, h);
          if (slope > 0.9) {
            const panel = Math.floor((x + z) / 15 + Math.floor((x - z) / 15)) % 2 === 0 ? KITCHEN.cabinet : mixRgb(KITCHEN.cabinet, KITCHEN.cabinetDark, 0.55);
            const k = 0.62 + 0.38 * deep;
            return [panel[0] * k, panel[1] * k, panel[2] * k];
          }
          const check = (Math.floor(x / 14) + Math.floor(z / 14)) % 2 === 0 ? KITCHEN.tileA : KITCHEN.tileB;
          const k = 0.38 + 0.5 * deep;
          return [check[0] * k, check[1] * k, check[2] * k];
        }
        void rel;
        let c = mixRgb(KITCHEN.marble, KITCHEN.marbleWarm, smoothstep(0.35, 0.75, n));
        c = mixRgb(c, KITCHEN.marbleCool, smoothstep(0.55, 0.85, fbm2(x / 90 + 5, z / 90, 2)) * 0.5);
        const k = 0.97 + speck * 0.05;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "snow": {
        let c = mixRgb(SNOW.snow, SNOW.shadow, smoothstep(0.42, 0.2, n) * 0.8 + smoothstep(120, 400, g.edge) * 0.15);
        c = mixRgb(c, SNOW.rock, smoothstep(0.55, 1.1, slope) * 0.85);
        // Alpenglow: the peaks facing the low sun hold a rosy light.
        const sd = this.sunXZ();
        const len = Math.hypot(grad[0], 1, grad[1]);
        const facing = (grad[0] * sd[0] + grad[1] * sd[1]) / len + (1 / len) * sd[2];
        c = mixRgb(c, SNOW.glow, smoothstep(0.1, 0.7, facing) * smoothstep(30, 120, h) * 0.75);
        // Deep in a crevasse the ice goes blue and dark.
        if (h < g.roadY - 5) c = scaleRgb(mixRgb(SNOW.ice, SNOW.iceDeep, smoothstep(-6, -28, h - g.roadY)), 0.9);
        const k = 0.97 + speck * 0.07;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "volcano": {
        let c = mixRgb(VOLCANO.rock, VOLCANO.rockLight, smoothstep(0.35, 0.8, n));
        c = mixRgb(c, VOLCANO.ash, smoothstep(40, 110, h) * 0.5);
        c = mixRgb(c, VOLCANO.dark, smoothstep(0.4, 1.0, slope) * 0.6);
        const lava = this.lavaY[idx]!;
        let glow = 0;
        if (!Number.isNaN(lava)) {
          // Banks beside the lava are hot: warm tint and a glow.
          const above = h - lava;
          const heat = smoothstep(3.5, 0.0, above);
          glow = heat * 0.9;
          c = mixRgb(c, VOLCANO.crust, heat * 0.8);
        }
        this.glow[idx] = glow;
        const k = 0.9 + speck * 0.16;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "funfair": {
        let c = mixRgb(FAIR.ground, FAIR.groundLight, smoothstep(0.4, 0.8, n));
        c = mixRgb(c, FAIR.grass, smoothstep(0.55, 0.8, fbm2(x / 60 + 2, z / 60, 3)) * 0.8);
        c = mixRgb(c, FAIR.dark, smoothstep(0.4, 1.0, slope) * 0.5 + smoothstep(100, 360, g.edge) * 0.35);
        const k = 0.94 + speck * 0.12;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "space":
        return [0, 0, 0];
      case "palm": {
        const shallow = smoothstep(SEA_LEVEL + 0.3, SEA_LEVEL - 0.6, h);
        const deep = smoothstep(SEA_LEVEL - 1.6, SEA_LEVEL - 4.2, h);
        const wet = smoothstep(SEA_LEVEL + 1.1, SEA_LEVEL, h);
        let c = mixRgb(PALM.sand, PALM.sandWarm, smoothstep(0.35, 0.75, n));
        // The scrub inland: a little green on the dunes away from the shore.
        c = mixRgb(c, PALM.scrub, smoothstep(0.55, 0.8, fbm2(x / 50 + 8, z / 50, 3)) * smoothstep(12, 35, g.edge) * smoothstep(SEA_LEVEL + 1, SEA_LEVEL + 2.2, h) * 0.8);
        c = mixRgb(c, PALM.wetSand, wet * 0.8);
        // The shoreline: a line of white foam where the water meets the sand.
        const foam = smoothstep(0.55, 0.0, Math.abs(h - (SEA_LEVEL - 0.15)));
        c = mixRgb(c, PALM.foam, foam * 0.85);
        c = mixRgb(c, PALM.shallow, shallow * 0.95);
        c = mixRgb(c, PALM.deep, deep);
        const k = 0.97 + speck * 0.06;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
    }
  }

  private sunCache: [number, number, number] | null = null;
  private sunXZ(): [number, number, number] {
    if (!this.sunCache) {
      const [x, y, z] = this.style.sky.sunDir;
      const len = Math.hypot(x, y, z) || 1;
      this.sunCache = [x / len, z / len, y / len];
    }
    return this.sunCache;
  }

  /** The ground's height at a point, bilinear on the grid (what the mesh shows). */
  heightAt(x: number, z: number): number {
    const fx = clamp((x - this.minX) / this.cell, 0, this.nx - 1.001);
    const fz = clamp((z - this.minZ) / this.cell, 0, this.nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = this.heights;
    const a = h[j * this.nx + i]!;
    const b = h[j * this.nx + i + 1]!;
    const c = h[(j + 1) * this.nx + i]!;
    const d = h[(j + 1) * this.nx + i + 1]!;
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  /** Is there lava at this point (the nearest grid vertex)? */
  isLava(x: number, z: number): boolean {
    if (!this.anyLava) return false;
    const i = clamp(Math.round((x - this.minX) / this.cell), 0, this.nx - 1);
    const j = clamp(Math.round((z - this.minZ) / this.cell), 0, this.nz - 1);
    return !Number.isNaN(this.lavaY[j * this.nx + i]!);
  }

  /** How far beyond the road's edge a point is, from the grid (cheap; good to about a cell). */
  edgeAt(x: number, z: number): number {
    const fx = clamp((x - this.minX) / this.cell, 0, this.nx - 1.001);
    const fz = clamp((z - this.minZ) / this.cell, 0, this.nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const e = this.edges;
    return lerp(lerp(e[j * this.nx + i]!, e[j * this.nx + i + 1]!, u), lerp(e[(j + 1) * this.nx + i]!, e[(j + 1) * this.nx + i + 1]!, u), v);
  }

  /** The vertex colour at a grid vertex. */
  colourAt(i: number, j: number): Rgb {
    const o = (j * this.nx + i) * 3;
    return [this.colours[o]!, this.colours[o + 1]!, this.colours[o + 2]!];
  }

  /**
   * The ground as tiles of `tile` cells a side, each its own geometry so the
   * camera can skip the far ones. `uvMetres` is how many metres one repeat
   * of the theme's detail texture covers.
   */
  buildTiles(tile = 20, uvMetres = 64): BufferGeometry[] {
    const out: BufferGeometry[] = [];
    const { nx, nz, cell } = this;
    for (let j0 = 0; j0 < nz - 1; j0 += tile) {
      for (let i0 = 0; i0 < nx - 1; i0 += tile) {
        const i1 = Math.min(nx - 1, i0 + tile);
        const j1 = Math.min(nz - 1, j0 + tile);
        const w = i1 - i0 + 1;
        const h = j1 - j0 + 1;
        const pos = new Float32Array(w * h * 3);
        const nor = new Float32Array(w * h * 3);
        const col = new Float32Array(w * h * 3);
        const uv = new Float32Array(w * h * 2);
        const glow = new Float32Array(w * h);
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const gi = i0 + i;
            const gj = j0 + j;
            const o = (j * w + i) * 3;
            const y = this.heights[gj * nx + gi]!;
            pos[o] = this.minX + gi * cell;
            pos[o + 1] = y;
            pos[o + 2] = this.minZ + gj * cell;
            const hl = this.heights[gj * nx + Math.max(0, gi - 1)]!;
            const hr = this.heights[gj * nx + Math.min(nx - 1, gi + 1)]!;
            const hd = this.heights[Math.max(0, gj - 1) * nx + gi]!;
            const hu = this.heights[Math.min(nz - 1, gj + 1) * nx + gi]!;
            let nxv = (hl - hr) / (2 * cell);
            let nzv = (hd - hu) / (2 * cell);
            const len = Math.hypot(nxv, 1, nzv);
            nxv /= len;
            nzv /= len;
            nor[o] = nxv;
            nor[o + 1] = 1 / len;
            nor[o + 2] = nzv;
            const c = this.colourAt(gi, gj);
            col[o] = c[0];
            col[o + 1] = c[1];
            col[o + 2] = c[2];
            uv[(j * w + i) * 2] = pos[o]! / uvMetres;
            uv[(j * w + i) * 2 + 1] = pos[o + 2]! / uvMetres;
            glow[j * w + i] = this.glow[gj * nx + gi]!;
          }
        }
        const idx = new Uint32Array((w - 1) * (h - 1) * 6);
        let k = 0;
        for (let j = 0; j < h - 1; j++) {
          for (let i = 0; i < w - 1; i++) {
            const a = j * w + i;
            const b = a + 1;
            const c = a + w;
            const d = c + 1;
            // Counter-clockwise seen from above (+y): with z growing toward the viewer, a→c→b.
            idx[k++] = a;
            idx[k++] = c;
            idx[k++] = b;
            idx[k++] = b;
            idx[k++] = c;
            idx[k++] = d;
          }
        }
        const g = new BufferGeometry();
        g.setAttribute("position", new Float32BufferAttribute(pos, 3));
        g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
        g.setAttribute("color", new Float32BufferAttribute(col, 3));
        g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
        g.setAttribute("aGlow", new Float32BufferAttribute(glow, 1));
        g.setIndex(new Uint32BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        out.push(g);
      }
    }
    return out;
  }

  /**
   * The volcano's lava as a surface over every cell that has any, cut into
   * tiles like the ground. Null if the world has none.
   */
  buildLava(tile = 20): BufferGeometry[] {
    if (!this.anyLava) return [];
    const out: BufferGeometry[] = [];
    const { nx, nz, cell } = this;
    for (let j0 = 0; j0 < nz - 1; j0 += tile) {
      for (let i0 = 0; i0 < nx - 1; i0 += tile) {
        const pos: number[] = [];
        for (let j = j0; j < Math.min(nz - 1, j0 + tile); j++) {
          for (let i = i0; i < Math.min(nx - 1, i0 + tile); i++) {
            const ys = [this.lavaY[j * nx + i]!, this.lavaY[j * nx + i + 1]!, this.lavaY[(j + 1) * nx + i]!, this.lavaY[(j + 1) * nx + i + 1]!];
            const live = ys.filter((y) => !Number.isNaN(y));
            if (live.length === 0) continue;
            const y = Math.min(...live);
            // A flat quad per cell at the lowest lava height around, a little proud of the carved bed.
            const x0 = this.minX + i * cell;
            const z0 = this.minZ + j * cell;
            pos.push(x0, y, z0, x0, y, z0 + cell, x0 + cell, y, z0, x0 + cell, y, z0, x0, y, z0 + cell, x0 + cell, y, z0 + cell);
          }
        }
        if (!pos.length) continue;
        const g = new BufferGeometry();
        g.setAttribute("position", new Float32BufferAttribute(pos, 3));
        g.computeBoundingSphere();
        out.push(g);
      }
    }
    return out;
  }
}

const MEADOW = {
  near: rgb("#6fcf4b"),
  far: rgb("#58b84a"),
  light: rgb("#9be06a"),
  dark: rgb("#3f9f3d"),
  rock: rgb("#3d9a48"),
};

const CANYON = {
  sand: rgb("#efc98c"),
  sandDark: rgb("#e0b074"),
  top: rgb("#f3d8a4"),
  strata: strata(["#d4673a", "#e08a4c", "#c4552f", "#eaa968", "#b84a2c", "#f0bf86", "#cf6a3d"]),
};

const HARBOUR = {
  concrete: rgb("#9aa4bd"),
  concreteDark: rgb("#7f89a6"),
  wet: rgb("#56628a"),
  seabed: rgb("#10305a"),
};

const KITCHEN = {
  marble: rgb("#f2ece2"),
  marbleWarm: rgb("#f6e6cc"),
  marbleCool: rgb("#dfe7ee"),
  cabinet: rgb("#efe3cb"),
  cabinetDark: rgb("#c6a77b"),
  tileA: rgb("#efe7d6"),
  tileB: rgb("#8da7c2"),
};

const SNOW = {
  snow: rgb("#f3f8ff"),
  shadow: rgb("#bfd1ec"),
  rock: rgb("#4d566f"),
  glow: rgb("#ffc6d4"),
  ice: rgb("#9ed4ff"),
  iceDeep: rgb("#1f4f9a"),
};

const VOLCANO = {
  rock: rgb("#232029"),
  rockLight: rgb("#3a3641"),
  ash: rgb("#5a4f58"),
  dark: rgb("#121016"),
  crust: rgb("#5a1d0e"),
};

const FAIR = {
  ground: rgb("#38305a"),
  groundLight: rgb("#4a4070"),
  grass: rgb("#274c58"),
  dark: rgb("#1d1838"),
};

const PALM = {
  sand: rgb("#f3dfa8"),
  sandWarm: rgb("#ecd092"),
  wetSand: rgb("#c9b07a"),
  scrub: rgb("#8cbc5a"),
  foam: rgb("#ffffff"),
  shallow: rgb("#55dccc"),
  deep: rgb("#139ac2"),
};
