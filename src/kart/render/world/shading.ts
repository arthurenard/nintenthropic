/**
 * What every static surface of the world shares: the baked sun shadow and the
 * baked ambient occlusion (bake.ts makes them once, at load), spliced into
 * three's standard PBR shader so the road, the ground, the scenery and the
 * landmarks all read them without a vertex attribute or a second UV set.
 *
 *  - The sun shadow is a depth map of the whole static world seen from the
 *    sun. It multiplies the DIRECTIONAL light only (on top of the dynamic
 *    shadow map that the karts cast), so trees, barriers, buildings and
 *    tunnels throw real soft shadows on the road and on each other.
 *  - The occlusion is a top-down map: for every spot of the world, how
 *    enclosed it is by what stands around it (a barrier's foot, a tree's
 *    shade, the inside of a bend in a wall). It dims the ambient light of
 *    whatever surface is at the top of that spot, so the ground and the
 *    road and the roofs, but not the walls and the undersides.
 */
import { DataTexture, Matrix4, NearestFilter, ShaderChunk, Uniform, Vector4, type Material, type MeshStandardMaterial, type Texture, type WebGLProgramParametersWithUniforms } from "three";

export interface BakeUniforms {
  /** Depth texture of the world from the sun (a comparison sampler). */
  uSunMap: Uniform<Texture | null>;
  /** World to the sun map's 0..1 clip space. */
  uSunMat: Uniform<Matrix4>;
  /** x: metres per texel, y: size in texels, z: strength of a sun shadow (0..1), w: 1 when a map is bound. */
  uSunInfo: Uniform<Vector4>;
  /** xyz: the direction to the sun; w: 1 / the depth range of the map in metres. */
  uSunDirW: Uniform<Vector4>;
  /** Occlusion (r) and top height (g), over the world rect. */
  uAoMap: Uniform<Texture | null>;
  /** minX, minZ, 1/sizeX, 1/sizeZ */
  uAoRect: Uniform<Vector4>;
  /** x: height at g = 0, y: height range, z: strength, w: 1 when a map is bound. */
  uAoInfo: Uniform<Vector4>;
  /** The whole terrain's height from above, coarse, for water that reads its own depth (only built where there is water). */
  uHeightMap: Uniform<Texture | null>;
  uHeightRect: Uniform<Vector4>;
  uHeightInfo: Uniform<Vector4>;
}

