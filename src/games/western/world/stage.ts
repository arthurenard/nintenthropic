import {
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { Quality } from "../../../engine/types";
import type { TownLayout } from "./town";

/** Straight down, a touch off vertical so shadows still have a side. */
export const NOON_SUN = new Vector3(-0.08, -1, -0.12).normalize();

/**
 * The scene High Noon draws: the baked town (unlit — its light is in its
 * textures), the sky as background and, through PMREM, as the environment
 * light for everything that moves; a directional sun matching the bake's
 * `sun` node; exponential fog in the colour of the horizon haze; and the
 * `ground.shadow` catcher where moving things drop their shadows.
 */
export class Stage {
  readonly scene = new Scene();
  readonly sun = new DirectionalLight(0xffffff, 1);
  /** Characters, props in motion, bottles. */
  readonly dynamic = new Group();
  readonly fxRoot = new Group();
  readonly sunDirection: Vector3;
  private readonly envTarget: ReturnType<PMREMGenerator["fromEquirectangular"]>;
  private readonly shadowMaterial: ShadowMaterial;
  private shadowSize = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    readonly town: TownLayout,
    sky: Texture,
    fog: Color,
    noon: boolean,
  ) {
    const scene = this.scene;
    scene.background = sky;
    const pmrem = new PMREMGenerator(renderer);
    this.envTarget = pmrem.fromEquirectangular(sky);
    pmrem.dispose();
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = noon ? 0.95 : 0.8;
    const density = typeof town.root.userData["fog_density"] === "number" ? (town.root.userData["fog_density"] as number) : 0.0085;
    scene.fog = new FogExp2(fog, noon ? density * 0.75 : density);

    scene.add(town.root);
    town.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        // The bake is the final word on the town's colour; fog still applies.
        (mat as MeshBasicMaterial).fog = true;
        // Three.js draws a transparent double-sided material twice, flipping its
        // side each time, which re-resolves its shader every frame per pane of
        // glass. One pass looks the same for thin panes and costs nothing.
        if (mat.transparent && mat.side === DoubleSide) mat.forceSinglePass = true;
      }
    });

    // Shadows of moving things fall on the street through a shadow-only material.
    this.shadowMaterial = new ShadowMaterial({
      color: new Color("#1a2130"),
      opacity: noon ? 0.5 : 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    for (const m of town.groundShadow) {
      m.material = this.shadowMaterial;
      m.visible = true;
      m.receiveShadow = true;
      m.renderOrder = 1;
    }

    // The sun, matched to the bake: warm, and bright enough that a lit
    // albedo reads like the baked facades (three's Lambert divides by π).
    // At High Noon the sun stands overhead, whatever the bake's sun says: the
    // moving things drop their shadows straight down under them.
    this.sunDirection = noon ? NOON_SUN.clone() : town.sunDirection.clone().normalize();
    this.sun.color.set(noon ? new Color(1, 0.96, 0.88) : new Color(1, 0.72, 0.46));
    this.sun.intensity = noon ? 1.55 * Math.PI : 1.75 * Math.PI;
    const target = new Vector3(0, 0, -28).add(town.eye.clone().setY(0));
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDirection, -70);
    scene.add(this.sun, this.sun.target);
    this.fitShadowCamera(town);

    scene.add(this.dynamic, this.fxRoot);
  }

  /** Shadows only where they matter: the street the player looks down. */
  private fitShadowCamera(town: TownLayout): void {
    const cam = this.sun.shadow.camera;
    const street = new Box3(new Vector3(-10, 0, -64), new Vector3(10, 12, 4));
    if (town.groundShadow.length) {
      const b = new Box3();
      for (const m of town.groundShadow) b.expandByObject(m);
      street.copy(b);
      street.max.y = Math.max(street.max.y, 12);
    }
    this.sun.updateMatrixWorld(true);
    this.sun.target.updateMatrixWorld(true);
    cam.position.copy(this.sun.position);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const corner = new Vector3();
    const lo = new Vector3(Infinity, Infinity, Infinity);
    const hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? street.max.x : street.min.x, i & 2 ? street.max.y : street.min.y, i & 4 ? street.max.z : street.min.z);
      corner.applyMatrix4(inv);
      lo.min(corner);
      hi.max(corner);
    }
    cam.left = lo.x - 1;
    cam.right = hi.x + 1;
    cam.bottom = lo.y - 1;
    cam.top = hi.y + 1;
    cam.near = Math.max(0.5, -hi.z - 20);
    cam.far = -lo.z + 20;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
  }

  setQuality(q: Quality): void {
    const size = q.tier === "high" ? 2048 : q.tier === "medium" ? 1024 : 0;
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.renderer.shadowMap.enabled = size > 0;
    this.sun.castShadow = size > 0;
    for (const m of this.town.groundShadow) m.visible = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.radius = q.tier === "high" ? 3 : 2;
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  dispose(): void {
    this.envTarget.dispose();
    this.shadowMaterial.dispose();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as Material[]) {
        for (const v of Object.values(mat)) if ((v as Texture)?.isTexture) (v as Texture).dispose();
        mat.dispose();
      }
    });
    this.sun.shadow.map?.dispose();
  }
}
