/**
 * The planet's atmosphere as the art's reference renderer models it
 * (art/orbit/orbitlib/planetrender.py): an exponential shell 100 km deep
 * over a 6371 km planet, Rayleigh and Mie scattering with ozone absorbing,
 * and the sun's light reaching any height through a table of
 * transmittance. The game's planet shader reads the same table (made here,
 * once, at load), and the station's sunlight is reddened and dimmed by it
 * as the sun sets over the limb. Kilometres throughout; pure maths.
 */

export const R = 6371;
export const ATM = 100;
export const H_R = 8;
export const H_M = 1.2;
export const BETA_R: readonly [number, number, number] = [5.802e-3, 13.558e-3, 33.1e-3];
export const BETA_M_S = 3.996e-3;
export const BETA_M_E = 4.4e-3;
export const BETA_O: readonly [number, number, number] = [0.65e-3, 1.881e-3, 0.085e-3];
export const G_MIE = 0.8;
export const CLOUD_H = 6;
/** The sun's irradiance at the top of the atmosphere, in the art's units. */
export const SUN_E = 20;
export const SUN_COLOR: readonly [number, number, number] = [1, 0.985, 0.96];
/** The art's exposure: sunlit cloud comes out near white. */
export const EXPOSURE_STOPS = -3.2;
/** How far the eye opens up in the planet's shadow, as the art's night renders are exposed. */
export const NIGHT_STOPS = 4.2;

/** Extinction per kilometre at height h, for each colour (the ozone's share scaled by `ozone`). */
export function extinction(h: number, out: [number, number, number] = [0, 0, 0], ozone = 1): [number, number, number] {
  const hh = Math.max(0, h);
  const r = Math.exp(-hh / H_R);
  const m = Math.exp(-hh / H_M);
  const o = Math.max(0, 1 - Math.abs(hh - 25) / 15) * ozone;
  for (let c = 0; c < 3; c++) out[c] = (BETA_R[c] as number) * r + BETA_M_E * m + (BETA_O[c] as number) * o;
  return out;
}

/**
 * The fraction of sunlight (per colour) that reaches height `h` from the
 * direction whose cosine to the zenith is `mu`: zero if the ground is in
 * the way.
 */
export function transmittance(h: number, mu: number, steps = 48): [number, number, number] {
  const r = R + h;
  const b = r * mu;
  // Blocked by the planet?
  const cg = r * r - R * R;
  const dg = b * b - cg;
  if (dg > 0 && -b - Math.sqrt(dg) >= 0) return [0, 0, 0];
  const c = r * r - (R + ATM) * (R + ATM);
  const tTop = -b + Math.sqrt(Math.max(b * b - c, 0));
  const tau = [0, 0, 0];
  const ext: [number, number, number] = [0, 0, 0];
  const ds = tTop / steps;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const x2 = r * r + t * t + 2 * r * t * mu;
    extinction(Math.sqrt(Math.max(x2, 0)) - R, ext);
    for (let k = 0; k < 3; k++) tau[k] = (tau[k] as number) + (ext[k] as number) * ds;
  }
  return [Math.exp(-(tau[0] as number)), Math.exp(-(tau[1] as number)), Math.exp(-(tau[2] as number))];
}

/** The table's shape: heights (square-root spaced, finer low) by cosines. */
export const LUT_HEIGHTS = 64;
export const LUT_ANGLES = 256;

/**
 * The transmittance table the shader reads, RGBA floats, row by row: row
 * j is height ATM·(j/(H−1))², column i is mu = −1 + 2i/(A−1).
 */
export function transmittanceTable(heights = LUT_HEIGHTS, angles = LUT_ANGLES): Float32Array {
  const out = new Float32Array(heights * angles * 4);
  for (let j = 0; j < heights; j++) {
    const u = j / (heights - 1);
    const h = u * u * ATM;
    for (let i = 0; i < angles; i++) {
      const mu = -1 + (2 * i) / (angles - 1);
      const t = transmittance(h, mu, 40);
      const o = (j * angles + i) * 4;
      out[o] = t[0];
      out[o + 1] = t[1];
      out[o + 2] = t[2];
      out[o + 3] = 1;
    }
  }
  return out;
}

/**
 * Sunlight arriving at a point far above the atmosphere (the station), per
 * colour, along direction `sun` from `eye` - both in the planet's frame,
 * kilometres - grazing the air when the sun is near the limb: the white of
 * the day, the orange of sunset, nothing once the planet is in the way.
 */
export function sunlightAt(eye: readonly [number, number, number], sun: readonly [number, number, number], steps = 64): [number, number, number] {
  const [ox, oy, oz] = eye;
  const [dx, dy, dz] = sun;
  const b = ox * dx + oy * dy + oz * dz;
  const oo = ox * ox + oy * oy + oz * oz;
  // The planet itself in the way?
  const dg = b * b - (oo - R * R);
  if (dg > 0 && -b - Math.sqrt(dg) > 0) return [0, 0, 0];
  const top = R + ATM;
  const da = b * b - (oo - top * top);
  if (da <= 0) return [1, 1, 1];
  const t0 = Math.max(0, -b - Math.sqrt(da));
  const t1 = -b + Math.sqrt(da);
  if (t1 <= 0) return [1, 1, 1];
  const tau = [0, 0, 0];
  const ext: [number, number, number] = [0, 0, 0];
  const ds = (t1 - t0) / steps;
  for (let i = 0; i < steps; i++) {
    const t = t0 + (i + 0.5) * ds;
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    // Through the full ozone band at a grazing angle this model turns the
    // light magenta; photographs of the station at orbital sunset show it
    // glowing orange, so the station's own light gets a third of it.
    extinction(Math.sqrt(x * x + y * y + z * z) - R, ext, SUNLIGHT_OZONE);
    for (let k = 0; k < 3; k++) tau[k] = (tau[k] as number) + (ext[k] as number) * ds;
  }
  return [Math.exp(-(tau[0] as number)), Math.exp(-(tau[1] as number)), Math.exp(-(tau[2] as number))];
}

const SUNLIGHT_OZONE = 0.35;

/** How far below the station's horizontal the limb lies, radians. */
export function horizonDip(altitude: number): number {
  return Math.acos(R / (R + altitude));
}
