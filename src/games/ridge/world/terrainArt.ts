/**
 * The real valley's ground, as art/ridge/README.md specifies it: five maps
 * in the eye's own log-polar layout (TEXCOORD_0) - the macro colour, a
 * world-space normal, two splats of eight materials and the light map (sky
 * visibility, the sun's horizon angle, the canopy's shadow, the mist's
 * density) - and eight tileable materials (albedo, normal, height/roughness/
 * AO) laid over them at their real size: world XZ from above, triplanar for
 * rock and scree, with a second, larger and turned sample to break the
 * meadow's repeat through the scope.
 *
 * The cost is watched: a tile is sampled only where the splat uses it (most
 * of the valley uses two or three of the eight), the anti-tiling sample
 * stops at 500 m and the tiles themselves at a kilometre, where they
 * average to one anyway and the macro colour is all there is to see.
 */
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  RGBAFormat,
  Vector3,
  type Texture,
} from "three";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "./atmosphere";
import type { TerrainArtSpec } from "./valley";

/** The loaded maps and tiles. */
export interface TerrainArtInputs {
  spec: TerrainArtSpec;
  color: Texture;
  normal: Texture;
  splat0: Texture;
  splat1: Texture;
  light: Texture;
  /** Eight layers each, in the spec's tile order. */
  albedo: DataArrayTexture;
  normals: DataArrayTexture;
  hra: DataArrayTexture;
}

/** The side of every tile layer in the arrays, texels: plenty at a tile's few metres, through the scope. */
export const TILE_TEXELS = 512;

