import { CanvasTexture, Color, EquirectangularReflectionMapping, LinearFilter, SRGBColorSpace, Vector3, type Texture } from "three";
import { mulberry32 } from "../../../engine/rules/rng";

/**
 * The placeholder for sky.webp: an equirectangular golden-hour sky painted
 * pixel by pixel at load. The sun sits low behind the player's right
 * shoulder, so ahead, down the street, is the anti-solar sky: blue above, a
 * rose band over a warm haze, and flat-topped mesas lit by the low sun.
 * Mapped exactly as Three.js samples equirectangular textures, so the real
 * Blender render drops in unchanged.
 */

interface SkyPalette {
  zenith: Color;
  upper: Color;
  belt: Color;
  horizon: Color;
  sunGlow: Color;
  ground: Color;
  mesa: Color;
  mesaShade: Color;
  cloud: Color;
}

const GOLDEN: SkyPalette = {
  zenith: new Color("#2d5b8c"),
  upper: new Color("#79a3c7"),
  belt: new Color("#e7b3a2"),
  horizon: new Color("#f2cf9f"),
  sunGlow: new Color("#ffd58a"),
  ground: new Color("#c8a078"),
  mesa: new Color("#c98e6c"),
  mesaShade: new Color("#8f6a70"),
  cloud: new Color("#f6d9c0"),
};

const NOON: SkyPalette = {
  zenith: new Color("#3f78b6"),
  upper: new Color("#8fb8dc"),
  belt: new Color("#dfe3e2"),
  horizon: new Color("#ece6d6"),
  sunGlow: new Color("#fff6de"),
  ground: new Color("#d8bb92"),
  mesa: new Color("#c7a07e"),
  mesaShade: new Color("#b08a78"),
  cloud: new Color("#ffffff"),
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface Mesa {
  az: number;
  width: number;
  height: number;
  slope: number;
}

export interface SkyResult {
  texture: Texture;
  /** The haze at the horizon straight down the street, for the fog. */
  fog: Color;
}

/** `sunDirection` is the direction light travels. */
export function buildSky(sunDirection: Vector3, noon = false): SkyResult {
  const W = 2048;
  const H = 1024;
  const pal = noon ? NOON : GOLDEN;
  const toSun = sunDirection.clone().negate().normalize();
  const rand = mulberry32(77);
  const mesas: Mesa[] = [];
  // Mostly ahead (azimuth of −Z is −90°), some to the sides, a few behind.
  const centres = [-150, -128, -112, -100, -84, -70, -55, -38, -20, 10, 40, 100, 140, 170];
  for (const c of centres) {
    mesas.push({
      az: (c + (rand() - 0.5) * 8) * (Math.PI / 180),
      width: (4 + rand() * 12) * (Math.PI / 180),
      height: (0.6 + rand() * 2.4) * (Math.PI / 180),
      slope: (0.6 + rand() * 1.2) * (Math.PI / 180),
    });
  }
  // A few high streaks of cloud.
  const clouds: { az: number; el: number; w: number; h: number; a: number }[] = [];
  for (let i = 0; i < 16; i++) {
    clouds.push({
      az: (rand() * 2 - 1) * Math.PI,
      el: (14 + rand() * 30) * (Math.PI / 180),
      w: (10 + rand() * 30) * (Math.PI / 180),
      h: (0.6 + rand() * 1.8) * (Math.PI / 180),
      a: 0.15 + rand() * 0.35,
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const img = g.createImageData(W, H);
  const data = img.data;
  const c = new Color();
  const tmp = new Color();
  const dir = new Vector3();
  for (let py = 0; py < H; py++) {
    const v = 1 - (py + 0.5) / H;
    const el = (v - 0.5) * Math.PI;
    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const az = (u - 0.5) * Math.PI * 2;
      dir.set(Math.cos(az) * cosEl, sinEl, Math.sin(az) * cosEl);
      const sunDot = dir.dot(toSun);
      skyColour(pal, el, az, sunDot, mesas, clouds, c, tmp, noon);
      const i = (py * W + px) * 4;
      // Colours are worked in linear light and written as sRGB.
      c.convertLinearToSRGB();
      data[i] = Math.min(255, Math.max(0, c.r * 255));
      data[i + 1] = Math.min(255, Math.max(0, c.g * 255));
      data[i + 2] = Math.min(255, Math.max(0, c.b * 255));
      data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const fog = new Color();
  skyColour(pal, 0.012, -Math.PI / 2, new Vector3(0, 0.02, -1).normalize().dot(toSun), [], [], fog, tmp, noon);
  return { texture, fog };
}

function skyColour(
  pal: SkyPalette,
  el: number,
  az: number,
  sunDot: number,
  mesas: Mesa[],
  clouds: { az: number; el: number; w: number; h: number; a: number }[],
  out: Color,
  tmp: Color,
  noon: boolean,
): void {
  const deg = el * (180 / Math.PI);
  if (deg < -0.3) {
    // Below the horizon: the desert floor fading into haze.
    out.copy(pal.ground).lerp(pal.horizon, smoothstep(-12, -0.3, deg) * 0.75);
    return;
  }
  // Base gradient by elevation.
  const h = Math.max(0, deg);
  out.copy(pal.horizon);
  out.lerp(pal.belt, smoothstep(0.5, 7, h) * (1 - smoothstep(9, 22, h)) * (noon ? 0.2 : 1));
  tmp.copy(pal.upper);
  out.lerp(tmp, smoothstep(6, 28, h));
  out.lerp(pal.zenith, smoothstep(26, 85, h));
  // The sun's glow, strongest near the horizon on its side.
  const glow = Math.pow(Math.max(0, sunDot), 6) * (noon ? 0.35 : 0.8) + Math.pow(Math.max(0, sunDot), 60) * 1.5;
  out.lerp(pal.sunGlow, Math.min(1, glow * (1 - smoothstep(10, 50, h) * 0.5)));
  // The disc itself (bright: it blooms, and it lights the environment).
  if (sunDot > 0.99965) out.setRGB(4, 3.4, 2.4);
  else if (sunDot > 0.9993) out.lerp(tmp.setRGB(2.2, 1.9, 1.4), (sunDot - 0.9993) / 0.00035);
  // High cloud.
  for (const cl of clouds) {
    let da = az - cl.az;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const dx = da / cl.w;
    const dy = (el - cl.el) / cl.h;
    const d = dx * dx + dy * dy;
    if (d < 1) {
      const a = (1 - d) * (1 - d) * cl.a;
      tmp.copy(pal.cloud).lerp(pal.sunGlow, Math.max(0, sunDot) * 0.5);
      out.lerp(tmp, a);
    }
  }
  // Mesas on the horizon, lit on the faces toward the low sun, hazed by distance.
  for (const m of mesas) {
    let da = az - m.az;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const half = m.width / 2;
    const x = Math.abs(da);
    if (x > half + m.slope) continue;
    const top = x <= half ? m.height : m.height * (1 - (x - half) / m.slope);
    const rad = el;
    if (rad <= top && rad >= -0.003) {
      const face = x > half ? (da > 0 ? 0.65 : 1.0) : 0.92;
      tmp.copy(pal.mesaShade).lerp(pal.mesa, face);
      // Strata.
      const band = Math.sin((rad / m.height) * 18) * 0.04;
      tmp.multiplyScalar(0.96 + band);
      out.copy(tmp).lerp(pal.horizon, 0.45 * (1 - rad / Math.max(1e-4, m.height)) * 0.6 + 0.2);
      return;
    }
  }
}
