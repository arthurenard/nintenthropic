/**
 * The ground under and around the track: a height field built from the
 * track's own heights, so a road that climbs a hill sits on an embankment
 * instead of floating over a flat plane.
 *
 * Close to the road the ground follows the nearest stretch of road exactly
 * (a little below it, so the verge strip lies on top without a crack). Farther
 * out it relaxes to the theme's landscape: rolling hills in the meadow, stepped
 * canyon walls, a quay that ends in water at the harbour. Everything is
 * computed from distance to the centre line, so it is continuous even where two
 * parts of the track run side by side.
 */
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import type { TrackGeometry } from "../../track/geometry";
import { clamp, fbm2, lerp, noise2, smoothstep } from "../math";
import { mixRgb, rgb, type Rgb } from "./builder";
import type { ThemeStyle } from "./themes";

/** How far below the road the ground sits next to it, so the verge ribbon covers it cleanly. */
export const GROUND_SINK = 0.7;
/** The harbour's water level. */
export const WATER_LEVEL = -1.5;

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
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;

  private constructor(
    readonly track: TrackGeometry,
    readonly style: ThemeStyle,
    minX: number,
    minZ: number,
    nx: number,
    nz: number,
    cell: number,
  ) {
    this.minX = minX;
    this.minZ = minZ;
    this.nx = nx;
    this.nz = nz;
    this.cell = cell;
    this.heights = new Float32Array(nx * nz);
    this.edges = new Float32Array(nx * nz);
    this.colours = new Float32Array(nx * nz * 3);
  }

  get maxX(): number {
    return this.minX + (this.nx - 1) * this.cell;
  }

  get maxZ(): number {
    return this.minZ + (this.nz - 1) * this.cell;
  }

  static build(track: TrackGeometry, style: ThemeStyle, cell: number): Terrain {
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
    const t = new Terrain(track, style, minX, minZ, nx, nz, cell);
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
    return { d, edge: d - near.width / 2, roadY: near.y, level: sumW > 1e-6 ? sumWY / sumW : near.y, s: near.s };
  }

  private fill(): void {
    const { nx, nz, cell, style } = this;
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
        this.heights[j * nx + i] = this.heightOf(x, z, g, rim);
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
        const c = this.colourOf(x, z, h, slope, info[j * nx + i]!);
        const o = (j * nx + i) * 3;
        this.colours[o] = c[0];
        this.colours[o + 1] = c[1];
        this.colours[o + 2] = c[2];
      }
    }
    void style;
  }

  private heightOf(x: number, z: number, g: GroundInfo, rim: number): number {
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
    }
    return lerp(near, far, smoothstep(10, 26, e));
  }

  private colourOf(x: number, z: number, h: number, slope: number, g: GroundInfo): Rgb {
    const n = fbm2(x / 30, z / 30, 3);
    const speck = noise2(x / 5, z / 5);
    switch (this.style.id) {
      case "meadow": {
        const a = MEADOW.near;
        const b = MEADOW.far;
        let c = mixRgb(a, b, smoothstep(30, 200, g.edge));
        c = mixRgb(c, MEADOW.light, smoothstep(0.55, 0.85, n) * 0.55);
        c = mixRgb(c, MEADOW.dark, smoothstep(0.45, 0.2, n) * 0.5);
        c = mixRgb(c, MEADOW.rock, smoothstep(0.55, 0.95, slope) * 0.85);
        c = mixRgb(c, MEADOW.snowish, smoothstep(55, 95, h) * 0.5);
        const k = 0.95 + speck * 0.1;
        return [c[0] * k, c[1] * k, c[2] * k];
      }
      case "canyon": {
        const band = h / 3.25 + fbm2(x / 50, z / 50, 2) * 2.2;
        const idx = ((Math.floor(band) % CANYON.strata.stops.length) + CANYON.strata.stops.length) % CANYON.strata.stops.length;
        const rock = CANYON.strata.stops[idx]!;
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
    }
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

  /** The ground as tiles of `tile` cells a side, each its own geometry so the camera can skip the far ones. */
  buildTiles(tile = 20): BufferGeometry[] {
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
        g.setIndex(new Uint32BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
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
  rock: rgb("#8d8f7c"),
  snowish: rgb("#7fb7c9"),
};

const CANYON = {
  sand: rgb("#efc98c"),
  sandDark: rgb("#e0b074"),
  top: rgb("#f3d8a4"),
  strata: strata(["#d4673a", "#e08a4c", "#c4552f", "#eaa968", "#b84a2c", "#f0bf86", "#cf6a3d"]),
};

const HARBOUR = {
  concrete: rgb("#8d97ae"),
  concreteDark: rgb("#727c96"),
  wet: rgb("#4b5675"),
  seabed: rgb("#10305a"),
};
