/**
 * A dawn sky for the placeholder valley, painted into an equirectangular
 * canvas: pale and clear overhead, bright and warm low behind the player
 * where the sun has just come up, and - the way the player looks, away from
 * the sun - the blue-grey band of the Earth's shadow on the horizon with the
 * pink Belt of Venus above it, and a few high clouds catching the light.
 */
import { CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace, Vector3 } from "three";
import { fbm } from "./layout";

type RGB = [number, number, number];

const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

const ZENITH: RGB = [96, 136, 190];
const HIGH: RGB = [148, 180, 214];
const BELT: RGB = [236, 190, 186];
const SHADOW: RGB = [122, 138, 170];
const GLOW: RGB = [255, 214, 160];
const WARM: RGB = [250, 196, 150];
const GROUND: RGB = [46, 56, 60];

/**
 * The sky's colour in direction `d` (unit), with the sun toward `sun`
 * (unit), sRGB 0..255. Also what the valley's haze is made from.
 */
export function dawnSky(d: Vector3, sun: Vector3): RGB {
  const el = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const toward = (d.x * sun.x + d.z * sun.z) / Math.max(1e-6, Math.hypot(d.x, d.z) * Math.hypot(sun.x, sun.z));
  const deg = (el * 180) / Math.PI;
  // Away from the sun: the Earth's shadow low down, the pink belt over it.
  let away = mix3(SHADOW, BELT, smooth(1, 7, deg));
  away = mix3(away, HIGH, smooth(8, 26, deg));
  away = mix3(away, ZENITH, smooth(26, 80, deg));
  // Toward the sun: bright and warm at the horizon, clearing overhead.
  let near = mix3(GLOW, WARM, smooth(0, 10, deg));
  near = mix3(near, HIGH, smooth(10, 40, deg));
  near = mix3(near, ZENITH, smooth(40, 85, deg));
  const w = smooth(-0.3, 1, toward);
  let c = mix3(away, near, w * w);
  // The sun's glow and its disc.
  const cosSun = d.dot(sun);
  const glow = Math.pow(Math.max(0, cosSun), 60) * 0.9 + Math.pow(Math.max(0, cosSun), 8) * 0.25;
  c = mix3(c, [255, 236, 200], Math.min(1, glow));
  if (cosSun > 0.99985) c = [255, 252, 240];
  // High thin clouds, streaked along the wind, lit pink away from the sun and gold toward it.
  if (deg > 6 && deg < 50) {
    const az = Math.atan2(d.z, d.x);
    const band = smooth(6, 14, deg) * (1 - smooth(34, 50, deg));
    const streak = fbm(az * 6, deg * 0.6, 4, 77) * 0.5 + 0.5;
    const wisp = Math.max(0, streak - 0.58) * 3.2 * band;
    const tint: RGB = mix3([246, 200, 196], [255, 222, 176], w);
    c = mix3(c, tint, Math.min(0.75, wisp));
  }
  // Below the horizon: the dark valley haze (seen only in reflections).
  if (deg < 0) c = mix3(mix3(SHADOW, GROUND, 0.4), GROUND, smooth(0, -12, deg));
  return c;
}

/** The dawn sky as an equirectangular texture, and the sun's direction it was painted for. */
export function buildSky(sun: Vector3, width = 1024): CanvasTexture {
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(width, height);
  const d = new Vector3();
  const s = sun.clone().normalize();
  for (let py = 0; py < height; py++) {
    // three's equirect mapping: v = asin(y)/π + 0.5, the canvas's top row is v = 1.
    const theta = (0.5 - (py + 0.5) / height) * Math.PI;
    const cy = Math.sin(theta);
    const cr = Math.cos(theta);
    for (let px = 0; px < width; px++) {
      const phi = ((px + 0.5) / width - 0.5) * Math.PI * 2;
      d.set(cr * Math.cos(phi), cy, cr * Math.sin(phi));
      const c = dawnSky(d, s);
      const i = (py * width + px) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
