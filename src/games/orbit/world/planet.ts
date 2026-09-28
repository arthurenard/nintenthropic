/**
 * Everything beyond the station, drawn in one pass as the backdrop: the
 * stars and the Milky Way, the sun, the Moon, and the planet - its ground,
 * oceans with the sun's glint, the cloud deck with its shadows and relief,
 * city lights on the night side - seen through its atmosphere, which is
 * integrated along every eye ray (Rayleigh and Mie scattering, ozone, the
 * sun's light reaching each height through a table of transmittance):
 * the thin blue line at the limb, the haze toward the horizon, the orange
 * band at the terminator. It follows the art's reference renderer
 * (art/orbit/orbitlib/planetrender.py) so the game looks like its renders:
 * the relief from the height map, and the detail texture breaking the
 * maps' ~10 km texels into cloudlets, slopes and streets - laid down in
 * three planes round the planet (no seam, square texels everywhere), and
 * faded to its average where it is finer than a pixel.
 *
 * A sphere round the eye, drawn after the scenery at the far plane, so
 * only the pixels the station and the cupola leave uncovered are shaded.
 * Kilometres, in the planet's frame (three's sphere: y north, x longitude
 * 0), with the world turned into it by `toPlanet`.
 */
import {
  BackSide,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  LinearMipmapLinearFilter,
  type Texture,
  type WebGLRenderer,
} from "three";
import { ATM, BETA_M_E, BETA_M_S, BETA_O, BETA_R, CLOUD_H, G_MIE, H_M, H_R, LUT_ANGLES, LUT_HEIGHTS, R, SUN_COLOR, SUN_E, transmittanceTable } from "./atmosphere";
import { EQUIRECT, NOISE, TONE } from "./glsl";

export interface PlanetTextures {
  albedo: Texture;
  clouds: Texture;
  night: Texture;
  water: Texture;
  /** Land relief: (elevation / 6 km)^0.6. */
  height: Texture;
  /** The tileable detail: R cumulus, G terrain, B fibrous cloud, each with a uniform histogram. */
  detail: Texture;
  /** The star field as a cube map (see starsCube). */
  stars: Texture;
}

/**
 * The star field, from the art's equirect image to a cube: sampled as an
 * equirect, the stars near its poles are smeared round them by the filter.
 */
export function starsCube(renderer: WebGLRenderer, equirect: Texture): WebGLCubeRenderTarget {
  const size = Math.min(1024, Math.max(256, ((equirect.image as { width?: number } | null)?.width ?? 4096) / 4));
  const target = new WebGLCubeRenderTarget(size, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
  equirect.generateMipmaps = true;
  equirect.minFilter = LinearMipmapLinearFilter;
  target.fromEquirectangularTexture(renderer, equirect);
  return target;
}

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const v3 = (a: readonly number[]) => `vec3(${a.map(f).join(", ")})`;

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 0.0)).xyz;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // At the far plane: drawn behind everything, and only where nothing else is.
  gl_Position = p.xyww;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uCenter;
uniform mat3 uToPlanet;
uniform vec3 uSun;
uniform float uNight;
uniform float uCloudShift;
uniform float uTime;
uniform vec3 uMoon;
uniform float uMoonRadius;
uniform float uMoonShow;
uniform float uFlag;
uniform float uAurora;
uniform vec4 uLightning;
uniform vec4 uHi;
uniform mat3 uNightMap;
uniform float uNightScale;
uniform float uSunDisc;
uniform float uRaw;
uniform sampler2D tAlbedo;
uniform sampler2D tClouds;
uniform sampler2D tNight;
uniform sampler2D tWater;
uniform sampler2D tHeight;
uniform float uHeightTexel;
uniform sampler2D tDetail;
uniform samplerCube tStars;
uniform sampler2D tLut;

${TONE}
${NOISE}
${EQUIRECT}

