import { CanvasTexture, Color, EquirectangularReflectionMapping, LinearFilter, SRGBColorSpace, Vector3, type Texture } from "three";
import { mulberry32 } from "../../../engine/rules/rng";

/**
 * The placeholder for sky.webp: an equirectangular night sky painted pixel
 * by pixel at load. A full moon behind thin cloud high on the left, its
 * light silvering the cloud's edges, a few stars through the breaks, and
 * the horizon lost in a cold, pale haze. Mapped exactly as three.js samples
 * equirectangular textures, so the real Blender render drops in unchanged.
 */

export interface SkyResult {
  texture: Texture;
  /** The haze at the horizon straight up the road, for the fog. */
  fog: Color;
}

const ZENITH = new Color("#04060b");
const UPPER = new Color("#0b1220");
const HORIZON = new Color("#2e3845");
const GROUND = new Color("#0b0d10");
const CLOUD = new Color("#1b2230");
const CLOUD_LIT = new Color("#3c4452");
const GLOW = new Color("#8794a8");

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Cheap value noise on the sphere's (azimuth, elevation). */
function noise(r: () => number, size: number): (x: number, y: number) => number {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (i: number, j: number) => grid[((j % size) + size) % size * size + (((i % size) + size) % size)] as number;
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** `toMoon` points at the moon (where its disc is in the sky). */
export function buildSky(toMoon: Vector3): SkyResult {
  const W = 2048;
  const H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const img = g.createImageData(W, H);
  const rand = mulberry32(1958);
  const n1 = noise(rand, 64);
  const n2 = noise(rand, 64);
  const moon = toMoon.clone().normalize();
  const dir = new Vector3();
  const out = new Color();
  const tmp = new Color();
  for (let py = 0; py < H; py++) {
    const v = 1 - (py + 0.5) / H;
    const el = (v - 0.5) * Math.PI;
    const cy = Math.sin(el);
    const ce = Math.cos(el);
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const az = (u - 0.5) * Math.PI * 2;
      dir.set(Math.cos(az) * ce, cy, Math.sin(az) * ce);
      if (cy < -0.02) {
        out.copy(GROUND).lerp(HORIZON, Math.max(0, 1 + cy * 12) * 0.5);
      } else {
        const h = Math.min(1, cy / 0.6);
        out.copy(HORIZON).lerp(UPPER, smoothstep(0, 0.35, h)).lerp(ZENITH, smoothstep(0.3, 1, h));
        // Thin cloud, banded, thicker toward the horizon.
        const cx = u * 22;
        const cz = cy * 9;
        const cloud = smoothstep(0.42, 0.78, n1(cx, cz * 2.2) * 0.7 + n2(cx * 2.3, cz * 5) * 0.3) * (0.55 + 0.45 * (1 - h));
        const toward = Math.max(0, dir.dot(moon));
        // Cloud lit by the moon at its edges, and the moon's glow through it.
        tmp.copy(CLOUD).lerp(CLOUD_LIT, Math.pow(toward, 6) * 0.9);
        out.lerp(tmp, cloud * 0.85);
        const halo = Math.pow(toward, 90) * 0.5 + Math.pow(toward, 1200) * 2 + Math.pow(toward, 12) * 0.05;
        out.r += GLOW.r * halo;
        out.g += GLOW.g * halo;
        out.b += GLOW.b * halo;
        // A few stars where the cloud breaks.
        if (cloud < 0.2 && h > 0.08 && rand() < 0.0014 * (1 - cloud * 5)) {
          const s = 0.25 + rand() * 0.6;
          out.r += s;
          out.g += s;
          out.b += s * 1.05;
        }
      }
      const i = (py * W + px) * 4;
      out.convertLinearToSRGB();
      img.data[i] = Math.min(255, out.r * 255);
      img.data[i + 1] = Math.min(255, out.g * 255);
      img.data[i + 2] = Math.min(255, out.b * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new CanvasTexture(c);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return { texture, fog: HORIZON.clone().lerp(GLOW, 0.12) };
}
