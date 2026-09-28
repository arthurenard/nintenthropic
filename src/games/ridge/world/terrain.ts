/**
 * The terrain's shader: the valley's ground, lit at run time. The art paints
 * where each material lies in splat maps (grass, rock, scree, snow in one,
 * dirt and road stone in the next) and gives each material a tileable
 * texture; this blends them by those weights - each sampled at two scales so
 * no repeat shows across a slope, rock projected three ways on cliffs so it
 * never smears, the blend sharpened by each texture's own height so grass
 * grows between stones rather than fading over them - bumps the surface
 * from the same height, lights it with the low sun where the light map
 * says the sun reaches and with the sky everywhere, and puts the valley's
 * air in front of it (atmosphere.ts). Detail where the targets are: the
 * splat's fine map covers the play area at a couple of metres a texel.
 */
import { Color, ShaderMaterial, Vector4, type DataArrayTexture, type Texture } from "three";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "./atmosphere";

export interface SplatSet {
  /** grass, rock, scree, snow */
  a: Texture;
  /** dirt, road, (unused), (unused) */
  b: Texture;
  /** x0, z0, x1, z1 in metres. */
  bounds: [number, number, number, number];
}

export interface TerrainInputs {
  /** The fine splat over the play area. */
  fine: SplatSet;
  /** A coarse one over everything (optional: without it, beyond the fine map, the ground is worked out from its slope and height). */
  coarse: SplatSet | null;
  /** The six materials' albedo (alpha: height), as one texture array, in the splat's order. */
  tiles: DataArrayTexture;
  /** Metres each material's texture covers, near and far. */
  scales: { near: number[]; far: number[] };
}

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D uSplatA;
uniform sampler2D uSplatB;
uniform vec4 uSplatBounds;
uniform sampler2D uCoarseA;
uniform sampler2D uCoarseB;
uniform vec4 uCoarseBounds;
uniform float uHasCoarse;
uniform sampler2DArray uTiles;
uniform float uNear[6];
uniform float uFar[6];
uniform vec3 uTint;
varying vec3 vWorld;
varying vec3 vNormalW;
${ATMOSPHERE_GLSL}

// Every sample takes its gradients from the pixel's own (dx, dy), so a layer
// can be skipped where the splat does not use it - most of the valley uses
// two or three of the six - without upsetting the mipmaps at the edges.
vec4 tile(int layer, vec2 p, vec2 dx, vec2 dy, float dist) {
  float i = float(layer);
  float sn = 1.0 / uNear[layer];
  float sf = 1.0 / uFar[layer];
  vec4 f = textureGrad(uTiles, vec3(p * sf + 0.37, i), dx * sf, dy * sf);
  // Near, the fine texture with the broad one under it; far, only the broad one.
  float k = smoothstep(60.0, 420.0, dist);
  if (k > 0.999) return f;
  vec4 n = textureGrad(uTiles, vec3(p * sn, i), dx * sn, dy * sn);
  vec4 c = mix(n * mix(vec4(1.0), f * 1.9, 0.35), f, k);
  c.a = mix(n.a, f.a, k);
  return c;
}

/** Rock on a cliff: three projections, weighted by which way the face looks (a faint one is skipped). */
vec4 triplanar(int layer, vec3 p, vec3 n, vec3 dx, vec3 dy, float dist) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec4 c = vec4(0.0);
  if (w.x > 0.02) c += tile(layer, p.zy, dx.zy, dy.zy, dist) * w.x;
  if (w.y > 0.02) c += tile(layer, p.xz, dx.xz, dy.xz, dist) * w.y;
  if (w.z > 0.02) c += tile(layer, p.xy, dx.xy, dy.xy, dist) * w.z;
  return c / max(w.x * step(0.02, w.x) + w.y * step(0.02, w.y) + w.z * step(0.02, w.z), 1e-4);
}

void splat(vec3 wp, out vec4 a, out vec2 b) {
  vec2 uv = (wp.xz - uSplatBounds.xy) / (uSplatBounds.zw - uSplatBounds.xy);
  vec4 fa = texture2D(uSplatA, uv);
  vec4 fb = texture2D(uSplatB, uv);
  vec2 edge = min(uv, 1.0 - uv);
  float inside = smoothstep(0.0, 0.02, min(edge.x, edge.y));
  vec4 ca = vec4(1.0, 0.0, 0.0, 0.0);
  vec4 cb = vec4(0.0);
  if (uHasCoarse > 0.5) {
    vec2 cuv = (wp.xz - uCoarseBounds.xy) / (uCoarseBounds.zw - uCoarseBounds.xy);
    ca = texture2D(uCoarseA, cuv);
    cb = texture2D(uCoarseB, cuv);
  } else {
    // No coarse map: rock where it is steep, snow where it is high.
    float slope = 1.0 - vNormalW.y;
    float rock = smoothstep(0.35, 0.55, slope);
    float snow = smoothstep(500.0, 600.0, wp.y + 60.0) * (1.0 - rock);
    ca = vec4(max(0.0, 1.0 - rock - snow), rock, 0.0, snow);
  }
  a = mix(ca, fa, inside);
  b = mix(cb.rg, fb.rg, inside);
}

