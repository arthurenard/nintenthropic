/**
 * The one material every kart, driver and held item is drawn with: a physical
 * (clear-coat) PBR material whose colour, metalness, roughness, clear coat and
 * glow come from the vertex data, so a whole kart (candy paint, chrome, rubber,
 * lamps) is one merged mesh and one draw call, and every kart shares one
 * shader program. A little sky-coloured rim light is added in the shader so a
 * driver reads against any background.
 *
 * Vertex data: `color` (linear RGB) and `aSurf` = (metalness, roughness,
 * clear coat, glow), the glow being how much of the colour is emitted (the
 * post-process bloom picks up what is over-bright).
 *
 * The reflections come from `scene.environment`, which the renderer feeds from
 * the sky. A scene without one (the turntable, a portrait, an older build)
 * gets a bright studio-sky environment the first time a kart is drawn.
 */
import {
  BackSide,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";

/** What a surface is made of: metalness, roughness, clear coat strength, glow. */
export type Surf = readonly [number, number, number, number];

export const SURF = {
  /** Candy paint under a deep clear coat. */
  paint: [0.32, 0.3, 1, 0] as Surf,
  /** Pale paint, white trims. */
  trim: [0.05, 0.34, 1, 0] as Surf,
  /** Gold: half metal, half rich paint, so it stays gold whatever it reflects (a blue sky tints a pure metal brown). */
  gold: [0.88, 0.2, 1, 0.07] as Surf,
  chrome: [1, 0.1, 0, 0] as Surf,
  steel: [0.9, 0.34, 0, 0] as Surf,
  rubber: [0, 0.86, 0, 0] as Surf,
  plastic: [0.02, 0.5, 0.55, 0] as Surf,
  /** Eyes, visors, lenses: wet-looking. */
  gloss: [0, 0.08, 1, 0] as Surf,
  glass: [0.55, 0.05, 1, 0] as Surf,
  fur: [0, 0.82, 0, 0] as Surf,
  cloth: [0, 0.7, 0.2, 0] as Surf,
  /** Lamps and anything that shines by itself. */
  lamp: [0, 0.3, 0.5, 1] as Surf,
  glow: (amount: number): Surf => [0, 0.4, 0.3, amount],
} as const;

/** Shared look knobs, tweakable at run time. */
export const kartLook = {
  /** The sky-coloured rim light added to every surface (linear). */
  rim: new Color(0.42, 0.58, 0.95),
  rimStrength: 0.55,
};

let shared: MeshPhysicalMaterial | null = null;
const rimUniform = { value: new Color() };

/** The shared kart material. */
export function kartMaterial(): MeshPhysicalMaterial {
  if (shared) return shared;
  const m = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    envMapIntensity: 1,
  });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uRim = rimUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aSurf;\nvarying vec4 vSurf;")
      .replace("#include <color_vertex>", "#include <color_vertex>\nvSurf = aSurf;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vSurf;\nuniform vec3 uRim;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.x;\nroughnessFactor = vSurf.y;")
      .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= vSurf.z;\n#endif")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vSurf.w;
        {
          vec3 rimView = normalize(vViewPosition);
          float rimF = pow(1.0 - saturate(dot(normal, rimView)), 2.4);
          float rimUp = 0.35 + 0.65 * saturate(inverseTransformDirection(normal, viewMatrix).y * 0.5 + 0.55);
          totalEmissiveRadiance += uRim * rimF * rimUp * (1.0 - 0.8 * vSurf.x) * (1.0 - vSurf.w);
        }`,
      );
  };
  m.customProgramCacheKey = () => "grip-kart-uber-2";
  shared = m;
  return m;
}

/** Applies `kartLook` to the shader (call after changing it). */
export function syncKartLook(): void {
  rimUniform.value.copy(kartLook.rim).multiplyScalar(kartLook.rimStrength);
}
syncKartLook();

/** Gives a merged geometry its surface attribute (the same surface for every vertex). */
export function withSurf(geometry: BufferGeometry, surf: Surf): BufferGeometry {
  const n = geometry.getAttribute("position").count;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set(surf, i * 4);
  geometry.setAttribute("aSurf", new Float32BufferAttribute(a, 4));
  return geometry;
}

// ── The studio-sky environment for scenes that bring none ───────────────────

const environments = new WeakMap<WebGLRenderer, Texture>();

/** A bright sky, a warm horizon, a dark ground, a sun and two soft boxes, as a prefiltered environment. */
export function studioEnvironment(renderer: WebGLRenderer): Texture {
  const hit = environments.get(renderer);
  if (hit) return hit;
  const scene = new Scene();
  const dome = new Mesh(
    new SphereGeometry(50, 48, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { sun: { value: new Vector3(0.45, 0.62, -0.5).normalize() } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `varying vec3 vDir; uniform vec3 sun;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 zenith = vec3(0.10, 0.28, 0.85);
          vec3 horizon = vec3(1.25, 1.2, 1.1);
          vec3 ground = vec3(0.42, 0.45, 0.42);
          vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.5)) : mix(horizon * 0.7, ground, smoothstep(0.0, 0.3, -h));
          c = mix(c, vec3(0.06, 0.065, 0.07), smoothstep(0.5, 1.0, -h));
          float s = max(dot(d, sun), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (pow(s, 380.0) * 60.0 + pow(s, 14.0) * 0.9);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(dome);
  // Soft boxes: long bright panels overhead, so the clear coat has something crisp to reflect.
  const panel = new MeshBasicMaterial({ color: new Color(7, 7, 7.4), side: BackSide });
  const top = new Mesh(new PlaneGeometry(26, 9), panel);
  top.position.set(0, 30, -6);
  top.rotation.x = Math.PI / 2;
  const side = new Mesh(new PlaneGeometry(12, 22), new MeshBasicMaterial({ color: new Color(4.5, 4.4, 4.2), side: BackSide }));
  side.position.set(-32, 9, 4);
  side.rotation.y = Math.PI / 2;
  const back = new Mesh(new PlaneGeometry(22, 7), new MeshBasicMaterial({ color: new Color(3.2, 3.4, 4.2), side: BackSide }));
  back.position.set(8, 12, 32);
  back.rotation.y = Math.PI;
  scene.add(top, side, back);
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.015, 0.1, 100).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    }
  });
  environments.set(renderer, texture);
  return texture;
}

/** Gives a scene that has no environment the studio sky; a scene that already has one (the race's, from its sky) is left alone. */
export function useStudioEnvironment(scene: Scene, renderer: WebGLRenderer): void {
  if (scene.environment) return;
  scene.environment = studioEnvironment(renderer);
  // The scene has its own lights; the studio sky only adds the reflections and a little fill.
  scene.environmentIntensity = 0.75;
}

/**
 * Hooks a mesh so the first frame it is drawn in a scene that has no
 * environment gives the scene the studio sky (`useStudioEnvironment`). A scene
 * that builds its shaders before its first picture calls that itself first,
 * so they are built with the sky they will be drawn with.
 */
export function withStudioFallback(mesh: Object3D): void {
  mesh.onBeforeRender = (renderer, scene) => useStudioEnvironment(scene, renderer);
}
