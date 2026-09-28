/**
 * The placeholder valley's materials, painted in code: the terrain's six
 * tileable ground materials (grass, rock, scree, snow, dirt, road stone) as
 * one texture array, and the buildings' trim textures (stone, plaster,
 * roof tiles, planks, concrete). Seamless by construction: the noise wraps
 * at the tile's edge. Albedo in sRGB, with a height in alpha for the
 * terrain shader's bump.
 */
import { CanvasTexture, DataArrayTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from "three";

/** Value noise on a torus of `period` cells: it tiles. */
function tnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const h = (a: number, b: number) => {
    const aa = ((a % period) + period) % period;
    const bb = ((b % period) + period) % period;
    let v = Math.imul(aa, 374761393) ^ Math.imul(bb, 668265263) ^ Math.imul(seed, 1442695041);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Tileable fractal noise in [0, 1] over a tile of size 1 (u, v in 0..1). */
function tfbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tnoise(u * p, v * p, p, seed + o * 13);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Tileable cellular noise: distance to the nearest of a few jittered points per cell, 0..~1. */
function tcells(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const px = cx + tnoise(cx + 0.5, cy + 0.5, cells, seed);
      const py = cy + tnoise(cx + 0.5, cy + 0.5, cells, seed + 7);
      best = Math.min(best, Math.hypot(x - px, y - py));
    }
  }
  return best;
}

const clamp = (x: number) => Math.min(255, Math.max(0, Math.round(x)));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type Painter = (u: number, v: number) => [number, number, number, number];

/** The six ground materials, in the order the splat maps name them. */
export const TERRAIN_LAYERS = ["grass", "rock", "scree", "snow", "dirt", "road"] as const;

const PAINTERS: Record<(typeof TERRAIN_LAYERS)[number], Painter> = {
  // Alpine meadow: mid greens, darker tufts, a few paler dry blades, a hint of flowers.
  grass: (u, v) => {
    const n = tfbm(u, v, 8, 4, 1);
    const fine = tfbm(u, v, 64, 2, 2);
    const tuft = tfbm(u, v, 24, 3, 3);
    const dry = Math.max(0, tfbm(u, v, 16, 2, 4) - 0.62) * 3;
    let r = mix(78, 116, n) - tuft * 22 + fine * 16 + dry * 60;
    let g = mix(112, 150, n) - tuft * 22 + fine * 18 + dry * 40;
    let b = mix(46, 66, n) - tuft * 10 + fine * 6 + dry * 10;
    // Soft-edged and faint: through six times magnification hard specks read as noise.
    const flower = Math.min(1, Math.max(0, (tnoise(u * 90, v * 90, 90, 5) - 0.9) * 12)) * 0.35;
    r = mix(r, 205, flower);
    g = mix(g, 196, flower * 0.85);
    b = mix(b, 170, flower * 0.7);
    return [r, g, b, 90 + fine * 90 + tuft * 60];
  },
  // Grey limestone with cracks and lichen.
  rock: (u, v) => {
    const n = tfbm(u, v, 4, 5, 11);
    const c = tcells(u, v, 6, 12);
    const crack = Math.max(0, 1 - c * 5.5);
    const lichen = Math.max(0, tfbm(u, v, 12, 3, 13) - 0.6) * 2.2;
    const strata = Math.sin((v + n * 0.18) * Math.PI * 14) * 0.5 + 0.5;
    const base = mix(118, 158, n) - strata * 10;
    return [base - crack * 60 + lichen * 10, base - crack * 60 + lichen * 18, base * 0.97 - crack * 55 - lichen * 10, 120 + n * 110 - crack * 90];
  },
  // Loose grey-brown stones.
  scree: (u, v) => {
    const c = tcells(u, v, 22, 21);
    const stone = Math.max(0, 1 - c * 1.6);
    const tone = tnoise(Math.floor(u * 22) + 0.5, Math.floor(v * 22) + 0.5, 22, 22);
    const n = tfbm(u, v, 16, 3, 23);
    const base = mix(98, 150, tone) * (0.72 + stone * 0.4) + n * 12;
    return [base * 1.02, base * 0.97, base * 0.9, 60 + stone * 170];
  },
  // Old snow: soft, faintly blue in its hollows.
  snow: (u, v) => {
    const n = tfbm(u, v, 6, 4, 31);
    const fine = tfbm(u, v, 48, 2, 32);
    const base = 226 + n * 22 + fine * 6;
    return [base - 8, base - 3, base + 6, 110 + n * 80];
  },
  // Bare earth and the mud of a farm track.
  dirt: (u, v) => {
    const n = tfbm(u, v, 10, 4, 41);
    const pebble = tcells(u, v, 40, 42) < 0.18 ? 1 : 0;
    const base = mix(92, 128, n);
    return [base + pebble * 30, base * 0.82 + pebble * 26, base * 0.6 + pebble * 22, 80 + n * 100 + pebble * 60];
  },
  // A stone-and-gravel road: pale, packed, wheel ruts along it.
  road: (u, v) => {
    const n = tfbm(u, v, 12, 4, 51);
    const grit = tfbm(u, v, 96, 2, 52);
    const rut = Math.exp(-Math.pow((u - 0.3) * 14, 2)) + Math.exp(-Math.pow((u - 0.7) * 14, 2));
    const base = mix(128, 158, n) + grit * 18 - rut * 22;
    return [base, base * 0.97, base * 0.9, 110 + grit * 80 - rut * 40];
  },
};

