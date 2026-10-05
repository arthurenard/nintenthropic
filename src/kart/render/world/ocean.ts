/**
 * Water: a physically based surface (so it reflects the sky and the sun the
 * way water does, more at a glancing angle) whose normals are two
 * rippled maps drifting different ways, coloured by how deep it is (read
 * from the baked height of the ground beneath), with foam where it laps the
 * shore. The harbour's is dark and opaque; the island's sea is clear
 * turquoise over its shallows.
 */
import { Color, MeshStandardMaterial, ShaderChunk, Vector2, type Material, type WebGLProgramParametersWithUniforms } from "three";
import { detailNormal } from "./detail";
import { bakedLit, type BakeUniforms } from "./shading";

export interface OceanOptions {
  deep: string;
  shallow: string;
  /** Opacity over deep water (1 for opaque). */
  alpha: number;
  /** Depth, metres, at which the water has turned fully to its deep colour. */
  shore: number;
  /** The water's own height, to read its depth against the ground. */
  level: number;
  foam: number;
  roughness: number;
  /** Metres one repeat of the ripples covers. */
  ripple: number;
  anisotropy: number;
}

export interface Ocean {
  material: Material;
  update(time: number): void;
  dispose(): void;
}

export function oceanMaterial(o: OceanOptions, bake: BakeUniforms): Ocean {
  const normal = detailNormal("water", 256, o.anisotropy);
  // The plane's uv is 0..1 over its whole size; the ripples tile by the metre.
  const uniforms = {
    uTime: { value: 0 },
    uWaterY: { value: o.level },
    uShore: { value: o.shore },
    uDeep: { value: new Color(o.deep) },
    uShallow: { value: new Color(o.shallow) },
    uBaseAlpha: { value: o.alpha },
    uFoam: { value: o.foam },
  };
  const patch = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    const chunk = ShaderChunk.normal_fragment_maps.replace(
      "vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;",
      `vec3 mapN = ( texture2D( normalMap, vNormalMapUv + vec2( uTime * 0.012, uTime * 0.007 ) ).xyz + texture2D( normalMap, vNormalMapUv * 1.73 + vec2( -uTime * 0.009, uTime * 0.014 ) ).xyz ) - 1.0;`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
uniform float uWaterY;
uniform float uShore;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uBaseAlpha;
uniform float uFoam;
uniform sampler2D uHeightMap;
uniform vec4 uHeightRect;
uniform vec4 uHeightInfo;
float wh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wn( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wh( i ), wh( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wh( i + vec2( 0.0, 1.0 ) ), wh( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float waterDepth = 60.0;
if ( uHeightInfo.w > 0.5 ) {
  vec2 wuv = ( vWorldP.xz - uHeightRect.xy ) * uHeightRect.zw;
  if ( wuv.x > 0.0 && wuv.x < 1.0 && wuv.y > 0.0 && wuv.y < 1.0 ) waterDepth = uWaterY - ( uHeightInfo.x + texture2D( uHeightMap, wuv ).r * uHeightInfo.y );
}
float shallow = 1.0 - smoothstep( 0.0, uShore, waterDepth );
diffuseColor.rgb = mix( uDeep, uShallow, shallow );
float foamN = wn( vWorldP.xz * 1.1 + uTime * 0.25 ) * 0.55 + wn( vWorldP.xz * 3.7 - uTime * 0.4 ) * 0.45;
float foam = smoothstep( 0.6, 0.02, waterDepth ) * smoothstep( 0.3, 0.7, foamN + 0.3 * sin( uTime * 1.1 + waterDepth * 16.0 ) ) * uFoam;
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), foam );
diffuseColor.a = max( mix( uBaseAlpha, 0.1, shallow ), foam );`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.9, foam );")
      .replace("#include <normal_fragment_maps>", chunk)
      .replace(
        "#include <opaque_fragment>",
        `{
  float nv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  diffuseColor.a = clamp( diffuseColor.a + pow( 1.0 - nv, 3.0 ) * 0.65, 0.0, 1.0 );
}
#include <opaque_fragment>`,
      );
  };
  const material = bakedLit(
    new MeshStandardMaterial({
      color: 0xffffff,
      roughness: o.roughness,
      metalness: 0,
      normalMap: normal,
      normalScale: new Vector2(0.55, 0.55),
      transparent: o.alpha < 1,
      depthWrite: o.alpha >= 1,
    }),
    bake,
    `ocean-${o.alpha < 1 ? "clear" : "deep"}`,
    patch,
  );
  return {
    material,
    update(time) {
      uniforms.uTime.value = time;
    },
    dispose() {
      normal.dispose();
      material.dispose();
    },
  };
}