const float R = ${f(R)};
const float ATM = ${f(ATM)};
const float HR = ${f(H_R)};
const float HM = ${f(H_M)};
const vec3 BR = ${v3(BETA_R)};
const float BMS = ${f(BETA_M_S)};
const float BME = ${f(BETA_M_E)};
const vec3 BO = ${v3(BETA_O)};
const float G = ${f(G_MIE)};
const float CLOUD_H = ${f(CLOUD_H)};
const float CLOUD_RELIEF = 10.0;
const float SUN_E = ${f(SUN_E)};
const vec3 SUN_COLOR = ${v3(SUN_COLOR)};
const float SUN_RADIUS = 0.004677;
// City light: as the art's renders give it by day (0.6) and, the eye
// adapted, at night (2.0); the stars at night.
const float NIGHT_GAIN_DAY = 0.6;
const float NIGHT_GAIN_NIGHT = 2.0;
const float STAR_GAIN = 0.6;
const float OCEAN_ROUGH = 0.13;
const float MULTI = 0.55;
// The detail texture: one tile is a 48th of the way pole to pole (~0.4 km a texel).
const float DETAIL_TILE = ${f(Math.PI * R / 48)};
const float DETAIL_TEXELS = 1024.0;
// Relief: the height map's slopes exaggerated as the art's renders do; a cloudlet's top at full cover.
const float TERRAIN_RELIEF = 9.0;
const float CLOUDLET_H = 2.2;

vec2 sphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e9, -1e9);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

vec3 lut(float h, float mu) {
  float u = ((clamp(mu, -1.0, 1.0) + 1.0) * 0.5 * ${f(LUT_ANGLES - 1)} + 0.5) / ${f(LUT_ANGLES)};
  float v = (sqrt(clamp(h / ATM, 0.0, 1.0)) * ${f(LUT_HEIGHTS - 1)} + 0.5) / ${f(LUT_HEIGHTS)};
  return textureLod(tLut, vec2(u, v), 0.0).rgb;
}