/** The terrain's six tileable materials as one texture array (`size` square each). */
export function terrainTiles(size = 256): DataArrayTexture {
  const layers = TERRAIN_LAYERS.length;
  const data = new Uint8Array(size * size * 4 * layers);
  TERRAIN_LAYERS.forEach((name, layer) => {
    const paint = PAINTERS[name];
    const off = layer * size * size * 4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b, a] = paint(x / size, y / size);
        const i = off + (y * size + x) * 4;
        data[i] = clamp(r);
        data[i + 1] = clamp(g);
        data[i + 2] = clamp(b);
        data[i + 3] = clamp(a);
      }
    }
  });
  const tex = new DataArrayTexture(data, size, size, layers);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** A canvas painted pixel by pixel with a tileable painter, as a repeating sRGB texture. */
function canvasTexture(size: number, paint: Painter): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gg, b] = paint(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = clamp(r);
      img.data[i + 1] = clamp(gg);
      img.data[i + 2] = clamp(b);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export type BuildingSurface = "stone" | "plaster" | "tiles" | "slate" | "planks" | "concrete" | "sandbag" | "canvas";

/**
 * The buildings' materials, each a texture that tiles over a metre or two
 * (the valley's geometry maps them in metres): rubble stone walls, lime
 * plaster, terracotta roof tiles, slate, weathered planks, the dam's
 * concrete, sandbags.
 */
export function buildingTextures(): Record<BuildingSurface, CanvasTexture> {
  const stone: Painter = (u, v) => {
    // Courses of rough stones with mortar between them.
    const rows = 6;
    const row = Math.floor(v * rows);
    const shift = (row % 2) * 0.5 + tnoise(row + 0.5, 0.5, rows, 61) * 0.3;
    const cols = 4;
    const cu = (u * cols + shift) % cols;
    const col = Math.floor(cu);
    const fu = cu - col;
    const fv = v * rows - row;
    const mortar = Math.min(fu, 1 - fu) * 3.2 < 0.09 || Math.min(fv, 1 - fv) * 2.2 < 0.08;
    const tone = tnoise(col + 0.5 + row * 7, row + 0.5, 64, 62);
    const n = tfbm(u, v, 16, 3, 63);
    const base = mix(122, 168, tone) + n * 20;
    if (mortar) return [178 + n * 10, 170 + n * 10, 155 + n * 8, 255];
    return [base * 1.02, base * 0.97, base * 0.88, 255];
  };
  const plaster: Painter = (u, v) => {
    const n = tfbm(u, v, 8, 4, 71);
    const stain = Math.max(0, tfbm(u, v, 3, 3, 72) - 0.55) * 1.6;
    const base = 214 + n * 22 - stain * 50;
    return [base, base * 0.95, base * 0.84, 255];
  };
  const tiles: Painter = (u, v) => {
    const rows = 8;
    const fv = (v * rows) % 1;
    const row = Math.floor(v * rows);
    const fu = (u * 6 + (row % 2) * 0.5) % 1;
    const curve = Math.sin(fu * Math.PI);
    const shade = 0.72 + curve * 0.28 - (fv > 0.85 ? 0.25 : 0);
    const tone = tnoise(Math.floor(u * 6 + (row % 2) * 0.5) + 0.5, row + 0.5, 64, 81);
    const n = tfbm(u, v, 12, 2, 82);
    return [(150 + tone * 50 + n * 15) * shade, (70 + tone * 20 + n * 8) * shade, (48 + tone * 12) * shade, 255];
  };
  const slate: Painter = (u, v) => {
    const rows = 10;
    const fv = (v * rows) % 1;
    const row = Math.floor(v * rows);
    const col = Math.floor(u * 5 + (row % 2) * 0.5);
    const tone = tnoise(col + 0.5, row + 0.5, 64, 91);
    const edge = fv > 0.88 ? 0.6 : 1;
    const base = (62 + tone * 26) * edge;
    return [base, base * 1.02, base * 1.1, 255];
  };
  const planks: Painter = (u, v) => {
    const boards = 5;
    const b = Math.floor(u * boards);
    const fu = u * boards - b;
    const gap = Math.min(fu, 1 - fu) < 0.04;
    const grain = Math.sin((v * 40 + tnoise(b + 0.5, v * 8, 64, 101) * 6) * Math.PI) * 0.5 + 0.5;
    const tone = tnoise(b + 0.5, 0.5, boards, 102);
    const base = mix(92, 128, tone) - grain * 14;
    if (gap) return [34, 26, 20, 255];
    return [base, base * 0.8, base * 0.6, 255];
  };
  const concrete: Painter = (u, v) => {
    const n = tfbm(u, v, 6, 5, 111);
    const pour = Math.min((v * 4) % 1, 1 - ((v * 4) % 1)) < 0.015 ? 0.85 : 1;
    const streak = Math.max(0, tfbm(u * 0.3, v * 3, 4, 2, 112) - 0.5) * 0.5;
    const base = (168 + n * 30) * pour * (1 - streak);
    return [base, base * 0.99, base * 0.95, 255];
  };
  const sandbag: Painter = (u, v) => {
    const rows = 4;
    const row = Math.floor(v * rows);
    const fu = (u * 3 + (row % 2) * 0.5) % 1;
    const fv = (v * rows) % 1;
    const bulge = Math.sin(fu * Math.PI) * Math.sin(fv * Math.PI);
    const n = tfbm(u, v, 32, 2, 121);
    const base = 120 + bulge * 40 + n * 16;
    return [base, base * 0.92, base * 0.7, 255];
  };
  const canvasCloth: Painter = (u, v) => {
    const n = tfbm(u, v, 8, 3, 131);
    const weave = (Math.sin(u * 400) * Math.sin(v * 400)) * 4;
    const base = 128 + n * 20 + weave;
    return [base * 0.92, base * 0.9, base * 0.66, 255];
  };
  return {
    stone: canvasTexture(256, stone),
    plaster: canvasTexture(128, plaster),
    tiles: canvasTexture(256, tiles),
    slate: canvasTexture(128, slate),
    planks: canvasTexture(128, planks),
    concrete: canvasTexture(256, concrete),
    sandbag: canvasTexture(128, sandbag),
    canvas: canvasTexture(128, canvasCloth),
  };
}