void main() {
  vec3 wp = vWorld;
  float dist = length(wp - cameraPosition);
  vec3 n = normalize(vNormalW);
  vec4 wa;
  vec2 wb;
  splat(wp, wa, wb);
  // A broad wash of variation over everything, so no two slopes are alike.
  float macro = atmoNoise(wp.xz * 0.011) * 0.6 + atmoNoise(wp.xz * 0.043) * 0.4;

  vec3 dpx = dFdx(wp);
  vec3 dpy = dFdy(wp);
  // Only the layers the splat uses here.
  const float USED = 0.003;
  vec4 grass = vec4(0.0);
  vec4 rock = vec4(0.0);
  vec4 scree = vec4(0.0);
  vec4 snow = vec4(0.0);
  vec4 dirt = vec4(0.0);
  vec4 road = vec4(0.0);
  if (wa.r > USED) grass = tile(0, wp.xz, dpx.xz, dpy.xz, dist);
  if (wa.g > USED) rock = triplanar(1, wp, n, dpx, dpy, dist);
  if (wa.b > USED) scree = tile(2, wp.xz, dpx.xz, dpy.xz, dist);
  if (wa.a > USED) snow = tile(3, wp.xz, dpx.xz, dpy.xz, dist);
  if (wb.r > USED) dirt = tile(4, wp.xz, dpx.xz, dpy.xz, dist);
  if (wb.g > USED) road = tile(5, wp.xz, dpx.xz, dpy.xz, dist);
  // Height-sharpened blend: the taller texture wins where two meet.
  float w[6];
  w[0] = wa.r * (grass.a + 0.35);
  w[1] = wa.g * (rock.a + 0.5);
  w[2] = wa.b * (scree.a + 0.35);
  w[3] = wa.a * (snow.a + 0.5);
  w[4] = wb.r * (dirt.a + 0.35);
  w[5] = wb.g * (road.a + 0.6);
  float top = max(max(max(w[0], w[1]), max(w[2], w[3])), max(w[4], w[5]));
  float sum = 0.0;
  for (int i = 0; i < 6; i++) {
    w[i] = pow(max(w[i] - top * 0.55, 0.0), 1.5);
    sum += w[i];
  }
  sum = max(sum, 1e-4);
  vec4 c = (grass * w[0] + rock * w[1] + scree * w[2] + snow * w[3] + dirt * w[4] + road * w[5]) / sum;
  vec3 albedo = c.rgb * (0.8 + macro * 0.4) * uTint;
  float grassShare = w[0] / sum;
  // Grass is drier and paler in broad drifts and on the high ground, lusher low by the water.
  float drift = smoothstep(0.35, 0.75, atmoNoise(wp.xz * 0.0045 + 3.7));
  albedo = mix(albedo, albedo * vec3(1.12, 1.04, 0.78), grassShare * max(drift * 0.7, smoothstep(-40.0, 200.0, wp.y) * 0.6));
  // The valley floor's meadows: parcels mown at different times, some in stripes, hedges between.
  float floorMask = (1.0 - smoothstep(-56.0, -48.0, wp.y)) * grassShare * (1.0 - smoothstep(600.0, 1400.0, dist));
  if (floorMask > 0.01) {
    vec2 q = mat2(0.95, 0.31, -0.31, 0.95) * wp.xz / vec2(62.0, 44.0);
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float h1 = atmoHash(cell);
    float h2 = atmoHash(cell + 17.0);
    float ang = h1 * 3.1416;
    float stripes = sin(dot(wp.xz, vec2(cos(ang), sin(ang))) * 1.3) * 0.5 + 0.5;
    vec3 tone = mix(vec3(0.94, 1.0, 0.92), vec3(1.1, 1.06, 0.8), h2) * (0.9 + 0.16 * h1);
    tone *= mix(1.0, 0.92 + 0.16 * stripes, step(0.6, h2));
    float edge = min(min(f.x, 1.0 - f.x) * 62.0, min(f.y, 1.0 - f.y) * 44.0);
    float hedge = (1.0 - smoothstep(0.4, 1.3, edge)) * step(0.72, atmoHash(cell + 5.0)) * (0.5 + 0.5 * atmoNoise(wp.xz * 0.2));
    tone *= 1.0 - hedge * 0.22;
    albedo *= mix(vec3(1.0), tone, floorMask);
  }

  // A bump from the blended height (screen-space derivatives: no tangents needed).
  float h = c.a;
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  float bump = 0.9 * (1.0 - smoothstep(80.0, 700.0, dist));
  vec3 nb = normalize(abs(det) * n - bump * grad);

  vec2 light = atmoLight(wp);
  float sun = smoothstep(light.r - 0.012, light.r + 0.012, uSunElev);
  float ao = light.g;
  float lambert = max(dot(nb, uSunDir), 0.0);
  // Snow and wet rock catch a little shine toward the eye from the low sun.
  vec3 direct = uSunColor * lambert * sun;
  vec3 ambient = atmoAmbient(nb, ao);
  vec3 col = albedo * (direct + ambient);
  col = atmoAir(col, wp);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function terrainMaterial(inputs: TerrainInputs, atmosphere: AtmosphereUniforms): ShaderMaterial {
  const f = inputs.fine;
  const c = inputs.coarse;
  return new ShaderMaterial({
    name: "terrain",
    uniforms: {
      ...atmosphere,
      uSplatA: { value: f.a },
      uSplatB: { value: f.b },
      uSplatBounds: { value: new Vector4(...f.bounds) },
      uCoarseA: { value: c?.a ?? f.a },
      uCoarseB: { value: c?.b ?? f.b },
      uCoarseBounds: { value: new Vector4(...(c?.bounds ?? f.bounds)) },
      uHasCoarse: { value: c ? 1 : 0 },
      uTiles: { value: inputs.tiles },
      uNear: { value: inputs.scales.near },
      uFar: { value: inputs.scales.far },
      uTint: { value: new Color(1, 1, 1) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

/** The placeholder's scales: a few metres a repeat near by, forty far off. */
export const DEFAULT_SCALES = {
  near: [3.5, 6, 3, 5, 3, 3.2],
  far: [38, 60, 30, 50, 32, 30],
};