/** Eight images of any size, drawn to one size and stacked as a texture array (raw bytes: the shader decodes sRGB). */
export function tileArray(images: CanvasImageSource[], size = TILE_TEXELS): DataArrayTexture {
  const layers = images.length;
  const data = new Uint8Array(size * size * 4 * layers);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  images.forEach((img, i) => {
    g.clearRect(0, 0, size, size);
    g.drawImage(img, 0, 0, size, size);
    data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
  });
  const t = new DataArrayTexture(data, size, size, layers);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.colorSpace = NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vMap;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vMap = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform sampler2D uSplat0;
uniform sampler2D uSplat1;
uniform sampler2D uLightArt;
uniform sampler2DArray uAlb;
uniform sampler2DArray uNrm;
uniform sampler2DArray uHra;
uniform float uInvSize[8];
uniform vec3 uInvMean[8];
uniform float uTri[8];
uniform float uExposureK;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vMap;
${ATMOSPHERE_GLSL}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

const mat2 ROT37 = mat2(0.7986, 0.6018, -0.6018, 0.7986);

// One tile seen from above: albedo relative to its mean, a normal nudge in world space, its height/roughness/AO.
void flatTile(int i, vec2 p, vec2 dx, vec2 dy, vec3 ng, float anti, out vec3 alb, out vec3 dn, out vec3 hra) {
  float s = uInvSize[i];
  float layer = float(i);
  vec2 uv = p * s;
  alb = toLinear(textureGrad(uAlb, vec3(uv, layer), dx * s, dy * s).rgb) * uInvMean[i];
  if (anti > 0.0) {
    float s2 = s / 2.618;
    vec2 uv2 = ROT37 * p * s2 + vec2(0.37, 0.61);
    vec3 a2 = toLinear(textureGrad(uAlb, vec3(uv2, layer), ROT37 * dx * s2, ROT37 * dy * s2).rgb) * uInvMean[i];
    alb *= mix(vec3(1.0), 0.5 + 0.5 * a2, anti);
  }
  vec3 tn = textureGrad(uNrm, vec3(uv, layer), dx * s, dy * s).xyz * 2.0 - 1.0;
  // Tangent = world X, bitangent = world -Z (p.y is -z): bent onto the geometric normal.
  dn = normalize(ng + vec3(tn.x, 0.0, -tn.y)) - ng;
  hra = textureGrad(uHra, vec3(uv, layer), dx * s, dy * s).rgb;
}

// Rock and scree on steep ground: three projections, by which way the ground faces.
void triTile(int i, vec3 wp, vec3 dpx, vec3 dpy, vec3 ng, out vec3 alb, out vec3 dn, out vec3 hra) {
  vec3 b = pow(abs(ng), vec3(4.0));
  b /= (b.x + b.y + b.z);
  float s = uInvSize[i];
  float layer = float(i);
  alb = vec3(0.0);
  dn = vec3(0.0);
  hra = vec3(0.0);
  if (b.x > 0.02) {
    vec2 uv = wp.zy * s;
    vec2 gx = dpx.zy * s;
    vec2 gy = dpy.zy * s;
    alb += toLinear(textureGrad(uAlb, vec3(uv, layer), gx, gy).rgb) * b.x;
    vec3 tn = textureGrad(uNrm, vec3(uv, layer), gx, gy).xyz * 2.0 - 1.0;
    dn += vec3(0.0, tn.y, tn.x * sign(ng.x)) * b.x;
    hra += textureGrad(uHra, vec3(uv, layer), gx, gy).rgb * b.x;
  }
  if (b.y > 0.02) {
    vec2 uv = vec2(wp.x, -wp.z) * s;
    vec2 gx = vec2(dpx.x, -dpx.z) * s;
    vec2 gy = vec2(dpy.x, -dpy.z) * s;
    alb += toLinear(textureGrad(uAlb, vec3(uv, layer), gx, gy).rgb) * b.y;
    vec3 tn = textureGrad(uNrm, vec3(uv, layer), gx, gy).xyz * 2.0 - 1.0;
    dn += vec3(tn.x, 0.0, -tn.y) * b.y;
    hra += textureGrad(uHra, vec3(uv, layer), gx, gy).rgb * b.y;
  }
  if (b.z > 0.02) {
    vec2 uv = wp.xy * s;
    vec2 gx = dpx.xy * s;
    vec2 gy = dpy.xy * s;
    alb += toLinear(textureGrad(uAlb, vec3(uv, layer), gx, gy).rgb) * b.z;
    vec3 tn = textureGrad(uNrm, vec3(uv, layer), gx, gy).xyz * 2.0 - 1.0;
    dn += vec3(tn.x, tn.y, 0.0) * b.z;
    hra += textureGrad(uHra, vec3(uv, layer), gx, gy).rgb * b.z;
  }
  float used = b.x * step(0.02, b.x) + b.y * step(0.02, b.y) + b.z * step(0.02, b.z);
  used = max(used, 1e-4);
  alb = alb / used * uInvMean[i];
  hra /= used;
  dn /= used;
}

void main() {
  vec3 wp = vWorld;
  float dist = length(wp - cameraPosition);
  vec3 ng = normalize(vNormalW);
  vec3 dpx = dFdx(wp);
  vec3 dpy = dFdy(wp);
  vec2 p = vec2(wp.x, -wp.z);
  vec2 px = vec2(dpx.x, -dpx.z);
  vec2 py = vec2(dpy.x, -dpy.z);

  vec3 macro = toLinear(texture(uColor, vMap).rgb);
  vec3 mapN = normalize(texture(uNormal, vMap).xyz * 2.0 - 1.0);
  vec4 s0 = texture(uSplat0, vMap);
  vec4 s1 = texture(uSplat1, vMap);
  vec4 lm = texture(uLightArt, vMap);
  // The maps begin 30 m out: closer, their first row is stretched to the eye in streaks.
  // There the ground takes its own normal and a blurred sample of the maps' near edge.
  float inMaps = smoothstep(24.0, 34.0, length(wp.xz));
  if (inMaps < 1.0) {
    vec2 edge = vec2(vMap.x, 0.975);
    macro = mix(toLinear(textureLod(uColor, edge, 5.0).rgb), macro, inMaps);
    mapN = normalize(mix(ng, mapN, inMaps));
    lm = mix(textureLod(uLightArt, edge, 5.0), lm, inMaps);
  }
  float splat[8];
  splat[0] = s0.r; splat[1] = s0.g; splat[2] = s0.b; splat[3] = s0.a;
  splat[4] = s1.r; splat[5] = s1.g; splat[6] = s1.b; splat[7] = s1.a;
  // The weights should sum to one. Where a map lost its colour channels under a zero alpha
  // (a WebP encoder's habit), the missing share is given out as the ground's own look says:
  // rock where it is steep, snow where the colour is white, grass where it is green, alpine
  // turf and dirt where it is brown.
  float total = s0.r + s0.g + s0.b + s0.a + s1.r + s1.g + s1.b + s1.a;
  float missing = clamp(1.0 - total, 0.0, 1.0);
  if (missing > 0.01) {
    float lum = dot(macro, vec3(0.2126, 0.7152, 0.0722));
    float steep = 1.0 - smoothstep(0.55, 0.78, mapN.y);
    float white = smoothstep(0.3, 0.55, lum) * (1.0 - steep * 0.5);
    float rest = max(0.0, 1.0 - steep - white);
    float green = smoothstep(-0.005, 0.02, macro.g - macro.r);
    splat[1] += missing * steep;
    splat[3] += missing * white;
    splat[0] += missing * rest * green;
    splat[7] += missing * rest * (1.0 - green) * 0.7;
    splat[4] += missing * rest * (1.0 - green) * 0.3;
  }

  // The tiles, near enough to matter: height-weighted, each relative to its own mean.
  float near = 1.0 - smoothstep(700.0, 1000.0, dist);
  float anti = 1.0 - smoothstep(350.0, 500.0, dist);
  vec3 detail = vec3(1.0);
  vec3 dN = vec3(0.0);
  float tileAO = 1.0;
  if (near > 0.0) {
    vec3 albSum = vec3(0.0);
    vec3 dnSum = vec3(0.0);
    float aoSum = 0.0;
    float wSum = 0.0;
    for (int i = 0; i < 8; i++) {
      if (splat[i] < 0.004) continue;
      vec3 alb;
      vec3 dn;
      vec3 hra;
      if (uTri[i] > 0.5) triTile(i, wp, dpx, dpy, ng, alb, dn, hra);
      else flatTile(i, p, px, py, ng, anti, alb, dn, hra);
      float wi = splat[i] * (hra.r + 0.25);
      albSum += alb * wi;
      dnSum += dn * wi;
      aoSum += hra.b * wi;
      wSum += wi;
    }
    wSum = max(wSum, 1e-4);
    detail = mix(vec3(1.0), albSum / wSum, near);
    dN = dnSum / wSum * near;
    tileAO = mix(1.0, aoSum / wSum, near);
  }

  vec3 albedo = macro * detail;
  vec3 n = normalize(mapN + dN);
  float ao = lm.r * tileAO;
  float elevDeg = degrees(uSunElev);
  float gDeg = lm.g * 40.0 - 10.0;
  float sunlit = smoothstep(gDeg - 0.5, gDeg + 0.5, elevDeg) * mix(lm.b, 1.0, smoothstep(5.5, 9.0, elevDeg));
  vec3 direct = uSunColor * sunlit * max(dot(n, uSunDir), 0.0);
  vec3 col = albedo * (direct + atmoAmbient(n, ao));
  col = atmoAirK(col, wp, mix(0.35, 1.0, sunlit), lm.a);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function terrainArtMaterial(inputs: TerrainArtInputs, atmosphere: AtmosphereUniforms): ShaderMaterial {
  const tiles = inputs.spec.tiles;
  const pad = <T>(a: T[], fill: T) => [...a, ...Array.from({ length: Math.max(0, 8 - a.length) }, () => fill)].slice(0, 8);
  for (const t of [inputs.normal, inputs.splat0, inputs.splat1, inputs.light]) t.colorSpace = NoColorSpace;
  // The shader decodes the colour map itself, like the tiles.
  inputs.color.colorSpace = NoColorSpace;
  for (const t of [inputs.color, inputs.normal, inputs.splat0, inputs.splat1, inputs.light]) {
    t.anisotropy = 8;
    t.needsUpdate = true;
  }
  return new ShaderMaterial({
    name: "terrain.art",
    uniforms: {
      ...atmosphere,
      uColor: { value: inputs.color },
      uNormal: { value: inputs.normal },
      uSplat0: { value: inputs.splat0 },
      uSplat1: { value: inputs.splat1 },
      uLightArt: { value: inputs.light },
      uAlb: { value: inputs.albedo },
      uNrm: { value: inputs.normals },
      uHra: { value: inputs.hra },
      uInvSize: { value: pad(tiles.map((t) => 1 / t.size), 1 / 3) },
      uInvMean: { value: pad(tiles.map((t) => new Vector3(1 / Math.max(0.01, t.mean[0]), 1 / Math.max(0.01, t.mean[1]), 1 / Math.max(0.01, t.mean[2]))), new Vector3(1, 1, 1)) },
      uTri: { value: pad(tiles.map((t) => (t.triplanar ? 1 : 0)), 0) },
      uExposureK: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

export { SRGBColorSpace };