/** A one-pixel texture to stand in until a map is baked (a sampler must always have one). */
function blank(): DataTexture {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.magFilter = t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

export function makeBakeUniforms(): BakeUniforms {
  return {
    uSunMap: new Uniform<Texture | null>(blank()),
    uSunMat: new Uniform(new Matrix4()),
    uSunInfo: new Uniform(new Vector4(0.2, 2048, 0.9, 0)),
    uSunDirW: new Uniform(new Vector4(0, 1, 0, 0.003)),
    uAoMap: new Uniform<Texture | null>(blank()),
    uAoRect: new Uniform(new Vector4(0, 0, 1, 1)),
    uAoInfo: new Uniform(new Vector4(0, 1, 1, 0)),
    uHeightMap: new Uniform<Texture | null>(blank()),
    uHeightRect: new Uniform(new Vector4(0, 0, 1, 1)),
    uHeightInfo: new Uniform(new Vector4(0, 1, 0, 0)),
  };
}

const COMMON_VERTEX = /* glsl */ `
#include <common>
varying vec3 vWorldP;
`;

const WORLD_POS = /* glsl */ `
#include <project_vertex>
{
  vec4 gwp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    gwp = instanceMatrix * gwp;
  #endif
  vWorldP = ( modelMatrix * gwp ).xyz;
}
`;

const COMMON_FRAGMENT = /* glsl */ `
#include <common>
varying vec3 vWorldP;
uniform sampler2D uSunMap;
uniform mat4 uSunMat;
uniform vec4 uSunInfo;
uniform vec4 uSunDirW;
uniform sampler2D uAoMap;
uniform vec4 uAoRect;
uniform vec4 uAoInfo;

// Sun visibility from the baked depth map: 0 in shadow, 1 in the light. Soft edges from a rotated disc of taps.
float bakedSun( vec3 p, vec3 n ) {
  if ( uSunInfo.w < 0.5 ) return 1.0;
  float ndl = clamp( dot( n, uSunDirW.xyz ), 0.0, 1.0 );
  // Push the point out along its normal by a couple of texels (more on a grazing surface) before looking it up.
  vec3 q = p + n * uSunInfo.x * ( 1.2 + 2.6 * ( 1.0 - ndl ) );
  vec4 c = uSunMat * vec4( q, 1.0 );
  vec2 e = abs( c.xy - 0.5 );
  if ( max( e.x, e.y ) > 0.5 || c.z > 1.0 ) return 1.0;
  float fade = 1.0 - smoothstep( 0.44, 0.5, max( e.x, e.y ) );
  float inv = 1.0 / uSunInfo.y;
  float phi = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
  float z = c.z - uSunDirW.w * ( 0.08 + 0.25 * ( 1.0 - ndl ) );
  float vis = 0.0;
  const int TAPS = 12;
  for ( int i = 0; i < TAPS; i ++ ) {
    float r = sqrt( ( float( i ) + 0.5 ) / float( TAPS ) );
    float a = float( i ) * 2.399963 + phi;
    vis += step( z, texture2D( uSunMap, c.xy + vec2( cos( a ), sin( a ) ) * r * 2.4 * inv ).r );
  }
  vis /= float( TAPS );
  return mix( 1.0, mix( 1.0 - uSunInfo.z, 1.0, vis ), fade );
}

float bakedAO( vec3 p ) {
  if ( uAoInfo.w < 0.5 ) return 1.0;
  vec2 uv = ( p.xz - uAoRect.xy ) * uAoRect.zw;
  if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return 1.0;
  vec2 t = texture2D( uAoMap, uv ).rg;
  float top = uAoInfo.x + t.g * uAoInfo.y;
  // Only the surface at the top of this spot is darkened by it; things below that surface or beside it are not.
  float w = 1.0 - smoothstep( 0.12, 0.9, top - p.y );
  return mix( 1.0, t.r, w * uAoInfo.z );
}
`;

/** The directional light's call to RE_Direct, with the baked sun in front of it. */
function withBakedSun(chunk: string): string {
  const start = chunk.indexOf("#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )");
  if (start < 0) return chunk;
  const call = "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
  const at = chunk.indexOf(call, start);
  if (at < 0) return chunk;
  const bake = "directLight.color *= bakedSun( vWorldP, normalize( transformNormalByInverseViewMatrix( geometryNormal, viewMatrix ) ) );\n\t\t";
  return chunk.slice(0, at) + bake + chunk.slice(at);
}

const LIGHTS_BEGIN = withBakedSun(ShaderChunk.lights_fragment_begin);

const AO_APPLY = /* glsl */ `
#include <aomap_fragment>
{
  float bao = bakedAO( vWorldP );
  reflectedLight.indirectDiffuse *= bao;
  reflectedLight.indirectSpecular *= bao;
  reflectedLight.directDiffuse *= mix( 1.0, bao, 0.4 );
}
`;

/**
 * Makes a standard (or physical) material read the baked sun and occlusion.
 * `variant` names the material's own further patches, so differently patched
 * materials never share a program by accident.
 */
export function bakedLit<M extends MeshStandardMaterial>(material: M, uniforms: BakeUniforms, variant = "", extra?: (shader: WebGLProgramParametersWithUniforms) => void): M {
  material.onBeforeCompile = (shader) => {
    for (const [k, u] of Object.entries(uniforms)) shader.uniforms[k] = u;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", COMMON_VERTEX).replace("#include <project_vertex>", WORLD_POS);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", COMMON_FRAGMENT)
      .replace("#include <lights_fragment_begin>", LIGHTS_BEGIN)
      .replace("#include <aomap_fragment>", AO_APPLY);
    extra?.(shader);
  };
  material.customProgramCacheKey = () => `baked${variant}`;
  return material;
}

/** True for materials that should not cast into the baked sun map (glass, glows, ribbons of light). */
export function castsShadow(material: Material | Material[]): boolean {
  const m = Array.isArray(material) ? material[0] : material;
  if (!m) return false;
  if (m.transparent && m.opacity < 0.99) return false;
  if ((m as { blending?: number }).blending === 2) return false; // AdditiveBlending
  return true;
}
