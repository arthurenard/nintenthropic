/**
 * Bakes the static world's light, once, at load, on the GPU:
 *
 *  1. The SUN SHADOW: every solid thing in the world drawn from the sun into
 *     one big depth map. Surfaces read it through the shading patch
 *     (shading.ts), so trees, barriers, buildings and tunnels throw soft
 *     shadows onto the road and onto each other, for free, every frame.
 *  2. The OCCLUSION: the world drawn from straight above into a height map,
 *     then one pass over it that measures, for every spot, how much of the
 *     sky the things around it hide (a horizon search, like HBAO, on a height
 *     field). That is what darkens the foot of a barrier, the shade beside a
 *     tree, the road in the lee of a wall.
 *
 * The world is static, so none of this is ever redone. The maps cover the
 * part of the world a camera can see from the track (the track's bounds and
 * a margin); beyond that surfaces are simply lit.
 */
import {
  Color,
  DepthTexture,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RedFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  UnsignedIntType,
  Vector3,
  Vector2,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from "three";
import { castsShadow, type BakeUniforms } from "./shading";

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface BakeOptions {
  /** Unit vector toward the sun. */
  sunDir: Vector3;
  bounds: Bounds;
  /** Pixels on a side of the sun map (0: none) and of the occlusion map (0: none). */
  sunSize: number;
  aoSize: number;
  /** 0..1: how dark the occlusion goes. */
  aoStrength: number;
  /** The reach of the occlusion, metres. */
  aoRadius: number;
  /** When the world has water: the whole terrain's bounds and the pixels on a side of its height map. */
  waterBounds?: Bounds;
  waterSize?: number;
}

const HEIGHT_VERTEX = /* glsl */ `
varying float vY;
void main() {
  vec4 wp = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const HEIGHT_FRAGMENT = /* glsl */ `
uniform float uMinY;
uniform float uRange;
varying float vY;
void main() {
  gl_FragColor = vec4( clamp( ( vY - uMinY ) / uRange, 0.0, 1.0 ), 0.0, 0.0, 1.0 );
}
`;

const AO_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const AO_FRAGMENT = /* glsl */ `
uniform sampler2D uHeight;
uniform float uRange;
uniform float uStrength;
uniform float uRadius;
uniform vec2 uInvMetres;
varying vec2 vUv;
float H( vec2 uv ) { return texture2D( uHeight, uv ).r * uRange; }
void main() {
  float h0 = H( vUv );
  float rot = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
  float occ = 0.0;
  const int DIRS = 14;
  const int STEPS = 7;
  for ( int d = 0; d < DIRS; d ++ ) {
    float a = rot + float( d ) * 6.2831853 / float( DIRS );
    vec2 dir = vec2( cos( a ), sin( a ) );
    float best = 0.0;
    for ( int s = 0; s < STEPS; s ++ ) {
      float t = ( float( s ) + 0.5 ) / float( STEPS );
      float r = uRadius * t * t + 0.12;
      float dh0 = H( vUv + dir * r * uInvMetres ) - h0;
      // Props and barriers shade their surroundings; a cliff, a mesa or a mountain is a landscape, not an obstacle (and from above its lip hangs over its foot).
      float dh = min( dh0 * ( 1.0 - smoothstep( 5.0, 8.0, dh0 ) ), 3.2 );
      // Gentle slopes are hills, not obstacles: only what rises steeper than about twenty degrees counts.
      float fall = 1.0 - clamp( r / ( uRadius * 1.04 ), 0.0, 1.0 );
      best = max( best, dh / r * fall * fall - 0.34 * fall );
    }
    best = max( best, 0.0 );
    occ += best / sqrt( 1.0 + best * best );
  }
  float ao = 1.0 - uStrength * occ / float( DIRS ) * 1.6;
  gl_FragColor = vec4( clamp( ao, 0.0, 1.0 ), h0 / uRange, 0.0, 1.0 );
}
`;

export interface Baked {
  dispose(): void;
}

/**
 * Renders the sun map and the occlusion map of everything under `root` (which
 * must be in `scene`) and binds them to `uniforms`. Everything else in the
 * scene is hidden while it does.
 */
export function bakeStatic(renderer: WebGLRenderer, scene: Scene, root: Object3D, uniforms: BakeUniforms, o: BakeOptions): Baked {
  const b = o.bounds;
  const hidden: Object3D[] = [];
  // Only solid things cast: no sky, glass, glows, particles, light pools, water or lava.
  for (const child of scene.children) {
    if (child !== root && child.visible) {
      child.visible = false;
      hidden.push(child);
    }
  }
  root.traverse((obj) => {
    if (obj === root || !obj.visible) return;
    const m = obj as Mesh;
    const solid = m.isMesh && !obj.userData.noShadow && castsShadow(m.material) && !(m.material as { isShaderMaterial?: boolean }).isShaderMaterial;
    if (!solid && (m.isMesh || (obj as { isPoints?: boolean }).isPoints || (obj as { isLine?: boolean }).isLine || (obj as { isSprite?: boolean }).isSprite)) {
      obj.visible = false;
      hidden.push(obj);
    }
  });

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.enabled;
  const prevAuto = renderer.autoClear;
  renderer.shadowMap.enabled = false;
  renderer.autoClear = true;
  const disposables: { dispose(): void }[] = [];
  const out: Baked = {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };

  try {
    // ── The sun map ──
    if (o.sunSize > 0) {
      const centre = new Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      const cam = new OrthographicCamera(-1, 1, 1, -1, 1, 2);
      cam.position.copy(centre).addScaledVector(o.sunDir, 900);
      cam.lookAt(centre);
      cam.updateMatrixWorld();
      const inv = cam.matrixWorldInverse;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      const p = new Vector3();
      for (const x of [b.minX, b.maxX]) {
        for (const y of [b.minY, b.maxY]) {
          for (const z of [b.minZ, b.maxZ]) {
            p.set(x, y, z).applyMatrix4(inv);
            x0 = Math.min(x0, p.x);
            x1 = Math.max(x1, p.x);
            y0 = Math.min(y0, p.y);
            y1 = Math.max(y1, p.y);
            z0 = Math.min(z0, p.z);
            z1 = Math.max(z1, p.z);
          }
        }
      }
      // A square map on the larger side, so a texel is square.
      const half = Math.max(x1 - x0, y1 - y0) / 2;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      cam.left = cx - half;
      cam.right = cx + half;
      cam.bottom = cy - half;
      cam.top = cy + half;
      // Looking down -z: the nearest thing is at -z1.
      cam.near = Math.max(1, -z1 - 30);
      cam.far = -z0 + 30;
      cam.updateProjectionMatrix();

      const size = o.sunSize;
      const target = new WebGLRenderTarget(size, size, {
        format: RedFormat,
        type: UnsignedByteType,
        depthBuffer: true,
        depthTexture: new DepthTexture(size, size, UnsignedIntType),
        generateMipmaps: false,
      });
      target.depthTexture!.minFilter = NearestFilter;
      target.depthTexture!.magFilter = NearestFilter;
      disposables.push(target, target.depthTexture!);
      const depthMaterial = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
      disposables.push(depthMaterial);
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      scene.overrideMaterial = null;

      uniforms.uSunMap.value = target.depthTexture!;
      uniforms.uSunMat.value.copy(new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      uniforms.uSunInfo.value.x = (half * 2) / size;
      uniforms.uSunInfo.value.y = size;
      uniforms.uSunInfo.value.w = 1;
      uniforms.uSunDirW.value.set(o.sunDir.x, o.sunDir.y, o.sunDir.z, 1 / (cam.far - cam.near));
    }

    // ── The occlusion map ──
    if (o.aoSize > 0) {
      const size = o.aoSize;
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const range = Math.max(1, b.maxY - b.minY);
      const top = new OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 1, range + 20);
      top.up.set(0, 0, -1);
      top.position.set((b.minX + b.maxX) / 2, b.maxY + 10, (b.minZ + b.maxZ) / 2);
      top.lookAt((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2);
      top.updateMatrixWorld();
      const heightTarget = new WebGLRenderTarget(size, size, { format: RGBAFormat, type: HalfFloatType, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
      disposables.push(heightTarget);
      const heightMaterial = new ShaderMaterial({
        vertexShader: HEIGHT_VERTEX,
        fragmentShader: HEIGHT_FRAGMENT,
        side: DoubleSide,
        uniforms: { uMinY: { value: b.minY }, uRange: { value: range } },
      });
      disposables.push(heightMaterial);
      scene.overrideMaterial = heightMaterial;
      renderer.setRenderTarget(heightTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, top);
      scene.overrideMaterial = null;

      const aoTarget = new WebGLRenderTarget(size, size, { format: RGBAFormat, type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
      const aoMaterial = new ShaderMaterial({
        vertexShader: AO_VERTEX,
        fragmentShader: AO_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uHeight: { value: heightTarget.texture },
          uRange: { value: range },
          uStrength: { value: o.aoStrength },
          uRadius: { value: o.aoRadius },
          uInvMetres: { value: new Vector2(1 / w, 1 / d) },
        },
      });
      const quadGeometry = new PlaneGeometry(2, 2);
      const quadScene = new Scene();
      quadScene.add(new Mesh(quadGeometry, aoMaterial));
      disposables.push(aoMaterial, quadGeometry);
      renderer.setRenderTarget(aoTarget);
      renderer.render(quadScene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
      // The height map has done its job; only the occlusion map (which carries the height too) stays.
      heightTarget.dispose();
      disposables.splice(disposables.indexOf(heightTarget), 1);
      disposables.push(aoTarget);

      uniforms.uAoMap.value = aoTarget.texture;
      (globalThis as unknown as { __aoTarget?: unknown }).__aoTarget = aoTarget;
      uniforms.uAoRect.value.set(b.minX, b.maxZ, 1 / w, -1 / d);
      uniforms.uAoInfo.value.set(b.minY, range, 1, 1);
    }

    // ── The coarse height map of the whole terrain, for water ──
    if (o.waterBounds && o.waterSize) {
      const wb = o.waterBounds;
      const size = o.waterSize;
      const w = wb.maxX - wb.minX;
      const d = wb.maxZ - wb.minZ;
      const range = Math.max(1, wb.maxY - wb.minY);
      const top = new OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 1, range + 20);
      top.up.set(0, 0, -1);
      top.position.set((wb.minX + wb.maxX) / 2, wb.maxY + 10, (wb.minZ + wb.maxZ) / 2);
      top.lookAt((wb.minX + wb.maxX) / 2, wb.minY, (wb.minZ + wb.maxZ) / 2);
      top.updateMatrixWorld();
      const target = new WebGLRenderTarget(size, size, { format: RGBAFormat, type: HalfFloatType, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
      disposables.push(target);
      const material = new ShaderMaterial({
        vertexShader: HEIGHT_VERTEX,
        fragmentShader: HEIGHT_FRAGMENT,
        side: DoubleSide,
        uniforms: { uMinY: { value: wb.minY }, uRange: { value: range } },
      });
      disposables.push(material);
      scene.overrideMaterial = material;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, top);
      scene.overrideMaterial = null;
      uniforms.uHeightMap.value = target.texture;
      uniforms.uHeightRect.value.set(wb.minX, wb.maxZ, 1 / w, -1 / d);
      uniforms.uHeightInfo.value.set(wb.minY, range, 0, 1);
    }
  } finally {
    scene.overrideMaterial = null;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.enabled = prevShadow;
    renderer.autoClear = prevAuto;
    for (const obj of hidden) obj.visible = true;
  }
  return out;
}