float phaseR(float c) { return 0.05968310365 * (1.0 + c * c); }
float phaseM(float c, float g) {
  float g2 = g * g;
  return 0.1193662073 * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// A map's coordinate for a direction, and its footprint: the longitude
// chosen so the mip level never jumps at the date line (Tarini's trick), and
// the footprint across it narrowed by cos(latitude), as the texels are - near
// a pole a whole ring of them is a few pixels, and without this the filter
// smears them round it.
struct MapAt { vec2 uv; vec2 dx; vec2 dy; };
MapAt mapAt(vec3 n, float shift) {
  vec2 uv = uvOfDir(n);
  float a = uv.x + shift;
  float b = fract(a + 0.5) - 0.5;
  float x = fwidth(a) < fwidth(b) - 0.001 ? a : b;
  MapAt m;
  m.uv = vec2(x, uv.y);
  float c = max(cos((uv.y - 0.5) * 3.14159265), 0.02);
  m.dx = vec2(dFdx(x) * c, dFdx(uv.y));
  m.dy = vec2(dFdy(x) * c, dFdy(uv.y));
  return m;
}
vec4 sampleMap(sampler2D t, MapAt m) { return textureGrad(t, m.uv, m.dx, m.dy); }
vec4 sampleMapAt(sampler2D t, MapAt m, vec2 offset) { return textureGrad(t, m.uv + offset, m.dx, m.dy); }

// The detail texture on the planet: projected along each axis and blended
// by how squarely the surface faces it, only the planes that count fetched.
// p is a point on the planet in km; its screen derivatives are taken here,
// in uniform flow, and handed to the fetches.
struct Tri { vec3 p; vec3 dx; vec3 dy; vec3 w; float fine; };
Tri triAt(vec3 p) {
  Tri t;
  t.p = p;
  t.dx = dFdx(p);
  t.dy = dFdy(p);
  vec3 w = pow(abs(normalize(p)), vec3(8.0));
  w /= w.x + w.y + w.z;
  w = max(w - 0.02, 0.0);
  t.w = w / (w.x + w.y + w.z);
  // How many detail texels a pixel spans at the coarsest scale (log2).
  t.fine = log2(max(length(t.dx) + length(t.dy), 1e-6) * 0.5 * DETAIL_TEXELS / DETAIL_TILE);
  return t;
}
// Where planes blend, the blend keeps the detail's contrast (its histogram
// is uniform, mean 0.5): averaged plainly, two noises would flatten toward
// grey, and the cover read from them would drift.
vec4 detailAt(Tri t, float tiles) {
  float k = tiles / DETAIL_TILE;
  vec4 s = vec4(0.0);
  if (t.w.x > 0.0) s += t.w.x * (textureGrad(tDetail, t.p.yz * k, t.dx.yz * k, t.dy.yz * k) - 0.5);
  if (t.w.y > 0.0) s += t.w.y * (textureGrad(tDetail, t.p.zx * k, t.dx.zx * k, t.dy.zx * k) - 0.5);
  if (t.w.z > 0.0) s += t.w.z * (textureGrad(tDetail, t.p.xy * k, t.dx.xy * k, t.dy.xy * k) - 0.5);
  return clamp(0.5 + s * inversesqrt(dot(t.w, t.w)), 0.0, 1.0);
}
// The clouds map read as coverage and broken into cloudlets by the detail:
// overcast stays overcast, clear stays clear, partial cover becomes crisp
// cloudlets in the right amount. Its cells are ~40 texels across, so they
// stay sharp until far off; mipmapped, the detail loses contrast, given
// back so the cover keeps its amount; only where a cell is under a pixel
// (by the limb) would thresholding alias: the average there. The dome is
// the detail itself, for the cloudlets' relief.
float cloudCover(float a, Tri t, out float dome) {
  vec4 d1 = detailAt(t, 1.0);
  vec4 d2 = detailAt(t, 4.0);
  dome = d1.r;
  float d = 0.75 * d1.r + 0.25 * d1.b + (d2.r - 0.5) * 0.35;
  d = clamp(0.5 + (d - 0.5) / mix(1.0, 0.55, smoothstep(3.5, 7.0, t.fine)), 0.0, 1.0);
  // The edge: the art's soft one up close, never wider than a pixel or so
  // further off, where the detail changes by more than that across one.
  float soft = clamp(fwidth(d) * 0.9, 0.025, 0.14);
  float k = smoothstep(1.0 - a - soft, 1.0 - a + soft, d);
  float body = pow(min(a * 1.25, 1.0), 0.7);
  float sharp = max(k * body, a * 0.08);
  float mean = max(a * body, a * 0.08);
  return clamp(mix(sharp, mean, smoothstep(5.5, 7.5, t.fine)), 0.0, 1.0);
}
// The aurora, once earned: curtains of light standing 100-300 km up along a
// ring just short of the horizon, so they rise over the limb all round the
// view - a folded sheet with vertical rays, green below, red and violet
// above, brightest where the eye looks along it. The sheet is thin, so it is
// not sampled along the ray (it would be missed, or banded): the ray's
// crossings of it are solved for (a cone round the station's nadir), and
// each gives the light of the sheet there times the path through it.
vec3 auroraAt(vec3 o, vec3 d, float t, vec3 n0, vec3 e1, vec3 e2, float ring, float width, vec3 s) {
  vec3 x = o + d * t;
  float r = length(x);
  float h = r - R;
  float profile = smoothstep(92.0, 108.0, h) * exp(-max(h - 108.0, 0.0) / 70.0);
  if (profile <= 0.001) return vec3(0.0);
  vec3 u = x / r;
  float phi = atan(dot(u, e2), dot(u, e1));
  float rays = 0.35 + 0.65 * smoothstep(-0.4, 0.9, snoise(vec3(phi * 150.0, h * 0.005, uTime * 0.15)));
  rays *= 0.7 + 0.3 * snoise(vec3(phi * 12.0, uTime * 0.05, 3.1));
  vec3 col = mix(vec3(0.22, 1.0, 0.42), vec3(0.8, 0.22, 0.5), smoothstep(160.0, 260.0, h));
  // Only in the planet's shadow (the sunlit side drowns it).
  float dark = smoothstep(0.05, -0.1, dot(u, s));
  // The path through a sheet this thin, by how squarely the ray crosses it.
  vec3 normal = normalize(u * cos(ring) - n0);
  float path = width * r / max(abs(dot(d, normal)), 0.08);
  return col * profile * rays * dark * path;
}
vec3 aurora(vec3 o, vec3 d, float tGround, vec3 s) {
  if (uAurora <= 0.0) return vec3(0.0);
  vec2 shell = sphere(o, d, R + 320.0);
  if (shell.y <= 0.0 || shell.x > 1e8) return vec3(0.0);
  float ta = max(shell.x, 0.0);
  float tb = min(shell.y, tGround);
  if (tb <= ta) return vec3(0.0);
  vec3 n0 = normalize(o);
  vec3 e1 = normalize(cross(n0, abs(n0.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(n0, e1);
  // The ring: its angle from the station's nadir, a little inside the horizon.
  float base = acos(R / length(o)) - 0.045;
  vec3 sum = vec3(0.0);
  for (int pass_ = 0; pass_ < 2; pass_++) {
    // Where the ray meets the cone at this angle (two crossings at most);
    // the sheet's fold is looked up at the first guess, then solved again.
    float ring = base;
    for (int it = 0; it < 2; it++) {
      float c2 = sq(cos(ring));
      float a = dot(d, n0);
      float b = dot(o, n0);
      float qa = a * a - c2;
      float qb = a * b - c2 * dot(o, d);
      float qc = b * b - c2 * dot(o, o);
      float disc = qb * qb - qa * qc;
      if (disc < 0.0 || abs(qa) < 1e-9) break;
      float root = sqrt(disc);
      float t = pass_ == 0 ? (-qb - root) / qa : (-qb + root) / qa;
      if (it == 0) {
        vec3 x = normalize(o + d * t);
        float phi = atan(dot(x, e2), dot(x, e1));
        ring = base + 0.012 * sin(phi * 3.0 + uTime * 0.05) + 0.008 * snoise(vec3(phi * 4.0, uTime * 0.03, 1.7));
        continue;
      }
      if (t > ta && t < tb && b + a * t > 0.0) sum += auroraAt(o, d, t, n0, e1, e2, ring, 0.004, s);
    }
  }
  return sum * 0.0063;
}

// The same point with the clouds' drift (they turn a little faster than the ground).
vec3 drifted(vec3 p, float shift) {
  float a = shift * 6.2831853;
  float c = cos(a);
  float s_ = sin(a);
  return vec3(p.x * c + p.z * s_, p.y, -p.x * s_ + p.z * c);
}

void main() {
  vec3 D = normalize(vDir);
  vec3 d = normalize(uToPlanet * D);
  vec3 o = uToPlanet * (-uCenter);
  vec3 s = normalize(uToPlanet * uSun);
  float cosT = dot(d, s);

  vec2 ta = sphere(o, d, R + ATM);
  vec2 tg = sphere(o, d, R);
  bool hitG = tg.x > 0.0 && tg.x < 1e8;
  bool hitA = ta.y > 0.0 && ta.x < 1e8;

  // --- the air along the ray: single scattering, a little multiple ---------
  vec3 Lin = vec3(0.0);
  vec3 tau = vec3(0.0);
  float closest = -dot(o, d);
  if (hitA) {
    float t0 = max(ta.x, 0.0);
    float t1 = hitG ? tg.x : ta.y;
    // Samples crowd round the ray's closest approach, where the air is densest.
    float tc = clamp(closest, t0, t1);
    float pr = phaseR(cosT);
    float pm = phaseM(cosT, G);
    for (int half_ = 0; half_ < 2; half_++) {
      float L = half_ == 0 ? tc - t0 : t1 - tc;
      if (L <= 0.0) continue;
      for (int k = 0; k < 8; k++) {
        float fa = half_ == 0 ? 1.0 - float(k) / 8.0 : float(k) / 8.0;
        float fb = half_ == 0 ? 1.0 - float(k + 1) / 8.0 : float(k + 1) / 8.0;
        float ta_ = half_ == 0 ? tc - L * fa * fa : tc + L * fa * fa;
        float tb_ = half_ == 0 ? tc - L * fb * fb : tc + L * fb * fb;
        float ds = abs(tb_ - ta_);
        vec3 x = o + d * (0.5 * (ta_ + tb_));
        float r = length(x);
        float h = r - R;
        float hr = exp(-max(h, 0.0) / HR);
        float hm = exp(-max(h, 0.0) / HM);
        float ho = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
        vec3 ext = BR * hr + BME * hm + BO * ho;
        vec3 tauMid = tau + ext * ds * 0.5;
        float muS = dot(x, s) / r;
        vec3 Ts = lut(h, muS);
        vec3 Tv = exp(-tauMid);
        Lin += (BR * hr * pr + BMS * hm * pm) * Ts * Tv * ds;
        // Multiple scattering: an even glow from the lit air round about.
        Lin += (BR * hr + BMS * hm) * 0.0795775 * Tv * ds * MULTI * clamp(muS + 0.12, 0.0, 1.0) * vec3(0.55, 0.75, 1.0);
        tau += ext * ds;
      }
    }
  }
  vec3 Tview = exp(-tau);
  vec3 L = Lin * SUN_E * SUN_COLOR;

  // --- the ground (or, off the planet, the nearest point of it) --------------
  // Everything the ground and clouds need is fetched here, in uniform flow,
  // so the screen derivatives the filtering uses are sound at the limb.
  float tHit = hitG ? tg.x : max(closest, 0.0);
  vec3 xg = o + d * tHit;
  vec3 ng = normalize(xg);
  MapAt mg = mapAt(ng, 0.0);
  vec3 albedo = sampleMap(tAlbedo, mg).rgb;
  float water = sampleMap(tWater, mg).r;
  // The lights: the night map read through the turn the game chose for
  // this night (a lit country under the view; none by day).
  vec3 lights = sampleMap(tNight, mapAt(uNightMap * ng, 0.0)).rgb;
  // The detail under the map's pixel: terrain and water at two scales, streets at a finer one.
  Tri tgd = triAt(xg);
  vec4 dg1 = detailAt(tgd, 1.0);
  vec4 dg2 = detailAt(tgd, 4.0);
  vec4 det = mix(dg1, dg2, 0.4);
  float streetsAt = detailAt(tgd, 8.0).r;
  // The relief: the height map's slopes (decoded to km), a little of the detail's.
  float hC = sampleMap(tHeight, mg).r;
  float hU = sampleMapAt(tHeight, mg, vec2(uHeightTexel * 0.35, 0.0)).r;
  float hV = sampleMapAt(tHeight, mg, vec2(0.0, uHeightTexel * 0.35)).r;
  float muG = dot(ng, s);
  // Cloud shadow: the cloud above the point, toward the sun.
  float tanZ = sqrt(max(1.0 - muG * muG, 0.0)) / max(muG, 0.05);
  vec3 sp = normalize(s - ng * muG + 1e-6);
  vec3 xs = normalize(ng * (R + CLOUD_H) + sp * CLOUD_H * min(tanZ, 40.0));
  float shadeMap = sampleMap(tClouds, mapAt(xs, uCloudShift)).r;
  float unused;
  float shade = cloudCover(shadeMap, triAt(drifted(xs * (R + CLOUD_H), uCloudShift)), unused);
  // The cloud deck, 6 km up.
  vec2 tcl = sphere(o, d, R + CLOUD_H);
  vec3 pc = o + d * (tcl.x > 0.0 && tcl.x < 1e8 ? tcl.x : tHit);
  vec3 xc = normalize(pc);
  MapAt mc = mapAt(xc, uCloudShift);
  float cloud = sampleMap(tClouds, mc).r;
  float eps = 0.6 / 2048.0;
  float cloudU = sampleMapAt(tClouds, mc, vec2(eps, 0.0)).r;
  float cloudV = sampleMapAt(tClouds, mc, vec2(0.0, eps)).r;
  Tri tcd = triAt(drifted(pc, uCloudShift));
  float dome;
  float ca = cloudCover(cloud, tcd, dome);
  // Cloudlet tops as a height field, domed by the detail, for their relief.
  float hCloud = CLOUDLET_H * pow(ca, 1.5) * (0.45 + 0.55 * dome) * (1.0 - smoothstep(4.0, 6.0, tcd.fine));
  vec3 dpx = dFdx(pc);
  vec3 dpy = dFdy(pc);
  float dhx = dFdx(hCloud);
  float dhy = dFdy(hCloud);
  // The stars as a cube (made from the art's equirect at load): no pole to
  // smear them round. The art lays them out in the world's frame with
  // three's equirect mapping, which the cube keeps: looked up by the world
  // direction, the Milky Way rises where the art composed it.
  vec3 stars = texture(tStars, D).rgb;

  if (hitG) {
    float shadow = 1.0 - 0.85 * shade;
    // Terrain below the map's pixel; water keeps its colour.
    albedo *= pow((0.6 + 0.8 * det.g) * (0.85 + 0.3 * dg2.g), 1.0 - water);
    // The slopes: exaggerated, so ranges stand out in a low sun.
    vec3 eastG = normalize(vec3(ng.z, 0.0, -ng.x) + 1e-6);
    vec3 northG = cross(ng, eastG);
    float latG = asin(clamp(ng.y, -1.0, 1.0));
    float eC = 6.0 * pow(hC, 1.6667) + (det.g - 0.5) * 0.12;
    float eU = 6.0 * pow(hU, 1.6667);
    float eV = 6.0 * pow(hV, 1.6667);
    float step_ = uHeightTexel * 0.35;
    float sx = TERRAIN_RELIEF * (eU - eC) / (step_ * 6.2831853 * R * max(cos(latG), 0.1));
    float sy = TERRAIN_RELIEF * (eV - eC) / (step_ * 3.14159265 * R);
    vec3 nT = normalize(ng - eastG * sx - northG * sy);
    float muN = dot(nT, s);
    vec3 Tsun = lut(0.0, muG);
    vec3 direct = SUN_E * SUN_COLOR * Tsun * max(muN, 0.0) * smoothstep(-0.02, 0.02, muG) * shadow;
    vec3 sky = SUN_E * vec3(0.07, 0.10, 0.16) * pow(clamp(muG + 0.15, 0.0, 1.15), 1.5) * (0.6 + 0.4 * shadow);
    vec3 Lg = albedo * 0.3183099 * (direct + sky);
    // The sun's glint on the water (GGX, Schlick, Smith), roughened by the wind.
    vec3 V = -d;
    vec3 H = normalize(s + V);
    float ndh = clamp(dot(ng, H), 0.0, 1.0);
    float ndv = clamp(dot(ng, V), 1e-3, 1.0);
    float ndl = clamp(muG, 0.0, 1.0);
    float a = OCEAN_ROUGH * (0.75 + 0.5 * det.b);
    float a2 = a * a;
    float dgx = a2 / (3.14159265 * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
    float k_ = a2 / 2.0;
    float gs = (ndv / (ndv * (1.0 - k_) + k_)) * (ndl / (ndl * (1.0 - k_) + k_));
    float fr = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
    float spec = dgx * gs * fr / (4.0 * ndv * max(ndl, 1e-3)) * ndl * shadow * water;
    Lg += SUN_E * SUN_COLOR * Tsun * spec;
    // Near the horizon the sea mirrors the sky.
    Lg += water * (0.02 + 0.98 * pow(1.0 - ndv, 5.0)) * SUN_E * vec3(0.02, 0.035, 0.07) * clamp(muG + 0.1, 0.0, 1.0);
    // City lights in the dark, broken into streets and blocks; the "HI" blinks back when asked.
    float dark = smoothstep(0.06, -0.08, muG);
    float hiBoost = 1.0 + uHi.w * exp(-pow(acos(clamp(dot(ng, uHi.xyz), -1.0, 1.0)) * R / 100.0, 2.0));
    // Broken hard into streets and blocks (mean 1), evened out where the
    // streets are finer than a pixel. Not in the environment light: at the
    // night's exposure they would light the station, which cities cannot.
    float streets = mix(0.08 + 4.6 * pow(streetsAt, 4.0), 1.0, smoothstep(5.5, 7.5, tgd.fine + 3.0));
    vec3 Ln = lights * mix(NIGHT_GAIN_DAY, NIGHT_GAIN_NIGHT, uNight) * uNightScale * dark * hiBoost * streets * (1.0 - uRaw);
    vec3 Ls = Lg + Ln;
    // The clouds, lit from their relief: the map's (thick is high) and the cloudlets'.
    vec3 east = normalize(vec3(xc.z, 0.0, -xc.x) + 1e-6);
    vec3 north = cross(xc, east);
    float lat = asin(clamp(xc.y, -1.0, 1.0));
    float kx = CLOUD_RELIEF * (cloudU - cloud) / (eps * 6.2831853 * R * max(cos(lat), 0.1));
    float ky = CLOUD_RELIEF * (cloudV - cloud) / (eps * 3.14159265 * R);
    vec3 ncl = normalize(xc - east * kx - north * ky);
    // The cloudlets' own relief, from how their height changes across the pixel.
    vec3 r1 = cross(dpy, ncl);
    vec3 r2 = cross(ncl, dpx);
    float det_ = dot(dpx, r1);
    vec3 grad = sign(det_) * (dhx * r1 + dhy * r2);
    ncl = normalize(abs(det_) * ncl - grad);
    float muC = dot(xc, s);
    float muCl = dot(ncl, s);
    vec3 TsunC = lut(CLOUD_H, muC);
    float wrap = pow(clamp((muCl + 0.25) / 1.25, 0.0, 1.0), 1.3);
    float thick = 0.6 + 0.4 * ca;
    vec3 Lc = 0.2928451 * SUN_E * SUN_COLOR * TsunC * wrap * thick;
    Lc += 0.2928451 * SUN_E * vec3(0.08, 0.11, 0.16) * clamp(muC + 0.15, 0.0, 1.15);
    // Forward scattering through thin edges toward the sun.
    Lc += SUN_E * SUN_COLOR * TsunC * phaseM(cosT, 0.6) * (1.0 - ca) * ca * 1.2;
    // Lightning: a storm's flashes light its clouds from inside.
    float storm = uLightning.w * exp(-pow(acos(clamp(dot(xc, uLightning.xyz), -1.0, 1.0)) * R / 55.0, 2.0));
    Lc += storm * vec3(0.72, 0.8, 1.0) * (0.35 + ca) * 6.0;
    Ls = Ls * (1.0 - ca) + Ln * ca * 0.12 + ca * Lc;
    L += Tview * Ls;
  } else {
    // --- space: the stars (only in the planet's shadow, the eye adapted), the Moon ---
    L += Tview * stars * STAR_GAIN * uNight * (1.0 - uRaw);
    if (uMoonShow > 0.0) {
      vec3 m = normalize(uMoon);
      vec3 mr = normalize(cross(m, abs(m.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 mu_ = cross(mr, m);
      float tr = tan(uMoonRadius);
      vec2 q = vec2(dot(D, mr), dot(D, mu_)) / (max(dot(D, m), 1e-4) * tr);
      float rq = length(q);
      if (rq < 1.05) {
        vec3 nm = normalize(mr * q.x + mu_ * q.y - m * sqrt(max(1.0 - rq * rq, 0.0)));
        float maria = smoothstep(0.1, 0.5, snoise(vec3(q * 2.3, 4.0)) * 0.5 + 0.5) * 0.45 + 0.15 * snoise(vec3(q * 11.0, 1.0));
        float moonAlbedo = 0.16 * (1.0 - maria);
        float lambert = max(dot(nm, uSun), 0.0);
        vec3 Lm = vec3(0.98, 0.96, 0.92) * moonAlbedo * 0.3183 * SUN_E * lambert + vec3(0.002, 0.003, 0.004);
        // The flag: a pin-prick of light near the terminator, for a moment.
        Lm += vec3(1.0, 0.95, 0.85) * uFlag * 60.0 * exp(-dot(q - vec2(0.28, -0.12), q - vec2(0.28, -0.12)) / 0.0012);
        float edge = 1.0 - smoothstep(0.985, 1.02, rq);
        L = mix(L, L * (1.0 - Tview) + Tview * Lm, edge * uMoonShow);
      }
    }
  }

  // --- light made up there: the aurora, the airglow -----------------------------
  if (!hitG || tHit > 1500.0) {
    vec3 xt = o + d * max(closest, 0.0);
    float hc = length(xt) - R;
    // A faint green line of airglow ~95 km up, on the night side.
    float nightThere = smoothstep(0.1, -0.1, dot(normalize(xt), s));
    L += vec3(0.3, 1.0, 0.42) * exp(-sq((hc - 95.0) / 5.0)) * 0.006 * nightThere * (hitG ? 0.3 : 1.0);
  }
  L += aurora(o, d, hitG ? tg.x : 1e9, s) * uAurora;

  // For the environment light: the radiance itself, and no sun (the sun light is its own).
  if (uRaw > 0.5) {
    gl_FragColor = vec4(L, 1.0);
    return;
  }
  vec3 c = orbitTone(L);
  // The sun itself, far brighter than anything tone can hold: it blooms.
  if (!hitG) {
    float ang = acos(clamp(dot(D, uSun), -1.0, 1.0));
    float disc = 1.0 - smoothstep(SUN_RADIUS * 0.85, SUN_RADIUS * 1.15, ang);
    float glare = exp(-ang / 0.035) * 0.25 + exp(-ang / 0.006) * 0.8;
    vec3 tint = Tview / max(max(Tview.r, Tview.g), max(Tview.b, 1e-4));
    c += (disc * uSunDisc + glare * uSunDisc * 0.08) * SUN_COLOR * Tview * mix(vec3(1.0), tint, 0.5);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * The backdrop and what it needs: the transmittance table, the planet's
 * place and turn, the sun and Moon, and the night's lights.
 */
export class PlanetSky {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly lutTexture: DataTexture;
  /** World → the planet's frame (its art rotation, then how far the ground has turned). */
  readonly toPlanet = new Matrix3();

  constructor(textures: PlanetTextures, exposure: { value: number }) {
    const table = transmittanceTable();
    const half = new Uint16Array(table.length);
    for (let i = 0; i < table.length; i++) half[i] = DataUtils.toHalfFloat(table[i] as number);
    this.lutTexture = new DataTexture(half, LUT_ANGLES, LUT_HEIGHTS, RGBAFormat, HalfFloatType);
    this.lutTexture.minFilter = LinearFilter;
    this.lutTexture.magFilter = LinearFilter;
    this.lutTexture.needsUpdate = true;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uExposure: exposure,
        uCenter: { value: new Vector3(0, -6800, 0) },
        uToPlanet: { value: this.toPlanet },
        uSun: { value: new Vector3(0, 1, 0) },
        uNight: { value: 0 },
        uCloudShift: { value: 0 },
        uTime: { value: 0 },
        uMoon: { value: new Vector3(0, 0, -1) },
        uMoonRadius: { value: 0.016 },
        uMoonShow: { value: 0 },
        uFlag: { value: 0 },
        uAurora: { value: 0 },
        uLightning: { value: new Vector4(0, 1, 0, 0) },
        uHi: { value: new Vector4(0, 1, 0, 0) },
        uNightMap: { value: new Matrix3() },
        uNightScale: { value: 1 },
        uSunDisc: { value: 40 },
        uRaw: { value: 0 },
        tAlbedo: { value: textures.albedo },
        tClouds: { value: textures.clouds },
        tNight: { value: textures.night },
        tWater: { value: textures.water },
        tHeight: { value: textures.height },
        uHeightTexel: { value: 1 / Math.max(1, (textures.height.image as { width?: number } | null)?.width ?? 4096) },
        tDetail: { value: textures.detail },
        tStars: { value: textures.stars },
        tLut: { value: this.lutTexture },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(new SphereGeometry(10, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    // After the opaque scenery (only the uncovered pixels are shaded), before anything see-through.
    this.mesh.renderOrder = 1000;
    this.mesh.name = "orbit.sky";
  }

  /** A uniform by name, for the world to set. */
  uniform<T>(name: string): { value: T } {
    return this.material.uniforms[name] as { value: T };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.lutTexture.dispose();
  }
}
