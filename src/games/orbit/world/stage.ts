/**
 * The scene Orbital Decay draws: the planet and the sky behind everything
 * (planet.ts), the station outside lit at run time by one harsh sun -
 * reddened and dimmed through the atmosphere as it sets over the limb - and
 * by the planet's own light, the cupola's baked frame in front, and what
 * moves between them. It owns the sun's place, the ground's turn, the
 * night's exposure and the environment light, which is the planet itself,
 * rendered into a small cube and prefiltered, so blue earthshine comes up
 * from below on the day side and goes with the sun.
 */
import {
  Box3,
  Color,
  CubeCamera,
  DirectionalLight,
  Group,
  HalfFloatType,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PointLight,
  Quaternion,
  Scene,
  Vector3,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import type { Quality } from "../../../engine/types";
import { disposeTree, fitShadowCamera, shadowMapSize } from "../../../engine/world/scene";
import { EXPOSURE_STOPS, horizonDip, NIGHT_STOPS, SUN_COLOR, SUN_E, sunlightAt } from "./atmosphere";
import type { SkyState, SunAt } from "./orbit";
import { PlanetSky, starsCube, type PlanetTextures } from "./planet";
import type { Scenery } from "./scenery";
import { Tone } from "./tone";

const tmp = new Vector3();
/** The eye's adaptation to the dark and back, seconds (its time constant). */
const EYE_ADAPT = 0.7;
/** While the sky changes, the environment light is made again this often (s): fifteen times a second hides the steps. */
const ENV_CHANGING_EVERY = 1 / 15;

export class Stage {
  readonly scene = new Scene();
  readonly sky: PlanetSky;
  readonly tone = new Tone();
  readonly sun = new DirectionalLight(0xffffff, SUN_E);
  /** The cupola's LEDs, for the few lit things inside it. */
  readonly room = new PointLight(new Color(0.85, 0.92, 1), 0.9, 3.5, 2);
  /** Debris, the drone, the Derelict, the extras. */
  readonly dynamic = new Group();
  readonly fxRoot = new Group();
  /** The station's frame: up (away from the planet), the view's heading along its horizontal, right. */
  readonly up: Vector3;
  readonly heading: Vector3;
  readonly right: Vector3;
  /** How far below the station's horizontal the limb lies, radians. */
  readonly dip: number;
  /** The sun as the art baked it. */
  readonly daySun: SunAt;
  /** Toward the sun now. */
  readonly sunDirection = new Vector3();
  /** Sunlight arriving at the station now, 0..1 per colour (0 behind the planet). */
  readonly sunlight = new Color(1, 1, 1);
  /** The axis the ground turns about under the station (the orbit's normal). */
  readonly orbitAxis: Vector3;
  private readonly planetBase: Quaternion;
  private readonly planetNow = new Quaternion();
  private readonly centerKm: Vector3;
  private readonly cupolaMaterials: { m: MeshBasicMaterial; base: Color }[] = [];
  private readonly envScene = new Scene();
  private readonly cubeTarget: WebGLCubeRenderTarget;
  private readonly cubeCamera: CubeCamera;
  private readonly pmrem: PMREMGenerator;
  private envTarget: WebGLRenderTarget | null = null;
  private envAge = Infinity;
  private shadowSize = -1;
  private readonly stars: WebGLCubeRenderTarget;
  night = 0;
  /** How far the eye has opened up for the night (it follows the night, not at once). */
  private eyeNight = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    readonly scenery: Scenery,
    maps: PlanetTextures,
  ) {
    const scene = this.scene;
    scene.background = new Color(0, 0, 0);
    this.stars = starsCube(renderer, maps.stars);
    maps.stars.dispose();
    this.sky = new PlanetSky({ ...maps, stars: this.stars.texture }, this.tone.exposure);
    scene.add(this.sky.mesh);
    // The station's frame, from where the planet is.
    const center = scenery.planet.center;
    this.centerKm = center.clone().multiplyScalar(1 / 1000);
    this.up = center.clone().normalize().negate();
    const fwd = new Vector3(0, 0, -1).applyQuaternion(scenery.eyeQuaternion);
    this.heading = fwd.clone().addScaledVector(this.up, -fwd.dot(this.up)).normalize();
    this.right = this.heading.clone().cross(this.up).normalize();
    this.dip = horizonDip(scenery.planet.altitudeKm);
    this.daySun = this.toStation(scenery.sun);
    this.orbitAxis = this.heading.clone().cross(this.up).normalize();
    this.planetBase = scenery.planet.rotation.clone();
    this.sky.uniform<Vector3>("uCenter").value.copy(this.centerKm);

    scene.add(scenery.station);
    scene.add(scenery.cupola);
    this.tone.patchTree(scenery.station);
    this.tone.patchTree(scenery.cupola);
    // The cupola's baked frame, dimmed when the sun no longer streams in.
    scenery.cupola.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || [...scenery.panes.values()].includes(mesh)) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const basic = mat as MeshBasicMaterial;
        if (basic.isMeshBasicMaterial && !this.cupolaMaterials.some((c) => c.m === basic)) this.cupolaMaterials.push({ m: basic, base: basic.color.clone() });
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    scenery.station.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    // The sun, and its shadows over the station round the window.
    this.sun.castShadow = false;
    scene.add(this.sun, this.sun.target);
    this.room.position.copy(scenery.eye).add(new Vector3(0, -0.4, 0.3));
    scene.add(this.room);
    scene.add(this.dynamic, this.fxRoot);

    // The environment light: the planet and sky, in a small cube.
    this.cubeTarget = new WebGLCubeRenderTarget(48, { type: HalfFloatType, generateMipmaps: false });
    this.cubeCamera = new CubeCamera(0.1, 100, this.cubeTarget);
    this.cubeCamera.position.copy(scenery.eye);
    const envDome = new Mesh(this.sky.mesh.geometry, this.sky.material);
    envDome.frustumCulled = false;
    envDome.position.copy(scenery.eye);
    this.envScene.add(envDome, this.cubeCamera);
    this.pmrem = new PMREMGenerator(renderer);
    this.setGround(0);
  }

  /** A world direction as elevation over the station's horizontal and azimuth from its heading. */
  toStation(dir: Vector3): SunAt {
    const d = dir.clone().normalize();
    return { elevation: Math.asin(Math.min(1, Math.max(-1, d.dot(this.up)))), azimuth: Math.atan2(d.dot(this.right), d.dot(this.heading)) };
  }

  /** The world direction for an elevation and azimuth. */
  fromStation(at: SunAt, out = new Vector3()): Vector3 {
    return out
      .copy(this.heading)
      .multiplyScalar(Math.cos(at.azimuth))
      .addScaledVector(this.right, Math.sin(at.azimuth))
      .multiplyScalar(Math.cos(at.elevation))
      .addScaledVector(this.up, Math.sin(at.elevation))
      .normalize();
  }

  /** The planet turned this far (radians) about the orbit's normal from where the art put it. */
  setGround(angle: number, extra?: Quaternion): void {
    const turn = new Quaternion().setFromAxisAngle(this.orbitAxis, angle);
    this.planetNow.copy(turn).multiply(extra ?? new Quaternion()).multiply(this.planetBase);
    // World → planet frame.
    const inv = this.planetNow.clone().invert();
    this.sky.toPlanet.setFromMatrix4(new Matrix4().makeRotationFromQuaternion(inv));
  }

  /** The planet's frame turned into the world now (for placing things on it). */
  get planetRotation(): Quaternion {
    return this.planetNow;
  }

  /**
   * Where the sun is and how dark it is. `dt` is how long since the last (0
   * for "at once": a jump, a screenshot).
   */
  setSky(state: SkyState, dt = 0): void {
    this.fromStation(state.sun, this.sunDirection);
    this.night = state.night;
    this.sky.uniform<Vector3>("uSun").value.copy(this.sunDirection);
    this.sky.uniform<number>("uNight").value = state.night;
    // The eye opens up in the planet's shadow - the cities, the airglow, the
    // stars - by as much as the art's night renders do; not at once, or
    // sunrise would come as a flash and nightfall as a switch.
    this.eyeNight = dt > 0 ? this.eyeNight + (state.night - this.eyeNight) * (1 - Math.exp(-dt / EYE_ADAPT)) : state.night;
    this.tone.exposure.value = Math.pow(2, EXPOSURE_STOPS + NIGHT_STOPS * this.eyeNight);
    // Sunlight at the station, through the limb's air when the sun is low.
    const toPlanet = this.sky.toPlanet;
    const eye = tmp.copy(this.centerKm).negate().applyMatrix3(toPlanet);
    const s = this.sunDirection.clone().applyMatrix3(toPlanet).normalize();
    const t = sunlightAt([eye.x, eye.y, eye.z], [s.x, s.y, s.z]);
    this.sunlight.setRGB(t[0], t[1], t[2]);
    this.sun.color.setRGB(SUN_COLOR[0] * t[0], SUN_COLOR[1] * t[1], SUN_COLOR[2] * t[2]);
    this.sun.intensity = SUN_E;
    this.sun.visible = Math.max(t[0], t[1], t[2]) > 0.002;
    this.sun.position.copy(this.scenery.eye).addScaledVector(this.sunDirection, 80);
    this.sun.target.position.copy(this.scenery.eye).add(new Vector3(0, 0, -20));
    // The baked cupola: the sun no longer streaming in, the LEDs alone.
    const k = 1 - 0.45 * state.night;
    for (const c of this.cupolaMaterials) c.m.color.copy(c.base).multiplyScalar(k).lerp(new Color(c.base.r * 0.5 * k, c.base.g * 0.58 * k, c.base.b * 0.72 * k), state.night * 0.5);
  }

  /**
   * The environment light again, if it is due: fifteen times a second while
   * the sky is changing (a breather: the light goes over seconds, and each
   * refresh draws the sky six times and blurs it), at once for a jump (no
   * time passed), every couple of seconds otherwise.
   */
  refreshEnvironment(dt: number, changing: boolean): void {
    this.envAge += dt;
    if (this.envAge < (changing ? (dt > 0 ? ENV_CHANGING_EVERY : 0) : 2)) return;
    this.envAge = 0;
    const raw = this.sky.uniform<number>("uRaw");
    raw.value = 1;
    this.cubeCamera.update(this.renderer, this.envScene);
    raw.value = 0;
    this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 1;
  }

  /** The sky dome follows the eye. */
  follow(eye: Vector3): void {
    this.sky.mesh.position.copy(eye);
  }

  setQuality(q: Quality): void {
    const size = shadowMapSize(q.tier);
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.renderer.shadowMap.enabled = size > 0;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.04;
      this.fitShadows();
    }
  }

  /** The shadow map spent on the station round the window. */
  fitShadows(): void {
    const box = new Box3().setFromObject(this.scenery.station);
    // Not the far ends of the arrays: the part the window sees.
    box.min.max(new Vector3(-45, -40, -60));
    box.max.min(new Vector3(45, 40, 5));
    fitShadowCamera(this.sun, box);
  }

  dispose(): void {
    this.sky.dispose();
    this.stars.dispose();
    this.envTarget?.dispose();
    this.cubeTarget.dispose();
    this.pmrem.dispose();
    this.sun.shadow.map?.dispose();
    disposeTree(this.scene);
  }
}
