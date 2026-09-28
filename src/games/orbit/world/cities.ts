/**
 * Where the night map is brightest: the lit countries the breathers can put
 * under the view (see OrbitalDecay.placeNight). Read from the art's own
 * night map at load - a small, averaged copy made on the GPU - so whatever
 * the art paints, the nights show its cities.
 */
import { Camera, Mesh, NoColorSpace, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderTarget, type Texture, type WebGLRenderer } from "three";

/** A lit region: its centre (degrees), the light round it and in the country about it. */
export interface LitRegion {
  lon: number;
  lat: number;
  light: number;
  wide: number;
}

/** How a region should look: its light within the view's reach, and within twice that. */
export interface Likeness {
  light: number;
  wide: number;
}

/**
 * The brightest regions of an equirect luminance grid (w × h, row 0 the
 * north), each the light within `radiusDeg` of a centre (and within twice
 * that), the centres at least `apartDeg` apart and none within `apartDeg`
 * of `avoid`; or, given `like`, the regions most like it at both scales
 * (and at least 60% as lit) - a country as busy as another, not the edge
 * of the densest sprawl. Pure.
 */
export function pickLitRegions(lum: Float32Array, w: number, h: number, count: number, radiusDeg = 7, apartDeg = 25, avoid: [number, number][] = [], like?: Likeness): LitRegion[] {
  const DEG = Math.PI / 180;
  const n = w * h;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  const weight = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      const k = j * w + i;
      x[k] = Math.cos(lat) * Math.cos(lon);
      y[k] = Math.sin(lat);
      z[k] = -Math.cos(lat) * Math.sin(lon);
      weight[k] = (lum[k] as number) * Math.cos(lat);
    }
  }
  const within = Math.cos(radiusDeg * DEG);
  const withinWide = Math.cos(2 * radiusDeg * DEG);
  const candidates: LitRegion[] = [];
  // Centres every other cell, away from the poles.
  for (let j = 1; j < h - 1; j += 2) {
    for (let i = 0; i < w; i += 2) {
      const c = j * w + i;
      let light = 0;
      let wide = 0;
      for (let k = 0; k < n; k++) {
        const d = (x[c] as number) * (x[k] as number) + (y[c] as number) * (y[k] as number) + (z[c] as number) * (z[k] as number);
        if (d > withinWide) {
          wide += weight[k] as number;
          if (d > within) light += weight[k] as number;
        }
      }
      if (light > 0) candidates.push({ lon: ((i + 0.5) / w - 0.5) * 360, lat: (0.5 - (j + 0.5) / h) * 180, light, wide });
    }
  }
  if (like && like.light > 0 && like.wide > 0) {
    const off = (r: LitRegion) => Math.abs(Math.log(r.light / like.light)) + Math.abs(Math.log(r.wide / like.wide));
    const busy = candidates.filter((r) => r.light >= like.light * 0.6);
    candidates.length = 0;
    candidates.push(...busy.sort((a, b) => off(a) - off(b)));
  } else candidates.sort((a, b) => b.light - a.light);
  const apart = (a: [number, number], b: [number, number]) => {
    const [lo1, la1] = [a[0] * DEG, a[1] * DEG];
    const [lo2, la2] = [b[0] * DEG, b[1] * DEG];
    const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(lo1 - lo2);
    return Math.acos(Math.min(1, Math.max(-1, c))) / DEG >= apartDeg;
  };
  const picked: LitRegion[] = [];
  for (const r of candidates) {
    if (picked.length >= count) break;
    const at: [number, number] = [r.lon, r.lat];
    if (picked.every((p) => apart(at, [p.lon, p.lat])) && avoid.every((a) => apart(at, a))) picked.push(r);
  }
  return picked;
}

/** The light within `radiusDeg` of (lon, lat) degrees, as pickLitRegions weighs it. */
export function lightAround(lum: Float32Array, w: number, h: number, lon: number, lat: number, radiusDeg = 7): number {
  const DEG = Math.PI / 180;
  const cx = Math.cos(lat * DEG) * Math.cos(lon * DEG);
  const cy = Math.sin(lat * DEG);
  const cz = -Math.cos(lat * DEG) * Math.sin(lon * DEG);
  const within = Math.cos(radiusDeg * DEG);
  let light = 0;
  for (let j = 0; j < h; j++) {
    const la = (0.5 - (j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lo = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      const d = Math.cos(la) * Math.cos(lo) * cx + Math.sin(la) * cy - Math.cos(la) * Math.sin(lo) * cz;
      if (d > within) light += (lum[j * w + i] as number) * Math.cos(la);
    }
  }
  return light;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tNight;
uniform float uLod;
void main() {
  // The mip's average of the cell: its light, roughly as bright as it looks.
  vec3 c = textureLod(tNight, vUv, uLod).rgb;
  // Square-rooted, so the dim cells keep some precision in eight bits.
  gl_FragColor = vec4(vec3(sqrt(dot(c, vec3(0.2126, 0.7152, 0.0722)))), 1.0);
}
`;

/** The night map's luminance, averaged down to w × h (row 0 the north), read back from the GPU. */
export function nightLuminance(renderer: WebGLRenderer, night: Texture, w = 96, h = 48): Float32Array {
  const width = (night.image as { width?: number } | null)?.width ?? 4096;
  const target = new WebGLRenderTarget(w, h, { depthBuffer: false, colorSpace: NoColorSpace });
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { tNight: { value: night }, uLod: { value: Math.max(0, Math.log2(width / w)) } },
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(1, 1), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const before = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new Camera());
  const pixels = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
  renderer.setRenderTarget(before);
  material.dispose();
  quad.geometry.dispose();
  target.dispose();
  // Read back bottom row first (v = 0 is the south): flip to row 0 the north.
  const lum = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = (pixels[((h - 1 - j) * w + i) * 4] as number) / 255;
      lum[j * w + i] = v * v;
    }
  }
  return lum;
}
