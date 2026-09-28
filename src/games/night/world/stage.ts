import {
  BackSide,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { Quality } from "../../../engine/types";
import { contractName } from "../../../engine/world/names";
import { disposeTree, fitShadowCamera, shadowMapSize } from "../../../engine/world/scene";
import { SkyLight } from "../../../engine/world/sky";
import type { SignLetter } from "../rules/secrets";
import type { RoadLayout } from "./road";
import { bakedMaterial, nightUniforms, type NightUniforms } from "./shading";

/** The streetlight's sodium, and the neon's red, for the characters that stand in them. */
export const SODIUM = new Color(1.0, 0.56, 0.23);
export const NEON = new Color(1.0, 0.16, 0.24);

/** How strong the streetlight's baked light is where its `flicker` mask is 1 (the bake's own units). */
const STREET_TINT = SODIUM.clone().multiplyScalar(1.0);

/**
 * The scene Dead of Night draws: the baked road in its night material
 * (./shading.ts: the lit bake, the flashlight on its albedo, the lamp's
 * flicker, the fog), the night sky as the background and, through PMREM,
 * as the faint environment light for everything that moves; the moon as a
 * directional light matching the bake's `moon` node, casting the moving
 * things' shadows onto `ground.shadow`; the streetlight and the neon as
 * point lights for the characters under them; a haze over the sky's
 * horizon that thickens with the fog.
 */
export class Stage {
  readonly scene = new Scene();
  readonly u: NightUniforms = nightUniforms();
  readonly moon = new DirectionalLight(0xffffff, 1);
  readonly street = new PointLight(0xffffff, 0, 30, 2);
  readonly neon = new PointLight(0xffffff, 0, 16, 2);
  /** Characters, jars, props in motion. */
  readonly dynamic = new Group();
  readonly fxRoot = new Group();
  readonly moonDirection: Vector3;
  /** Each neon letter's material, to dim one shot out. */
  readonly letters = new Map<SignLetter, ShaderMaterial>();
  /** The lamp in the streetlight's head (the placeholder's; the real bake carries its own in the flicker mask). */
  lampGlow: ShaderMaterial | null = null;
  /** The drive-in's screen, whose picture the secret plays. */
  screen: Mesh | null = null;
  private readonly sky: SkyLight;
  private readonly shadowMaterial: ShadowMaterial;
  private readonly dome: Mesh;
  private readonly domeMaterial: ShaderMaterial;
  private shadowSize = 0;
  /** The street light's full strength for the characters. */
  readonly streetPower = 26;

  constructor(
    private readonly renderer: WebGLRenderer,
    readonly road: RoadLayout,
    sky: Texture,
    fog: Color,
    maps: ReadonlyMap<string, Texture>,
  ) {
    const scene = this.scene;
    this.sky = new SkyLight(renderer, scene, sky, 0.32);
    this.u.uFogColor.value.copy(fog);
    this.u.uStreetTint.value.copy(STREET_TINT);
    // three's own fog, for the particles (everything else draws the night's own).
    scene.fog = new FogExp2(fog, 0.016);
    scene.add(road.root);
    this.bake(maps);

    // The moon: cold, from high on the left, matched to the bake's `moon`.
    this.moonDirection = road.moonDirection.clone().normalize();
    this.moon.color.set(0.62, 0.72, 1.0);
    this.moon.intensity = 0.55 * Math.PI;
    const target = new Vector3(0, 0, -20).add(road.eye.clone().setY(0));
    this.moon.target.position.copy(target);
    this.moon.position.copy(target).addScaledVector(this.moonDirection, -70);
    scene.add(this.moon, this.moon.target);

    // The streetlight and the neon, for whoever stands under them.
    if (road.streetLight) road.streetLight.getWorldPosition(this.street.position);
    this.street.color.copy(SODIUM);
    this.street.distance = 32;
    if (road.neonLight) road.neonLight.getWorldPosition(this.neon.position);
    this.neon.color.copy(NEON);
    this.neon.intensity = 7;
    scene.add(this.street, this.neon);

    // Shadows of the moving things fall on the road through a shadow-only material.
    this.shadowMaterial = new ShadowMaterial({
      color: new Color("#05070c"),
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const box = new Box3();
    for (const m of road.groundShadow) {
      m.material = this.shadowMaterial;
      m.visible = true;
      m.receiveShadow = true;
      m.renderOrder = 1;
      box.expandByObject(m);
    }
    if (box.isEmpty()) box.set(new Vector3(-12, 0, -60), new Vector3(12, 3, 2));
    box.max.y = Math.max(box.max.y, 4);
    fitShadowCamera(this.moon, box);
    this.moon.shadow.bias = -0.0005;
    this.moon.shadow.normalBias = 0.03;

    // The haze over the horizon, where the fog meets the sky.
    this.domeMaterial = new ShaderMaterial({
      uniforms: { uFogColor: this.u.uFogColor, uBand: { value: 0.18 }, uStrength: { value: 0.92 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vDir = normalize(world.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor;
        uniform float uBand;
        uniform float uStrength;
        varying vec3 vDir;
        void main() {
          float band = 1.0 - smoothstep(-0.05, uBand, vDir.y);
          gl_FragColor = vec4(uFogColor, band * uStrength);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: BackSide,
      fog: false,
    });
    this.dome = new Mesh(new SphereGeometry(360, 32, 16), this.domeMaterial);
    this.dome.position.copy(road.eye);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    scene.add(this.dynamic, this.fxRoot);
  }

  /**
   * Every surface of the road into the night's material: the placeholder's
   * vertex bake as it is; a real export's `lit` texture (its unlit map),
   * with its `albedo` and `flicker` where its extras name them. Materials
   * shared in the file stay shared; the neon letters and the lamp each get
   * their own, to be dimmed one by one.
   */
  private bake(maps: ReadonlyMap<string, Texture>): void {
    const u = this.u;
    const cache = new Map<string, ShaderMaterial>();
    const cornMeshes = new Set<Mesh>(this.road.corn);
    const shadow = new Set<Mesh>(this.road.groundShadow);
    const rootFlicker = this.road.root.userData["flicker"];
    this.road.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || shadow.has(mesh)) return;
      const name = contractName(mesh);
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshBasicMaterial;
      if (!src || src.userData["bake"] === "sky" || name === "moon.disc") return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const letter = name.startsWith("secret.sign.") ? (name.slice("secret.sign.".length) as SignLetter) : null;
      const own = letter !== null || name === "street.lamp";
      const corn = cornMeshes.has(mesh);
      const key = `${src.uuid}|${corn}`;
      let m = own ? undefined : cache.get(key);
      if (!m) {
        const glow = typeof src.userData["glow"] === "number" ? (src.userData["glow"] as number) : /neon|lamp|bulb|candle|glow/i.test(`${src.name} ${name}`) && src.userData["bake"] !== "vertex" ? 2.2 : 1;
        if (src.userData["bake"] === "vertex") {
          m = bakedMaterial(u, { lit: "vertex", detail: src.map ?? null, sway: corn, side: corn ? DoubleSide : FrontSide, glow, transparent: src.transparent });
          if (src.transparent) (m.uniforms["uOpacity"] as { value: number }).value = src.opacity;
        } else {
          const albedoName = src.userData["albedo"] ?? mesh.userData["albedo"];
          const flickerName = src.userData["flicker"] ?? mesh.userData["flicker"] ?? rootFlicker;
          m = bakedMaterial(u, {
            lit: src.map ?? whiteTexture(),
            albedo: typeof albedoName === "string" ? (maps.get(albedoName) ?? null) : null,
            flicker: typeof flickerName === "string" ? (maps.get(flickerName) ?? null) : null,
            transparent: src.transparent,
            alphaTest: src.alphaTest > 0,
            side: corn ? DoubleSide : src.side,
            sway: corn,
            instanced: (mesh as { isInstancedMesh?: boolean }).isInstancedMesh === true,
            glow,
          });
          if (src.transparent) (m.uniforms["uOpacity"] as { value: number }).value = src.opacity;
        }
        if (!own) cache.set(key, m);
      }
      mesh.material = m;
      if (letter) this.letters.set(letter, m);
      if (name === "street.lamp") this.lampGlow = m;
      if (name === "secret.drivein.screen") this.screen = mesh;
      src.dispose();
    });
  }

  /** The haze over the horizon rises with the fog. */
  setFog(density: number): void {
    this.u.uFogDensity.value = density;
    (this.scene.fog as FogExp2).density = density * 1.25;
    this.domeMaterial.uniforms["uBand"]!.value = 0.06 + density * 7;
  }

  setQuality(q: Quality): void {
    const size = shadowMapSize(q.tier);
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.renderer.shadowMap.enabled = size > 0;
    this.moon.castShadow = size > 0;
    for (const m of this.road.groundShadow) m.visible = size > 0;
    if (size > 0) {
      this.moon.shadow.mapSize.set(size, size);
      this.moon.shadow.radius = q.tier === "high" ? 4 : 2;
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
  }

  dispose(): void {
    this.sky.dispose();
    this.shadowMaterial.dispose();
    this.domeMaterial.dispose();
    disposeTree(this.scene);
    this.moon.shadow.map?.dispose();
  }
}

let white: Texture | null = null;
/** A road surface with no lit map at all (an export in progress): plain grey. */
function whiteTexture(): Texture {
  if (!white) {
    const c = document.createElement("canvas");
    c.width = c.height = 2;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#555";
      g.fillRect(0, 0, 2, 2);
    }
    white = new CanvasTexture(c);
    white.colorSpace = SRGBColorSpace;
  }
  return white;
}
