/**
 * Tileable surface detail, drawn in code at load: height fields turned into
 * normal maps (the relief of asphalt, grass, sand, snow, rock) and the
 * roughness that goes with them. These are what catch the sun at a low
 * angle and make a road look like a road from a metre away.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping } from "three";
import { seededRandom } from "../../../engine/random";

export type DetailKind = "asphalt" | "grass" | "sand" | "snow" | "rock" | "stone" | "wood" | "water";

/** A tileable value-noise height field: `octaves` of noise, each twice as fine, wrapping at the edges. */
function noiseField(size: number, rnd: () => number, base: number, octaves: number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const period = base << o;
    const lattice = new Float32Array(period * period);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    const cell = size / period;
    for (let y = 0; y < size; y++) {
      const fy = y / cell;
      const y0 = Math.floor(fy) % period;
      const y1 = (y0 + 1) % period;
      const ty = fy - Math.floor(fy);
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = x / cell;
        const x0 = Math.floor(fx) % period;
        const x1 = (x0 + 1) % period;
        const tx = fx - Math.floor(fx);
        const sx = tx * tx * (3 - 2 * tx);
        const a = lattice[y0 * period + x0]! * (1 - sx) + lattice[y0 * period + x1]! * sx;
        const b = lattice[y1 * period + x0]! * (1 - sx) + lattice[y1 * period + x1]! * sx;
        out[y * size + x] = out[y * size + x]! + (a * (1 - sy) + b * sy) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  return out;
}

/** Stamps a round bump (a pebble of the aggregate, a grain of sand) into a field, wrapping at the edges. */
function bump(field: Float32Array, size: number, cx: number, cy: number, r: number, height: number): void {
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d >= 1) continue;
      const h = Math.sqrt(1 - d * d) * height;
      const x = (((Math.floor(cx) + dx) % size) + size) % size;
      const y = (((Math.floor(cy) + dy) % size) + size) % size;
      const i = y * size + x;
      field[i] = Math.max(field[i]!, field[i]! * 0.5 + h);
    }
  }
}

function toCanvas(size: number, paint: (data: Uint8ClampedArray) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const img = ctx.createImageData(size, size);
  paint(img.data);
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A tangent-space normal map from a height field (wrapping). `strength` is height-to-slope. */
function normalMapOf(h: Float32Array, size: number, strength: number, anisotropy: number): CanvasTexture {
  const t = toCanvas(size, (data) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = h[y * size + ((x + size - 1) % size)]!;
        const r = h[y * size + ((x + 1) % size)]!;
        const u = h[((y + size - 1) % size) * size + x]!;
        const d = h[((y + 1) % size) * size + x]!;
        // Canvas rows run down, the texture's v runs up: the green slope flips.
        let nx = -(r - l) * strength;
        let ny = (d - u) * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const o = (y * size + x) * 4;
        data[o] = Math.round((nx * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        data[o + 3] = 255;
      }
    }
  });
  t.anisotropy = anisotropy;
  return t;
}

/** The relief of a kind of surface as a normal map, `size` px on a side, tiling. */
export function detailNormal(kind: DetailKind, size: number, anisotropy: number, seed = 5): CanvasTexture {
  const rnd = seededRandom(seed + kind.length * 31);
  const h = noiseField(size, rnd, 8, 4, 0.55);
  switch (kind) {
    case "asphalt": {
      // Aggregate: pebbles of two sizes pressed into a finer tar.
      for (let i = 0; i < size * size * 0.012; i++) bump(h, size, rnd() * size, rnd() * size, 1.2 + rnd() * 1.8, 0.35 + rnd() * 0.45);
      for (let i = 0; i < size * size * 0.0025; i++) bump(h, size, rnd() * size, rnd() * size, 2.6 + rnd() * 2.0, 0.55 + rnd() * 0.4);
      return normalMapOf(h, size, 7.5, anisotropy);
    }
    case "grass": {
      // Blades: short bright strokes at random angles on top of clumps.
      const f = noiseField(size, rnd, 32, 2, 0.6);
      for (let i = 0; i < f.length; i++) h[i] = h[i]! * 0.5 + f[i]! * 0.5;
      for (let i = 0; i < size * size * 0.02; i++) bump(h, size, rnd() * size, rnd() * size, 1 + rnd() * 1.6, 0.4 + rnd() * 0.5);
      return normalMapOf(h, size, 5.2, anisotropy);
    }
    case "sand": {
      // Wind ripples: long soft waves, bent by noise, over fine grain.
      const out = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const w = h[y * size + x]!;
          out[y * size + x] = 0.5 + 0.5 * Math.sin(((y + w * 90) / size) * Math.PI * 2 * 7) * 0.8 + (rnd() - 0.5) * 0.08;
        }
      }
      return normalMapOf(out, size, 3.2, anisotropy);
    }
    case "snow": {
      for (let i = 0; i < size * size * 0.004; i++) bump(h, size, rnd() * size, rnd() * size, 1.5 + rnd() * 2.5, 0.2 + rnd() * 0.3);
      return normalMapOf(h, size, 2.6, anisotropy);
    }
    case "rock": {
      const ridged = new Float32Array(size * size);
      for (let i = 0; i < ridged.length; i++) ridged[i] = 1 - Math.abs(h[i]! * 2 - 1);
      for (let i = 0; i < size * size * 0.003; i++) bump(ridged, size, rnd() * size, rnd() * size, 2 + rnd() * 3, 0.5);
      return normalMapOf(ridged, size, 9, anisotropy);
    }
    case "water": {
      // Ripples: ridged noise (crests), stretched a little so they run across the wind.
      const ridged = new Float32Array(size * size);
      for (let i = 0; i < ridged.length; i++) ridged[i] = 1 - Math.abs(h[i]! * 2 - 1);
      return normalMapOf(ridged, size, 3.4, anisotropy);
    }
    case "stone": {
      return normalMapOf(h, size, 2.2, anisotropy);
    }
    case "wood": {
      const out = new Float32Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = h[(y % 8) * size + x]! * 0.6 + h[y * size + x]! * 0.4;
      return normalMapOf(out, size, 3, anisotropy);
    }
  }
}
