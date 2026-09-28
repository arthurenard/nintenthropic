/**
 * Everything beyond the station, drawn in one pass as the backdrop: the
 * stars and the Milky Way, the sun, the Moon, and the planet - its ground,
 * oceans with the sun's glint, the cloud deck with its shadows and relief,
 * city lights on the night side - seen through its atmosphere, which is
 * integrated along every eye ray (Rayleigh and Mie scattering, ozone, the
 * sun's light reaching each height through a table of transmittance):
 * the thin blue line at the limb, the haze toward the horizon, the orange
 * band at the terminator. It follows the art's reference renderer
 * (art/orbit/orbitlib/planetrender.py) so the game looks like its renders.
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
uniform float uSunDisc;
uniform float uRaw;
uniform sampler2D tAlbedo;
uniform sampler2D tClouds;
uniform sampler2D tNight;
uniform sampler2D tWater;
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
const float NIGHT_GAIN = 0.6;
const float OCEAN_ROUGH = 0.22;

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
        Lin += (BR * hr + BMS * hm) * 0.0795775 * Tv * ds * 0.35 * clamp(muS + 0.12, 0.0, 1.0) * vec3(0.55, 0.75, 1.0);
        tau += ext * ds;
      }
    }
  }
  vec3 Tview = exp(-tau);
  vec3 L = Lin * SUN_E * SUN_COLOR;

  // --- the ground (or, off the planet, the nearest point of it) --------------
  float tHit = hitG ? tg.x : max(closest, 0.0);
  vec3 xg = o + d * tHit;
  vec3 ng = normalize(xg);
  MapAt mg = mapAt(ng, 0.0);
  vec3 albedo = sampleMap(tAlbedo, mg).rgb;
  float water = sampleMap(tWater, mg).r;
  vec3 lights = sampleMap(tNight, mg).rgb;
  float muG = dot(ng, s);
  // Cloud shadow: the cloud above the point, toward the sun.
  float tanZ = sqrt(max(1.0 - muG * muG, 0.0)) / max(muG, 0.05);
  vec3 sp = normalize(s - ng * muG + 1e-6);
  vec3 xs = normalize(ng * (R + CLOUD_H) + sp * CLOUD_H * min(tanZ, 40.0));
  float shade = sampleMap(tClouds, mapAt(xs, uCloudShift)).r;
  // The cloud deck, 6 km up.
  vec2 tcl = sphere(o, d, R + CLOUD_H);
  vec3 xc = normalize(o + d * (tcl.x > 0.0 && tcl.x < 1e8 ? tcl.x : tHit));
  MapAt mc = mapAt(xc, uCloudShift);
  float cloud = sampleMap(tClouds, mc).r;
  float eps = 0.6 / 2048.0;
  float cloudU = sampleMapAt(tClouds, mc, vec2(eps, 0.0)).r;
  float cloudV = sampleMapAt(tClouds, mc, vec2(0.0, eps)).r;
  // The stars as a cube (made from the art's equirect at load): no pole to
  // smear them round. The cube keeps three's equirect handedness.
  vec3 stars = texture(tStars, vec3(d.x, d.y, -d.z)).rgb;

  if (hitG) {
    // Sub-pixel cloud structure: broken cloud crisp, overcast and clear as they are.
    float detail = snoise(xc * 420.0) * 0.5 + snoise(xc * 1300.0) * 0.25;
    float ca = clamp(cloud + detail * 1.6 * cloud * (1.0 - cloud), 0.0, 1.0);
    float cs = clamp(shade + detail * 1.2 * shade * (1.0 - shade), 0.0, 1.0);
    float shadow = 1.0 - 0.85 * cs;
    vec3 Tsun = lut(0.0, muG);
    vec3 direct = SUN_E * SUN_COLOR * Tsun * max(muG, 0.0) * shadow;
    vec3 sky = SUN_E * vec3(0.07, 0.10, 0.16) * pow(clamp(muG + 0.15, 0.0, 1.15), 1.5) * (0.6 + 0.4 * shadow);
    vec3 Lg = albedo * 0.3183099 * (direct + sky);
    // The sun's glint on the water (GGX, Schlick, Smith).
    vec3 V = -d;
    vec3 H = normalize(s + V);
    float ndh = clamp(dot(ng, H), 0.0, 1.0);
    float ndv = clamp(dot(ng, V), 1e-3, 1.0);
    float ndl = clamp(muG, 0.0, 1.0);
    float a = OCEAN_ROUGH * (0.8 + 0.4 * (snoise(ng * 900.0) * 0.5 + 0.5));
    float a2 = a * a;
    float dg = a2 / (3.14159265 * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
    float k_ = a2 / 2.0;
    float gs = (ndv / (ndv * (1.0 - k_) + k_)) * (ndl / (ndl * (1.0 - k_) + k_));
    float fr = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
    float spec = dg * gs * fr / (4.0 * ndv * max(ndl, 1e-3)) * ndl * shadow * water;
    Lg += SUN_E * SUN_COLOR * Tsun * spec;
    // Near the horizon the sea mirrors the sky.
    Lg += water * (0.02 + 0.98 * pow(1.0 - ndv, 5.0)) * SUN_E * vec3(0.02, 0.035, 0.07) * clamp(muG + 0.1, 0.0, 1.0);
    // City lights in the dark; the "HI" blinks back when asked.
    float dark = smoothstep(0.06, -0.08, muG);
    float hiBoost = 1.0 + uHi.w * exp(-pow(acos(clamp(dot(ng, uHi.xyz), -1.0, 1.0)) * R / 160.0, 2.0));
    // The map's lights are ~10 km a texel; under the station a texel is dozens
    // of pixels. Break each into the scatter of streets and towns it stands for.
    float sparkle = snoise(ng * 2600.0) * 0.5 + 0.5;
    float streets = smoothstep(0.35, 0.95, sparkle) * 2.2 + 0.25 * (snoise(ng * 700.0) * 0.5 + 0.5);
    vec3 Ln = lights * NIGHT_GAIN * dark * hiBoost * mix(1.0, streets, 0.85);
    vec3 Ls = Lg + Ln;
    // The clouds, lit from their relief: thick tops catch a low sun.
    vec3 east = normalize(vec3(xc.z, 0.0, -xc.x) + 1e-6);
    vec3 north = cross(xc, east);
    float lat = asin(clamp(xc.y, -1.0, 1.0));
    float kx = CLOUD_RELIEF * (cloudU - cloud) / (eps * 6.2831853 * R * max(cos(lat), 0.1));
    float ky = CLOUD_RELIEF * (cloudV - cloud) / (eps * 3.14159265 * R);
    kx += detail * 0.35;
    vec3 ncl = normalize(xc - east * kx - north * ky);
    float muC = dot(xc, s);
    float muCl = dot(ncl, s);
    vec3 TsunC = lut(CLOUD_H, muC);
    float wrap = clamp((muCl + 0.35) / 1.35, 0.0, 1.0);
    float thick = 0.55 + 0.45 * ca;
    vec3 Lc = 0.2928451 * SUN_E * SUN_COLOR * TsunC * wrap * thick;
    Lc += 0.2928451 * SUN_E * vec3(0.08, 0.11, 0.16) * clamp(muC + 0.15, 0.0, 1.15);
    Lc += SUN_E * SUN_COLOR * TsunC * phaseM(cosT, 0.6) * (1.0 - ca) * ca * 1.2;
    // Lightning: a storm's flashes light its clouds from inside.
    float storm = uLightning.w * exp(-pow(acos(clamp(dot(xc, uLightning.xyz), -1.0, 1.0)) * R / 55.0, 2.0));
    Lc += storm * vec3(0.72, 0.8, 1.0) * (0.35 + ca) * 6.0;
    Ls = Ls * (1.0 - ca) + Ln * ca * 0.12 + ca * Lc;
    L += Tview * Ls;
  } else {
    // --- space: the stars (only in the planet's shadow, the eye adapted), the Moon ---
    L += Tview * stars * 1.3 * uNight * (1.0 - uRaw);
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
    L += vec3(0.35, 0.85, 0.25) * exp(-pow((hc - 95.0) / 5.0, 2.0)) * 0.02 * nightThere * (hitG ? 0.3 : 1.0);
    if (uAurora > 0.0 && hc > 80.0 && hc < 360.0) {
      vec3 dir = normalize(xt);
      float n1 = snoise(dir * 22.0 + vec3(0.0, uTime * 0.06, 0.0));
      float n2 = snoise(dir * 70.0 + vec3(uTime * 0.12, 0.0, 0.0));
      float curtain = smoothstep(0.0, 0.8, n1 * 0.7 + n2 * 0.3 + 0.2);
      float profile = smoothstep(85.0, 105.0, hc) * exp(-(hc - 105.0) / 70.0);
      vec3 col = mix(vec3(0.2, 1.0, 0.45), vec3(0.75, 0.2, 0.55), smoothstep(150.0, 260.0, hc));
      L += col * profile * curtain * uAurora * 0.08 * (0.25 + 0.75 * nightThere);
    }
  }

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
        uSunDisc: { value: 40 },
        uRaw: { value: 0 },
        tAlbedo: { value: textures.albedo },
        tClouds: { value: textures.clouds },
        tNight: { value: textures.night },
        tWater: { value: textures.water },
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
