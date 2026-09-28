import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { mulberry32 } from "../../../engine/rules/rng";

/**
 * Detail textures for the placeholder road, painted into canvases at load:
 * wet asphalt, concrete, packed dirt, weathered planks, sandbag burlap,
 * streaked metal. Near-white greyscale multipliers over the vertex bake -
 * the same split the real road makes between its albedo and its light.
 */
/** Whether there is a page to paint on (the tests build the road in Node, without one). */
export const canPaint = (): boolean => typeof document !== "undefined";

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  return [c, g];
}

function finish(c: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const grey = (v: number, a = 1) => {
  const g = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${g},${g},${g},${a})`;
};

/** Speckle: a field of tiny random dots between two tones. */
function speckle(g: CanvasRenderingContext2D, size: number, r: () => number, count: number, lo: number, hi: number, dot: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = grey(lo + (hi - lo) * r(), 0.6);
    const s = dot * (0.5 + r());
    g.fillRect(r() * size, r() * size, s, s);
  }
}

/** Old asphalt: aggregate speckle, tar patches and hairline cracks. */
export function asphaltTexture(seed = 1): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256);
  g.fillStyle = grey(0.86);
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, r, 2600, 0.62, 1, 1.6);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = grey(0.7, 0.35);
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = grey(0.45, 0.8);
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    let x = r() * 256;
    let y = r() * 256;
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (r() - 0.5) * 30;
      y += (r() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return finish(c);
}

/** Forecourt concrete: slabs with joints, oil stains. */
export function concreteTexture(seed = 2): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256);
  g.fillStyle = grey(0.92);
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, r, 1500, 0.78, 1, 1.2);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = grey(0.55, 0.25);
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 14 + r() * 26, 10 + r() * 16, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = grey(0.5, 0.9);
  g.fillRect(0, 127, 256, 2);
  g.fillRect(127, 0, 2, 256);
  return finish(c);
}

/** Packed dirt and dry grass for the fields and the shoulders. */
export function dirtTexture(seed = 3): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256);
  g.fillStyle = grey(0.88);
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, r, 1800, 0.6, 1, 2.2);
  g.strokeStyle = grey(0.7, 0.5);
  for (let i = 0; i < 260; i++) {
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 8);
    g.stroke();
  }
  return finish(c);
}

/** Weathered planks, peeling. */
export function planksTexture(seed = 4): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256);
  const boards = 8;
  const bh = 256 / boards;
  for (let i = 0; i < boards; i++) {
    const tone = 0.78 + r() * 0.22;
    g.fillStyle = grey(tone);
    g.fillRect(0, i * bh, 256, bh);
    for (let k = 0; k < 24; k++) {
      g.fillStyle = grey(tone - 0.1 - r() * 0.1, 0.35);
      g.fillRect(r() * 256, i * bh + 2 + r() * (bh - 4), 30 + r() * 120, 1);
    }
    g.fillStyle = grey(0.4, 1);
    g.fillRect(0, i * bh + bh - 2, 256, 2);
  }
  return finish(c);
}

/** Burlap: a coarse weave, darker where the sand shows through. */
export function burlapTexture(seed = 5): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(128);
  g.fillStyle = grey(0.85);
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 3) {
    g.fillStyle = grey(0.72 + r() * 0.1, 0.8);
    g.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 3) {
    g.fillStyle = grey(0.74 + r() * 0.1, 0.6);
    g.fillRect(x, 0, 1, 128);
  }
  speckle(g, 128, r, 300, 0.6, 0.95, 1.5);
  return finish(c);
}

/** Painted sheet metal, streaked with rust and grime. */
export function metalTexture(seed = 6): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256);
  g.fillStyle = grey(0.9);
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = r() * 256;
    g.fillStyle = grey(0.62 + r() * 0.25, 0.35);
    g.fillRect(x, r() * 100, 1 + r() * 3, 60 + r() * 150);
  }
  speckle(g, 256, r, 600, 0.55, 0.95, 2);
  return finish(c);
}
