/**
 * The placeholder planet's maps and star field, generated on the GPU when
 * the game loads without the art (development and tests only): the same
 * equirect layout and meaning as the art's planet/*.webp and stars.webp -
 * an Earth-like world of our own making, with continents, shelves and
 * banks, deserts and forests by latitude, ice caps, cloud decks with
 * storm tracks and cyclones, and city lights along the coasts, one of
 * them spelling a faint "HI".
 */
import {
  Camera,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  RepeatWrapping,
  ClampToEdgeWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";
import { EQUIRECT, NOISE } from "../world/glsl";

/** Where the placeholder's "HI" is written, and its storm, in degrees (longitude, latitude). */
export const PLACEHOLDER_HI: readonly [number, number] = [-112, 47];
export const PLACEHOLDER_STORM: readonly [number, number] = [-128, 18];

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

/** The world's shape and climate, shared by every map so they agree. */
const WORLD = /* glsl */ `
${NOISE}
${EQUIRECT}
// Elevation: domain-warped noise, continents where it is above sea level.
float elevation(vec3 p) {
  vec3 q = p * 1.35 + vec3(3.1, 1.7, -2.2);
  vec3 w = vec3(fbm(q + vec3(0.0, 4.2, 1.3), 4), fbm(q + vec3(5.2, 1.3, 2.8), 4), fbm(q + vec3(-2.7, 3.1, 0.9), 4));
  float e = fbm(q + w * 0.9, 8);
  // Ridges where plates meet: sharp ranges along a second field's zero line.
  float ridge = 1.0 - abs(fbm(p * 2.2 + w, 5));
  e += 0.14 * pow(ridge, 6.0) * smoothstep(0.0, 0.15, e);
  return e;
}
const float SEA = 0.07;
float latitude(vec3 p) { return asin(clamp(p.y, -1.0, 1.0)); }
// Moisture: wet by the equator and in the storm tracks, dry in the subtropics.
float moisture(vec3 p, float e) {
  float lat = abs(latitude(p)) * 57.2958;
  float bands = 0.75 * exp(-pow(lat / 11.0, 2.0)) - 0.55 * exp(-pow((lat - 26.0) / 9.0, 2.0)) + 0.35 * exp(-pow((lat - 52.0) / 12.0, 2.0));
  float n = fbm(p * 3.0 + vec3(7.0), 5);
  // Inland is drier: far from the sea (high above it, a crude stand-in for distance).
  return clamp(0.5 + bands + 0.45 * n - 1.4 * max(0.0, e - SEA - 0.05), 0.0, 1.0);
}
vec3 srgb(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
`;

const ALBEDO = /* glsl */ `
${WORLD}
varying vec2 vUv;
void main() {
  vec3 p = dirOfUv(vUv);
  float e = elevation(p);
  float lat = abs(latitude(p)) * 57.2958;
  float cold = smoothstep(55.0, 80.0, lat + 25.0 * max(0.0, e - SEA) * 4.0);
  vec3 c;
  if (e < SEA) {
    // Oceans: deep blue, lighter over the shelves, turquoise banks in the tropics.
    float depth = SEA - e;
    vec3 deep = srgb(vec3(6.0, 17.0, 40.0)) * (1.0 + 0.12 * snoise(p * 9.0));
    vec3 mid = srgb(vec3(10.0, 30.0, 58.0));
    vec3 shelf = srgb(vec3(16.0, 50.0, 70.0));
    vec3 banks = srgb(vec3(48.0, 132.0, 142.0));
    c = mix(shelf, mid, smoothstep(0.0, 0.06, depth));
    c = mix(c, deep, smoothstep(0.05, 0.22, depth));
    float tropic = 1.0 - smoothstep(18.0, 32.0, lat);
    c = mix(c, banks, tropic * (1.0 - smoothstep(0.0, 0.025, depth)) * smoothstep(0.1, 0.6, snoise(p * 18.0) * 0.5 + 0.5));
    // Sea ice toward the poles.
    float ice = smoothstep(68.0, 76.0, lat + 4.0 * snoise(p * 6.0));
    c = mix(c, srgb(vec3(214.0, 222.0, 234.0)), ice);
  } else {
    float h = e - SEA;
    float m = moisture(p, e);
    float n = snoise(p * 24.0) * 0.5 + 0.5;
    vec3 rainforest = srgb(vec3(20.0, 42.0, 16.0));
    vec3 forest = srgb(vec3(30.0, 50.0, 22.0));
    vec3 boreal = srgb(vec3(24.0, 36.0, 26.0));
    vec3 savanna = srgb(vec3(124.0, 110.0, 66.0));
    vec3 grass = srgb(vec3(96.0, 100.0, 58.0));
    vec3 steppe = srgb(vec3(140.0, 126.0, 92.0));
    vec3 sand = srgb(vec3(214.0, 176.0, 122.0));
    vec3 redSand = srgb(vec3(196.0, 120.0, 66.0));
    vec3 tundra = srgb(vec3(98.0, 94.0, 78.0));
    vec3 rock = srgb(vec3(120.0, 104.0, 86.0));
    vec3 snow = srgb(vec3(238.0, 242.0, 248.0));
    vec3 green = mix(forest, rainforest, 1.0 - smoothstep(8.0, 22.0, lat));
    green = mix(green, boreal, smoothstep(45.0, 60.0, lat));
    vec3 dry = mix(sand, redSand, smoothstep(0.3, 0.8, snoise(p * 5.0 + 2.0) * 0.5 + 0.5));
    c = mix(dry, steppe, smoothstep(0.15, 0.35, m));
    c = mix(c, mix(savanna, grass, smoothstep(25.0, 40.0, lat)), smoothstep(0.3, 0.5, m));
    c = mix(c, green, smoothstep(0.45, 0.72, m));
    c *= 0.85 + 0.3 * n;
    c = mix(c, rock, smoothstep(0.1, 0.22, h));
    c = mix(c, tundra, smoothstep(58.0, 66.0, lat));
    c = mix(c, snow, max(smoothstep(0.22, 0.3, h), cold));
    // Coast: a thin pale beach where the land meets the sea.
    c = mix(c, srgb(vec3(190.0, 172.0, 140.0)), (1.0 - smoothstep(0.0, 0.006, h)) * 0.5);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const CLOUDS = /* glsl */ `
${WORLD}
varying vec2 vUv;
uniform vec3 uStorm;
// A cyclone: the domain wound round a centre.
vec3 swirl(vec3 p, vec3 c, float radius, float turns) {
  float d = acos(clamp(dot(p, c), -1.0, 1.0));
  float k = exp(-pow(d / radius, 2.0)) * turns;
  vec3 axis = c;
  float s = sin(k);
  float co = cos(k);
  return p * co + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - co);
}
void main() {
  vec3 p = dirOfUv(vUv);
  float lat = latitude(p) * 57.2958;
  float alat = abs(lat);
  vec3 q = p;
  q = swirl(q, normalize(vec3(0.5, 0.32, 0.8)), 0.16, 5.5);
  q = swirl(q, normalize(vec3(-0.7, -0.28, 0.6)), 0.14, -5.0);
  q = swirl(q, normalize(vec3(0.2, 0.6, -0.78)), 0.2, 4.0);
  q = swirl(q, uStorm, 0.07, 7.0);
  // Stretched east-west by the winds.
  vec3 s = vec3(q.x, q.y * 1.8, q.z);
  vec3 w = vec3(fbm(s * 2.0 + 1.3, 4), fbm(s * 2.0 + 7.1, 4), fbm(s * 2.0 - 3.3, 4));
  float n = fbm(s * 3.2 + w * 0.8, 8);
  float bands = 0.28 * exp(-pow(lat / 7.0, 2.0)) - 0.32 * exp(-pow((alat - 24.0) / 8.0, 2.0)) + 0.26 * exp(-pow((alat - 50.0) / 11.0, 2.0)) + 0.12 * smoothstep(65.0, 85.0, alat);
  float cover = smoothstep(0.02, 0.42, n + bands + 0.05);
  // Fine structure: popcorn cumulus in the tropics, streaks in the storm tracks.
  float fine = fbm(p * 38.0 + w * 2.0, 4);
  cover = clamp(cover + 0.35 * fine * cover * (1.0 - cover) * 2.0, 0.0, 1.0);
  // A cluster of thunderstorms round the storm point, towers and all.
  float storm = exp(-pow(acos(clamp(dot(p, uStorm), -1.0, 1.0)) / 0.05, 2.0));
  cover = max(cover, storm * smoothstep(-0.2, 0.3, fbm(p * 60.0, 3)));
  gl_FragColor = vec4(cover, cover, cover, 1.0);
}
`;

const NIGHT = /* glsl */ `
${WORLD}
varying vec2 vUv;
uniform vec3 uHi;
// A stroke of the "HI", in degrees east and north of its centre.
float bar(vec2 d, vec2 a, vec2 b, float w) {
  vec2 pa = d - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(w * 0.5, w, length(pa - ba * h));
}
void main() {
  vec3 p = dirOfUv(vUv);
  float e = elevation(p);
  float lat = abs(latitude(p)) * 57.2958;
  float light = 0.0;
  if (e >= SEA) {
    float h = e - SEA;
    float m = moisture(p, e);
    // People live near the sea and the rivers, in the mild lowlands.
    float coast = 1.0 - smoothstep(0.0, 0.05, h);
    float mild = (1.0 - smoothstep(48.0, 62.0, lat)) * (1.0 - smoothstep(0.08, 0.18, h)) * smoothstep(0.12, 0.4, m);
    float region = smoothstep(0.1, 0.6, fbm(p * 5.0 + vec3(11.0), 4) * 0.5 + 0.5 + coast * 0.35) * mild;
    // Cities: bright cores with suburbs; towns strung along roads.
    float cells = fbm(p * 70.0 + vec3(3.0), 4) * 0.5 + 0.5;
    float metro = pow(smoothstep(0.62, 0.92, cells), 2.0) * region;
    float road = 1.0 - smoothstep(0.0, 0.035, abs(snoise(p * 26.0 + vec3(5.0))));
    float towns = road * smoothstep(0.45, 0.8, hash13(floor(p * 900.0))) * region * 0.5;
    float specks = step(0.985, hash13(floor(p * 1400.0))) * region * 0.6;
    light = metro * 1.4 + towns + specks;
  } else {
    // Fishing fleets far out, a few gas flares.
    light = step(0.9993, hash13(floor(p * 1600.0))) * 0.5 * (1.0 - smoothstep(60.0, 70.0, lat));
  }
  // The faint "HI": two letters of lights, a degree and a half tall.
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), uHi));
  vec3 north = cross(uHi, east);
  vec2 d = vec2(dot(p - uHi, east), dot(p - uHi, north)) * 57.2958;
  if (dot(p, uHi) > 0.99) {
    float hi = bar(d, vec2(-1.3, -0.8), vec2(-1.3, 0.8), 0.22) + bar(d, vec2(-0.3, -0.8), vec2(-0.3, 0.8), 0.22) + bar(d, vec2(-1.3, 0.0), vec2(-0.3, 0.0), 0.22) + bar(d, vec2(0.7, -0.8), vec2(0.7, 0.8), 0.22);
    light = max(light, clamp(hi, 0.0, 1.0) * 0.8);
  }
  vec3 sodium = vec3(1.0, 0.62, 0.26);
  vec3 white = vec3(1.0, 0.86, 0.66);
  vec3 c = mix(sodium, white, smoothstep(0.8, 1.4, light)) * clamp(light, 0.0, 1.6);
  gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
}
`;

const WATER = /* glsl */ `
${WORLD}
varying vec2 vUv;
void main() {
  vec3 p = dirOfUv(vUv);
  float e = elevation(p);
  float sea = 1.0 - smoothstep(SEA - 0.002, SEA + 0.002, e);
  // Sea ice is no mirror.
  float lat = abs(latitude(p)) * 57.2958;
  sea *= 1.0 - smoothstep(66.0, 74.0, lat);
  gl_FragColor = vec4(sea, sea, sea, 1.0);
}
`;

const STARS = /* glsl */ `
${NOISE}
${EQUIRECT}
varying vec2 vUv;
uniform vec2 uSize;
// Stars as points in 3D cells round the sky: one per cell at most, of a
// random brightness (most faint), a small round point whatever the latitude.
// cells: how many across a radian.
vec3 stars(vec3 d, float cells, float seed, float density) {
  vec3 p = d * cells;
  vec3 c = floor(p);
  vec3 h = vec3(hash13(c + seed), hash13(c + seed + 17.0), hash13(c + seed + 31.0));
  if (hash13(c + seed + 5.0) > density) return vec3(0.0);
  vec3 star = normalize(c + 0.15 + 0.7 * h);
  float ang = acos(clamp(dot(d, star), -1.0, 1.0));
  float bright = pow(hash13(c + seed + 47.0), 20.0) * 1.8 + pow(hash13(c + seed + 53.0), 4.0) * 0.09;
  // A point under a texel wide: the stars are points, not snow.
  float w = (0.42 + 0.25 * sqrt(bright)) * (PI / uSize.y);
  float k = exp(-ang * ang / (w * w));
  vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.84, 0.64), hash13(c + seed + 61.0));
  return tint * bright * k;
}
void main() {
  vec3 d = dirOfUv(vUv);
  vec3 c = stars(d, 150.0, 1.0, 0.3) + stars(d, 80.0, 3.0, 0.4);
  // The Milky Way: a band along a great circle, clumpy and dusty, thick with faint stars.
  vec3 pole = normalize(vec3(0.35, 0.55, -0.76));
  float band = exp(-pow(dot(d, pole) / 0.2, 2.0));
  float clump = fbm(d * 6.0, 6) * 0.5 + 0.5;
  float dust = smoothstep(0.4, 0.75, fbm(d * 10.0 + 3.0, 5) * 0.5 + 0.5);
  c += vec3(0.6, 0.64, 0.74) * band * clump * 0.05 * (1.0 - 0.75 * dust);
  c += stars(d, 300.0, 7.0, 0.35) * band * (1.0 - 0.6 * dust) * 0.35;
  gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
}
`;

function dir(lonDeg: number, latDeg: number): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
}

/** Render one map into a texture of its own, mipmapped (the planet is seen at every angle). */
function renderMap(renderer: WebGLRenderer, fragment: string, width: number, height: number, colour: boolean, uniforms: Record<string, { value: unknown }> = {}): Texture {
  const target = new WebGLRenderTarget(width, height, {
    colorSpace: colour ? SRGBColorSpace : NoColorSpace,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(1, 1), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const before = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new Camera());
  renderer.setRenderTarget(before);
  material.dispose();
  quad.geometry.dispose();
  const texture = target.texture;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

export type PlanetMap = "albedo" | "clouds" | "night" | "water" | "stars";

/** One of the placeholder's maps, at a size that keeps the loading quick. */
export function buildPlanetMap(renderer: WebGLRenderer, name: PlanetMap): Texture {
  switch (name) {
    case "albedo":
      return renderMap(renderer, ALBEDO, 2048, 1024, true);
    case "clouds":
      return renderMap(renderer, CLOUDS, 2048, 1024, false, { uStorm: { value: dir(...PLACEHOLDER_STORM) } });
    case "night":
      return renderMap(renderer, NIGHT, 2048, 1024, true, { uHi: { value: dir(...PLACEHOLDER_HI) } });
    case "water":
      return renderMap(renderer, WATER, 1024, 512, false);
    case "stars":
      return renderMap(renderer, STARS, 4096, 2048, true, { uSize: { value: [4096, 2048] } });
  }
}
