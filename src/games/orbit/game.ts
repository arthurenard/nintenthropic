import { Matrix3, Matrix4, Mesh, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3, Vector4, type Object3D, type ToneMapping } from "three";
import type { Aim, CalibrationStage, Game, GameContext, HudSink, Readout } from "../../engine/types";
import { loadSoundPack } from "../../audio/index";
import { announceGolden, awardText, HintShown, popupAt, showBonuses, streakReadout, viewportOf, type PopupTone } from "../../engine/hud";
import { breathe, CalibrationProxy, Schedule } from "../../engine/round";
import { assistFactor } from "../../engine/rules/assist";
import { HintLine } from "../../engine/rules/hints";
import { mulberry32 } from "../../engine/rules/rng";
import { streakRate } from "../../engine/rules/streak";
import { ScreenFlash } from "../../engine/world/flash";
import { checkFraming } from "../../engine/world/framing";
import { contractName } from "../../engine/world/names";
import { disposeTree, warmUp } from "../../engine/world/scene";
import { PlayerCamera } from "../../engine/world/playerCamera";
import { PostFX } from "../../engine/world/post";
import { Sound } from "../../engine/world/sound";
import type { Fragment } from "./rules/debris";
import { breachCause, type Breach } from "./rules/felled";
import { tankShows } from "./rules/debris";
import { Match, type MatchListener } from "./rules/match";
import type { Mark } from "./rules/panes";
import type { PassSpec } from "./rules/passes";
import type { Award, PassBonuses } from "./rules/scoring";
import { ASTRONAUT_PASS, duckPass, MOON_PASS, TOOLBAG_PASS, type SecretId } from "./rules/secrets";
import { ALARM_BELOW, BREATHER, DERELICT_DEPTH, INTEGRITY_MAX, KINDS } from "./rules/tuning";
import { normalize, scale, type V3 } from "./rules/vec";
import { droneShotLine, LEARNED_BY_DOING, tipText, ventHint, type TipId } from "./tips";
import { Ambient } from "./world/ambient";
import { loadAssets, type OrbitAssets } from "./world/assets";
import { R as PLANET_R } from "./world/atmosphere";
import { isHiNight, lightAround, nightLuminance, otherCountry, pickLitRegions, type LitRegion } from "./world/cities";
import { LaserBeams } from "./world/beam";
import { DebrisView } from "./world/debrisView";
import { DroneView } from "./world/droneView";
import { Effects } from "./world/effects";
import { Glass } from "./world/glass";
import { readDerelict, readLibrary } from "./world/library";
import { BREATHER_GROUND_RATE, GROUND_RATE, MOON_RADIUS, moonAt, RISE_START, SET_END, skyAt, turnUntilNight, type SkyMoment } from "./world/orbit";
import { ProximityRings, type RingShown } from "./world/rings";
import { RunningLights } from "./world/runningLights";
import { laneClearance, readScenery, type Scenery } from "./world/scenery";
import { Floats } from "./world/floats";
import { SecretsWorld } from "./world/secretsWorld";
import { ASSIST, Shooter, type SkyTargets } from "./world/shooter";
import { Stage } from "./world/stage";

export interface OrbitOptions {
  /** Start on this pass (the dev harness's ?wave=). */
  startPass?: number;
  /** Strikes crack the glass but never break a pane (screenshots, performance runs). */
  immortal?: boolean;
  /** Load the art from this folder instead of assets/orbit/ (the harness's asset tests). */
  assetBase?: string;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
/** How far out on the screen (NDC) the drone may work: clear of the corner panel and the heat ring. */
const DRONE_VIEW = { x: 0.8, top: 0.72, bottom: 0.7 };
/**
 * The night-side storm flickers from this far into a breather (s) - the
 * ground under the view is dark well before the sun is down - until a
 * moment after sunrise begins: some three seconds to catch three flashes.
 */
const STORM_FROM = SET_END - 1.0;
/**
 * Where the storm is in the view (NDC) in the middle of the night: in the
 * centre window, low and to the left, where the player looks most (and
 * through glass: the frame round it hid it once), well clear of the HI.
 */
const STORM_SPOT = { x: -0.12, y: -0.2 };
/** The other nights' countries are turned this far, so they do not stand square to the view. */
const OTHER_NIGHT_TURN = (30 * Math.PI) / 180;
/** Where the "HI" is put in the view (NDC): low in the right-hand window, clear of the centre pane. */
const HI_SPOT = { x: 0.6, y: -0.28 };
/**
 * How wide the HI is drawn in the middle of its night, as a fraction of the
 * view's width (of the art's 16:9 frame) - a pair of letters among the
 * towns you notice, not a sign - and how wide the art wrote it (km).
 */
const HI_WIDTH = 0.017;
const HI_SOURCE_KM = 130;
/** How near the HI a shot must land (km on the ground) to find it: generous, the letters are some 25 km across as drawn. */
const HI_REACH_KM = 80;

/** A (longitude, latitude) in degrees as a direction in the planet's frame (three's sphere: y north, x longitude 0). */
function lonLatDir(lon: number, lat: number): Vector3 {
  const lo = (lon * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  return new Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
}

/**
 * Orbital Decay: the Game the app hosts. It owns the world (the cupola, the
 * station, the planet, the debris, the drone, the secrets) and the rules
 * (Match), turns the player's aim into laser shots, and answers the rules'
 * events with pictures, sounds and the HUD.
 */
export class OrbitalDecay implements Game, MatchListener {
  readonly id = "orbit";
  readonly title = "Orbital Decay";
  readonly calibration: CalibrationStage;
  /** The running lights, once they exist; and the station put back when the aim check comes round again after a game. */
  private readonly calibrationProxy = new CalibrationProxy({ one: "light", many: "lights" });

  private ctx!: GameContext;
  private hud!: HudSink;
  private assets!: OrbitAssets;
  private scenery!: Scenery;
  private stage!: Stage;
  private camera!: PlayerCamera;
  private sound!: Sound;
  private effects!: Effects;
  private debris!: DebrisView;
  private glass!: Glass;
  private beams!: LaserBeams;
  private rings!: ProximityRings;
  private droneView!: DroneView;
  private lights!: RunningLights;
  private secrets!: SecretsWorld;
  private shooter!: Shooter;
  private ambient!: Ambient;
  private floats!: Floats;
  private post!: PostFX;
  private match!: Match;

  private phase: "loading" | "calibration" | "playing" | "failing" | "over" = "loading";
  private paused = false;
  private time = 0;
  private lastDt = 1 / 60;
  private readonly flash = new ScreenFlash();
  private previousToneMapping: ToneMapping | null = null;
  private sky: SkyMoment = { kind: "day", t: 0 };
  /** The dev harness's hold on the sky, for screenshots of any moment. */
  private skyHeld: SkyMoment | null = null;
  private groundAngle = 0;
  private hints = new HintLine(new Set(), LEARNED_BY_DOING);
  private readonly hintShown = new HintShown();
  private golden = false;
  private ventKey = false;
  private readoutKey = "";
  private heatShown = "";
  private readonly schedule = new Schedule(() => this.time);
  private failT = -1;
  private passT = 0;
  private moonT = -1;
  private aurora = 0;
  private stormStarted = false;
  private weldBeamT = 0;
  private visualRandom = mulberry32(11);
  private width = 1280;
  private height = 720;
  private bufferHeight = 720;
  private readonly driftPhase = new Vector3(0.3, 1.7, 2.9);
  /** Where the art wrote its "HI" (the planet's frame), and where the game shows it this breather. */
  private readonly hiSource = new Vector3(0, 1, 0);
  private readonly hiAt = new Vector3(0, 1, 0);
  private hiShown = false;
  private litRegions: LitRegion[] = [];
  private hiLight = 0;
  /** Nights so far this game, and whether this breather's is set. */
  private nights = 0;
  private nightPlaced = false;
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.key === "v" || e.key === "V") && !e.repeat) this.ventKey = true;
  };

  constructor(private readonly options: OrbitOptions = {}) {
    this.calibration = this.calibrationProxy;
  }

  // --- Game ---------------------------------------------------------------------------

  async load(ctx: GameContext, onProgress: (fraction: number) => void): Promise<void> {
    this.ctx = ctx;
    this.hud = ctx.hud;
    this.golden = ctx.settings.unlocks.has("golden");
    const renderer = ctx.renderer;
    this.previousToneMapping = renderer.toneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    // The art and the sounds together, into one bar.
    let artDone = 0;
    let soundDone = 0;
    const report = () => onProgress(Math.min(0.97, artDone * 0.75 + soundDone * 0.2));
    const sounds = loadSoundPack(ctx.audio, "orbit", (f) => {
      soundDone = f;
      report();
    }).catch((err) => console.warn("Orbital Decay: the sound pack did not load", err));
    this.assets = await loadAssets(
      ctx,
      (f) => {
        artDone = f;
        report();
      },
      this.options.assetBase ?? null,
    );
    await breathe();
    this.scenery = readScenery(this.assets.cupola, this.assets.station);
    // Which lanes the station hides, so the director sends most down the open ones.
    const layout = this.scenery.layout;
    const toward = this.scenery.eye.clone().add(new Vector3(layout.forward.x, layout.forward.y, layout.forward.z).multiplyScalar(1.5));
    // The cupola's frame counts as in the way; its glass does not.
    const glass = new Set<Object3D>(this.scenery.panes.values());
    const frame: Object3D[] = [];
    this.assets.cupola.traverse((o) => {
      if ((o as Mesh).isMesh && !glass.has(o)) frame.push(o);
    });
    const inTheWay = [this.assets.station, ...frame];
    layout.clear = laneClearance(inTheWay, this.scenery.eye, layout.lanes, toward, 16);
    const centre = this.scenery.layout.panes.find((p) => p.id === 0)?.center;
    const pane0 = centre ? new Vector3(centre.x, centre.y, centre.z) : toward;
    layout.clearWide = laneClearance(inTheWay, this.scenery.eye, layout.lanes.map((l) => scale(normalize(l), DERELICT_DEPTH)), pane0, 16, 3);
    layout.derelictFrom = this.derelictStart(inTheWay, pane0);
    await breathe();
    this.stage = new Stage(renderer, this.scenery, this.assets.maps);
    this.stage.setQuality(ctx.quality);
    this.camera = new PlayerCamera(this.scenery.eye, this.scenery.eyeQuaternion, this.scenery.fov, { near: 0.05, far: 2000 });
    this.camera.still = true;
    this.camera.reducedMotion = ctx.settings.reducedMotion;
    this.sound = new Sound(ctx.audio, this.camera.camera);
    await breathe();

    const stage = this.stage;
    this.effects = new Effects(stage.fxRoot, ctx.quality);
    this.effects.setRandom(this.visualRandom);
    const library = readLibrary(this.assets.debris);
    const derelict = readDerelict(this.assets.derelict);
    this.debris = new DebrisView(stage.dynamic, library, derelict, this.effects, this.scenery.eye, this.visualRandom);
    this.glass = new Glass(this.scenery.panes, this.scenery.eye);
    this.beams = new LaserBeams(stage.fxRoot);
    this.beams.golden = this.golden;
    this.rings = new ProximityRings();
    const droneModel = this.assets.drone;
    this.droneView = new DroneView(droneModel, stage.dynamic, this.scenery.drone.dock, (pane) => this.workSpot(pane), this.effects, this.visualRandom);
    this.lights = new RunningLights(this.scenery.calib, stage.dynamic, this.camera.camera, this.effects, this.sound);
    this.secrets = new SecretsWorld(
      this.assets.extras,
      stage.dynamic,
      { ...this.scenery.secrets, astronautPath: this.scenery.astronautPath, duckPath: this.scenery.duckPath, eye: this.scenery.eye, view: { quaternion: this.scenery.eyeQuaternion, fov: this.scenery.fov } },
      this.effects,
      stage.sky,
      this.visualRandom,
    );
    this.shooter = new Shooter(this.camera.camera, this.debris, this.scenery.station, ctx.settings);
    this.ambient = new Ambient(this.sound, this.visualRandom);
    this.floats = new Floats(this.scenery.floats, this.visualRandom);
    this.floats.reducedMotion = ctx.settings.reducedMotion;
    // Everything lit at run time through the one tone curve.
    for (const v of Object.values(library)) for (const variant of v) {
      stage.tone.patchTree(variant.whole);
      for (const p of variant.pieces) stage.tone.patchTree(p);
    }
    stage.tone.patchTree(derelict.root);
    for (const p of derelict.pieces) stage.tone.patchTree(p);
    stage.tone.patchTree(droneModel);
    for (const r of this.secrets.roots()) stage.tone.patchTree(r);
    stage.tone.patchTree(stage.fxRoot);
    for (const m of this.glass.shutterMeshes) stage.tone.patchTree(m);
    this.calibrationProxy.target = this.lights;
    this.calibrationProxy.onUse = () => {
      if (this.phase === "over" || this.phase === "failing") this.rearm();
    };
    this.calibrationProxy.onBegin = () => {
      if (this.phase === "calibration") this.lights.reset();
      else if (this.phase !== "loading") this.rearm();
    };
    this.readHi();
    // The night map's brightest countries, for the nights that do not show
    // the HI, and how lit the HI's own is (the others are dimmed to it).
    const hi = this.scenery.planet.hi ?? [-112, 47];
    const lum = nightLuminance(renderer, this.assets.maps.night);
    this.hiLight = lightAround(lum, 96, 48, hi[0], hi[1]);
    const like = { light: this.hiLight, wide: lightAround(lum, 96, 48, hi[0], hi[1], 14) };
    this.litRegions = pickLitRegions(lum, 96, 48, 3, 7, 25, [hi], like);
    this.newMatch();
    this.post = new PostFX(renderer, stage.scene, this.camera.camera, ctx.quality, {
      bloom: { threshold: 0.92, smoothing: 0.25, intensity: 0.75, radius: 0.75, levels: 7 },
      hurt: false,
      sepia: false,
      flash: { color: [1, 0.97, 0.94] },
      vignette: 0.14,
    });
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720, renderer.getPixelRatio());
    this.applySky(0, true);
    await breathe();
    // Every shader compiled before play - the debris of every kind, the
    // drone, the extras, the effects, the post chain: a shader first compiled
    // as a slab comes at the glass is a dropped frame at the worst time.
    const loose = this.setOut(library, derelict);
    await warmUp(renderer, stage.scene, this.camera.camera, () => this.post.render(0));
    for (const o of loose) o.removeFromParent();
    await sounds;
    window.addEventListener("keydown", this.onKey);
    this.ambient.start();
    this.phase = "calibration";
    onProgress(1);
  }

  /**
   * Where the drone hovers to mend a pane: the art's spot (or 1.1 m outside
   * the glass) - unless that is off the screen, as it is for the panes the
   * frame cuts (the upper and lower ones at 16:9): then as near it as the
   * view allows, at the view's edge and out beyond the glass, turned to the
   * pane it mends. The player should see who is fixing the window.
   */
  private workSpot(pane: number): { pos: Vector3; facing: Vector3 } {
    const node = this.scenery.drone.work.get(pane);
    const p = this.glass.pane(pane);
    let pos: Vector3;
    let facing: Vector3;
    if (node) {
      pos = node.getWorldPosition(new Vector3());
      facing = new Vector3(0, 0, -1).applyQuaternion(node.getWorldQuaternion(new Quaternion()));
    } else if (p) {
      pos = p.center.clone().addScaledVector(p.normal, 1.1);
      facing = p.normal.clone().negate();
    } else return { pos: new Vector3(0, 0, -3), facing: new Vector3(0, 0, 1) };
    if (!p) return { pos, facing };
    const cam = this.camera.camera;
    const ndc = pos.clone().project(cam);
    const x = Math.min(DRONE_VIEW.x, Math.max(-DRONE_VIEW.x, ndc.x));
    const y = Math.min(DRONE_VIEW.top, Math.max(-DRONE_VIEW.bottom, ndc.y));
    if (x === ndc.x && y === ndc.y && ndc.z < 1) return { pos, facing };
    const eye = cam.position;
    const dir = new Vector3(x, y, 0.5).unproject(cam).sub(eye).normalize();
    // Along that line, out past the pane's plane by as much as the art's spot is.
    const n = p.normal;
    const along = n.dot(dir);
    const reach = along > 0.05 ? (1.1 - n.dot(tmp.copy(eye).sub(p.center))) / along : pos.distanceTo(eye) + 1.5;
    const spot = eye.clone().addScaledVector(dir, Math.min(6, Math.max(2.5, reach)));
    return { pos: spot, facing: p.center.clone().sub(spot).normalize() };
  }

  /**
   * Where the Derelict sets out: seen through the centre window, where the
   * whole satellite shows all the way in - clear of the arm, the station
   * and the window's frame - as near the middle as that allows. It comes
   * almost straight at the eye, so it stays near where it starts on screen.
   */
  private derelictStart(inTheWay: Object3D[], to: Vector3): V3 | undefined {
    const t = Math.tan((this.scenery.fov * Math.PI) / 360);
    const spots: { at: Vector3; off: number }[] = [];
    for (let sx = -0.3; sx <= 0.301; sx += 0.1) {
      for (let sy = -0.4; sy <= 0.301; sy += 0.1) {
        const d = new Vector3(sx * t * (16 / 9), sy * t, -1).normalize().applyQuaternion(this.scenery.eyeQuaternion);
        spots.push({ at: this.scenery.eye.clone().addScaledVector(d, DERELICT_DEPTH), off: Math.hypot(sx, sy) });
      }
    }
    const clear = laneClearance(inTheWay, this.scenery.eye, spots.map((s) => s.at), to, 12, 3);
    let best = -1;
    let bestScore = -Infinity;
    spots.forEach((s, i) => {
      const score = (clear[i] as number) - 0.4 * s.off;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const at = spots[best]?.at;
    return at ? { x: at.x, y: at.y, z: at.z } : undefined;
  }

  /** Where the art wrote its "HI" of town lights, in the planet's frame. */
  private readHi(): void {
    const [lon, lat] = this.scenery.planet.hi ?? [-112, 47];
    this.hiSource.copy(lonLatDir(lon, lat));
  }

  /**
   * The lights for this breather's night. The planet by day stays as the art
   * composed it - open ocean under the station, the coast far ahead - where
   * the night would be black. At night only lights show, so the night map
   * is read through a turn that puts a lit region under the view instead,
   * as the art's own night renders do: on every third night the country
   * round the "HI" (secret 8), the letters small (HI_WIDTH of the view
   * across, through the planet's lens) and upright, low in the right-hand
   * window - a find, not a headline; on the other nights the next of the night
   * map's brightest countries (found at load) in the centre of the view. It
   * is set as the breather begins, while the sun is still up and no light
   * shows, for where the ground will have turned by the middle of the night,
   * and the lights then turn with the ground.
   */
  private placeNight(): void {
    const other = this.litRegions[otherCountry(this.nights) % Math.max(1, this.litRegions.length)];
    const hiNight = isHiNight(this.nights) || !other;
    this.nights += 1;
    const spot = this.groundPoint(hiNight ? HI_SPOT.x : 0.02, hiNight ? HI_SPOT.y : -0.08);
    if (!spot) return;
    const world = spot.clone();
    const toPlanet = this.rotationAtNight().invert();
    const at = spot.applyQuaternion(toPlanet).normalize();
    const right = new Vector3(1, 0, 0).applyQuaternion(this.scenery.eyeQuaternion).applyQuaternion(toPlanet);
    const east = right.addScaledVector(at, -right.dot(at)).normalize();
    const north = new Vector3().crossVectors(at, east);
    const src = hiNight || !other ? this.hiSource : lonLatDir(other.lon, other.lat);
    const srcEast = new Vector3(src.z, 0, -src.x).normalize();
    const srcNorth = new Vector3().crossVectors(src, srcEast);
    if (!hiNight) {
      // Turned a little, so the second country does not stand square to the view.
      const turn = new Quaternion().setFromAxisAngle(src, OTHER_NIGHT_TURN);
      srcEast.applyQuaternion(turn);
      srcNorth.applyQuaternion(turn);
    }
    // The HI's night reads the map through how the ground is seen from here,
    // so the small letters stand upright and true on the screen, not leaning
    // and squashed as an oblique view would have them; and through a lens
    // that draws them HI_WIDTH of the view across.
    const seen = hiNight ? this.groundSeen(world) : null;
    const lean = seen ? new Matrix4().set(1, seen.lean, 0, 0, seen.rise, seen.stretch, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) : new Matrix4();
    const map = new Matrix4().makeBasis(srcEast, srcNorth, src).multiply(lean).multiply(new Matrix4().makeBasis(east, north, at).transpose());
    this.stage.sky.uniform<Matrix3>("uNightMap").value.setFromMatrix4(map);
    // A busier country is dimmed to the HI's, so no night is a white carpet.
    const scale = hiNight || !other || this.hiLight <= 0 ? 1 : Math.min(1, Math.max(0.3, this.hiLight / other.light));
    this.stage.sky.uniform<number>("uNightScale").value = scale;
    this.stage.sky.uniform<Vector4>("uHiLens").value.set(this.hiSource.x, this.hiSource.y, this.hiSource.z, seen ? seen.zoom : 1);
    this.hiAt.copy(at);
    this.hiShown = hiNight;
  }

  /**
   * How the ground at `p` (a unit direction from the planet's centre, in the
   * world's frame) is seen: where a step east and a step north land on the
   * screen, as the map matrix and the lens need them. `lean`, `rise` and
   * `stretch` take a step on the ground to the screen's own right and up
   * (per unit of the east step's width); `zoom` is how many times smaller than
   * the art's map the HI must be drawn to span HI_WIDTH of the view.
   */
  private groundSeen(p: Vector3): { lean: number; rise: number; stretch: number; zoom: number } {
    const STEP_KM = 25;
    const t = Math.tan((this.scenery.fov * Math.PI) / 360);
    const inverse = this.scenery.eyeQuaternion.clone().invert();
    const centre = this.scenery.planet.center.clone().multiplyScalar(1 / 1000);
    // A point of the ground on the view's plane, in units of the view's height.
    const view = (dir: Vector3): [number, number] => {
      const c = centre.clone().addScaledVector(dir, PLANET_R).applyQuaternion(inverse);
      return [c.x / -c.z / t, c.y / -c.z / t];
    };
    const right = new Vector3(1, 0, 0).applyQuaternion(this.scenery.eyeQuaternion);
    const east = right.addScaledVector(p, -right.dot(p)).normalize();
    const north = new Vector3().crossVectors(p, east);
    const step = STEP_KM / PLANET_R;
    const [x0, y0] = view(p);
    const [xe, ye] = view(p.clone().addScaledVector(east, step).normalize());
    const [xn, yn] = view(p.clone().addScaledVector(north, step).normalize());
    const dx = xe - x0;
    if (!(dx > 1e-6)) return { lean: 0, rise: 0, stretch: 1, zoom: 3.6 };
    const frameWidth = 2 * (16 / 9);
    const zoom = ((HI_SOURCE_KM / STEP_KM) * dx) / (HI_WIDTH * frameWidth);
    return { lean: (xn - x0) / dx, rise: (ye - y0) / dx, stretch: (yn - y0) / dx, zoom: Math.min(8, Math.max(2, zoom)) };
  }

  /** The planet's turn into the world as it will be in the middle of this breather's night. */
  private rotationAtNight(): Quaternion {
    const t = this.sky.kind === "breather" ? this.sky.t : 0;
    return new Quaternion().setFromAxisAngle(this.stage.orbitAxis, turnUntilNight(t)).multiply(this.stage.planetRotation);
  }

  /** The planet's surface point seen through the art's view at NDC (sx, sy), as a unit direction from its centre. */
  private groundPoint(sx: number, sy: number): Vector3 | null {
    const t = Math.tan((this.scenery.fov * Math.PI) / 360);
    const d = new Vector3(sx * t * (16 / 9), sy * t, -1).normalize().applyQuaternion(this.scenery.eyeQuaternion);
    const c = this.scenery.planet.center.clone().multiplyScalar(1 / 1000);
    const hit = raySphere(new Vector3(), d, c, PLANET_R);
    if (hit === null) return null;
    return d.multiplyScalar(hit).sub(c).normalize();
  }

  private newMatch(): void {
    this.match = new Match({
      random: this.ctx.random,
      layout: this.scenery.layout,
      listener: this,
      difficulty: this.ctx.settings.difficulty,
      variants: this.debris.variantCounts(),
    });
    this.match.glass.immortal = this.options.immortal === true;
  }

  /**
   * A copy of every piece of debris and of the Derelict, set out in the
   * scene far ahead for the warm-up to compile: the library itself is loose,
   * kept for cloning. The game takes the copies away again after.
   */
  private setOut(library: ReturnType<typeof readLibrary>, derelict: ReturnType<typeof readDerelict>): Object3D[] {
    const shown: Object3D[] = [];
    const add = (o: Object3D) => {
      const c = o.clone(true);
      c.position.set(0, 0, -30);
      c.visible = true;
      this.stage.dynamic.add(c);
      shown.push(c);
    };
    for (const list of Object.values(library)) for (const v of list) {
      add(v.whole);
      for (const p of v.pieces) add(p);
    }
    add(derelict.root);
    return shown;
  }

  /**
   * Back to the state after load, for another game on this instance: a
   * fresh match, the glass whole, the debris gone, the drone home, the
   * secrets put back, the sky on the day side.
   */
  private rearm(): void {
    this.debris.clear();
    this.effects.clearAll();
    this.glass.reset();
    this.beams.clear();
    this.rings.clear();
    this.droneView.reset();
    this.secrets.reset();
    this.floats.reset();
    this.lights.reset();
    this.newMatch();
    this.schedule.clear();
    this.failT = -1;
    this.moonT = -1;
    this.aurora = 0;
    this.stormStarted = false;
    this.sky = { kind: "day", t: 0 };
    this.groundAngle = 0;
    this.nights = 0;
    this.nightPlaced = false;
    this.hiShown = false;
    this.stage.sky.uniform<Matrix3>("uNightMap").value.identity();
    this.stage.sky.uniform<number>("uNightScale").value = 1;
    this.stage.sky.uniform<Vector4>("uHiLens").value.setW(1);
    this.flash.reset();
    this.post.set("flash", 0);
    this.post.set("exposure", 1);
    this.post.set("desaturate", 0);
    this.stage.sky.uniform<number>("uAurora").value = 0;
    this.stage.sky.uniform<number>("uMoonShow").value = 0;
    this.ambient.stop();
    this.sound.stopAll();
    this.ambient.start();
    this.hints.setQuiet(true);
    this.syncHint();
    this.camera.still = true;
    this.phase = "calibration";
  }

  start(): void {
    if (this.phase === "loading") return;
    if (this.phase !== "calibration") this.rearm();
    // A fresh match either way: the difficulty is read here.
    else this.newMatch();
    this.lights.done();
    this.lights.active = false;
    this.phase = "playing";
    this.time = 0;
    this.passT = 0;
    this.failT = -1;
    this.readoutKey = "";
    this.heatShown = "";
    this.match.laser.cold = false;
    const pass = Math.max(1, Math.floor(this.options.startPass ?? 1));
    this.hud.score(0);
    this.hud.heat?.(0, false);
    this.match.start(pass);
    this.ambient.running = true;
    this.hints = new HintLine(this.ctx.settings.tipsSeen, LEARNED_BY_DOING);
    this.hints.setQuiet(false);
    // How to vent, at the start of every game until they have done it.
    this.offerTip("orbit.heat");
    if (this.golden) announceGolden(this.hud, this.sound, this.schedule, "orbit_golden", "Golden Laser");
    this.pushReadouts(true);
  }

  update(dt: number, _now: number, aim: Aim): void {
    if (this.phase === "loading" || this.paused) return;
    this.lastDt = dt;
    // Read every frame: changed in the pause menu's Settings, they hold from Resume.
    const reducedFlashing = this.ctx.settings.reducedFlashing;
    this.effects.reducedFlashing = reducedFlashing;
    this.beams.reducedFlashing = reducedFlashing;
    this.secrets.reducedFlashing = reducedFlashing;
    this.camera.reducedMotion = this.ctx.settings.reducedMotion;
    this.time += dt;
    this.schedule.run();

    if (this.phase === "calibration") {
      this.match.laser.cold = true;
      if (aim.fired && !aim.offscreen) this.calibrationShot(aim.x, aim.y);
      this.updateWorld(dt);
      return;
    }
    if (this.phase === "playing") {
      if (this.ventKey) this.match.vent();
      if (aim.fired && !aim.offscreen) this.fire(aim.x, aim.y);
    }
    this.ventKey = false;
    this.match.update(dt, aim.offscreen);
    this.passT = this.match.phase === "pass" || this.match.phase === "intro" ? this.passT + dt : this.passT;
    this.updateWorld(dt);
    if (this.phase === "playing") {
      this.pushReadouts(false);
      this.pushHeat();
      this.pushRings(dt);
    } else {
      this.rings.show([], dt);
    }
    if (this.phase === "failing") this.updateFailure(dt);
    this.hints.update(dt);
    this.syncHint();
  }

  /** The sky for where the match is: the day through a pass, the night side in a breather. */
  private skyMoment(): SkyMoment {
    if (this.skyHeld) return this.skyHeld;
    if (this.phase !== "playing" && this.phase !== "failing") return { kind: "day", t: 0 };
    // The pass clock stands still through the breather: where the pass left the sun.
    if (this.match.phase === "breather") return { kind: "breather", t: this.match.phaseT, after: this.passT };
    return { kind: "day", t: this.passT };
  }

  private updateWorld(dt: number): void {
    const t = this.match.time;
    const breather = (this.match.phase === "breather" && this.phase === "playing") || this.skyHeld?.kind === "breather";
    this.sky = this.skyMoment();
    this.groundAngle += dt * (breather ? BREATHER_GROUND_RATE : GROUND_RATE);
    this.applySky(dt, breather);
    // The night side's sights: its lights, the storm while the sun is down, the aurora once earned.
    if (breather && !this.nightPlaced) {
      this.nightPlaced = true;
      this.placeNight();
    }
    if (!breather) this.nightPlaced = false;
    if (breather) {
      const night = this.sky.t > STORM_FROM && this.sky.t < RISE_START + 0.3;
      if (night && !this.stormStarted) {
        this.stormStarted = true;
        // Where it will be in the middle of the night: it drifts with the ground, a few hundred km.
        const spot = this.groundPoint(STORM_SPOT.x, STORM_SPOT.y);
        if (spot) this.secrets.startStorm(spot.applyQuaternion(this.rotationAtNight().invert()));
      }
      if (!night && this.secrets.stormOn) this.secrets.stopStorm();
    }
    this.aurora += ((this.match.secrets.aurora ? 1 : 0) - this.aurora) * Math.min(1, dt * 0.5);
    this.stage.sky.uniform<number>("uAurora").value = this.aurora * (0.35 + 0.65 * this.stage.night);
    // The Moon, from its pass on, rising over the limb.
    if (this.moonT >= 0) {
      this.moonT += dt;
      const m = moonAt(this.moonT, this.stage.dip);
      this.stage.sky.uniform<Vector3>("uMoon").value.copy(this.stage.fromStation(m));
      this.stage.sky.uniform<number>("uMoonRadius").value = MOON_RADIUS;
      const show = this.stage.sky.uniform<number>("uMoonShow");
      show.value = Math.min(1, show.value + dt * 0.5);
    }
    // The world follows the rules.
    this.debris.sun.copy(this.stage.sunDirection);
    this.debris.sunlight = Math.max(this.stage.sunlight.r, this.stage.sunlight.g, this.stage.sunlight.b);
    this.debris.update(t, dt);
    this.glass.setSun(this.stage.sunDirection, this.stage.sunlight);
    this.glass.sync(this.match.glass.marks);
    this.glass.update(dt);
    this.droneView.update(this.match.drone, dt, this.scenery.eye);
    this.glass.weldLight(this.droneView.welding, this.droneView.weldLight);
    // Mending from where the player can see it: a thin blue beam to the glass now and then.
    this.weldBeamT -= dt;
    const mending = this.droneView.welding !== null ? this.glass.pane(this.droneView.welding) : null;
    if (mending && this.weldBeamT <= 0) {
      this.weldBeamT = 0.18 + this.visualRandom() * 0.2;
      const spot = mending.center.clone().add(tmp.set(this.visualRandom() - 0.5, this.visualRandom() - 0.5, this.visualRandom() - 0.5).multiplyScalar(0.25));
      this.beams.fire(this.droneView.tipPosition(tmp2), spot, "weld");
    }
    this.secrets.update(dt);
    this.lights.update(dt);
    this.effects.update(dt);
    this.ambient.update(dt);
    this.floats.update(dt);
    // The eye: afloat, a few centimetres of slow drift, no breath.
    this.camera.update(dt);
    if (!this.ctx.settings.reducedMotion) {
      const k = this.time;
      const p = this.driftPhase;
      this.camera.camera.position.add(tmp.set(Math.sin(k * 0.21 + p.x) * 0.02, Math.sin(k * 0.17 + p.y) * 0.015, Math.sin(k * 0.13 + p.z) * 0.012));
      this.camera.camera.updateMatrixWorld(true);
    }
    this.stage.follow(this.camera.camera.position);
    // Half a beam's width: about four device pixels at any distance.
    this.beams.update(dt, this.camera.camera.position, (4 / Math.max(1, this.bufferHeight)) * 2 * Math.tan((this.camera.camera.fov * Math.PI) / 360));
    this.post.set("flash", this.flash.update(dt));
  }

  private applySky(dt: number, changing = false): void {
    this.stage.setGround(this.groundAngle);
    const state = skyAt(this.sky, this.stage.daySun, this.stage.dip);
    this.stage.setSky(state, dt);
    this.stage.sky.uniform<number>("uTime").value = this.time;
    this.stage.sky.uniform<number>("uCloudShift").value = this.time * 0.00003;
    this.stage.sky.uniform<Vector4>("uHi").value.setX(this.hiAt.x).setY(this.hiAt.y).setZ(this.hiAt.z);
    this.stage.refreshEnvironment(dt, changing);
  }

  render(): void {
    if (this.phase === "loading") return;
    this.post.render(this.lastDt);
    this.rings.render(this.ctx.renderer);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.post) return;
    this.width = width;
    this.height = height;
    this.bufferHeight = height * pixelRatio;
    this.camera.setAspect(width / Math.max(1, height));
    this.post.setSize(width, height);
    this.rings.resize(width, height, pixelRatio);
    // The cupola's own view: the windows are the frame, and play keeps it.
    this.camera.setFraming(checkFraming(this.scenery.fov, width / Math.max(1, height)), 0);
    this.effects.setScale(this.bufferHeight, this.camera.camera.fov);
  }

  pause(): void {
    this.paused = true;
    this.sound?.pause();
  }

  resume(): void {
    this.paused = false;
    this.sound?.resume();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    if (this.phase === "loading" && !this.stage) return;
    this.sound?.stopAll();
    this.post?.dispose();
    this.effects?.dispose();
    this.glass?.dispose();
    this.beams?.dispose();
    this.rings?.dispose();
    // What the scene does not hold: the debris library and the Derelict
    // (loose, for cloning), and what is left of the files the walk-ons and
    // the drone were taken from. Each load builds its own, so none is kept.
    this.debris?.dispose();
    if (this.assets) for (const rest of [this.assets.debris, this.assets.derelict, this.assets.drone, this.assets.extras]) disposeTree(rest);
    this.stage?.dispose();
    if (this.previousToneMapping !== null) this.ctx.renderer.toneMapping = this.previousToneMapping;
  }

  // --- shooting ---------------------------------------------------------------------------

  private emitterAt(out: Vector3): Vector3 {
    const e = this.scenery.emitter;
    if (e) return e.getWorldPosition(out);
    return out.set(0.9, -2.2, -4.6);
  }

  /** The aim check: the laser fires (no heat); the platform judges the shot. */
  private calibrationShot(x: number, y: number): void {
    this.sound.play("orbit_laser", { volume: 0.9, rate: 0.98 + this.visualRandom() * 0.04 });
    const cam = this.camera.camera;
    tmp.set(x * 2 - 1, -(y * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
    // To the lit running light if the shot is on it, else out into the dark.
    let to = tmp2.copy(cam.position).addScaledVector(tmp, 60);
    for (const t of this.lights.targets()) {
      if (Math.hypot((t.x - x) * this.width, (t.y - y) * this.height) / Math.min(this.width, this.height) < t.radius * 1.3) {
        const n = this.scenery.calib.find((_, i) => `light.${i + 1}` === t.id)?.node;
        if (n) to = n.getWorldPosition(tmp2);
      }
    }
    this.beams.fire(this.emitterAt(new Vector3()), to);
  }

  private fire(x: number, y: number): void {
    const result = this.match.trigger();
    if (result === "overheated" || result === "venting") {
      this.sound.play("orbit_heat_tick", { volume: 0.8, rate: 0.7 });
      // A state, not a lesson: every time it is found too hot.
      if (result === "overheated") this.hints.setNeed(ventHint(this.ctx.input));
      this.syncHint();
      return;
    }
    if (result !== "fired") return;
    this.sound.play("orbit_laser", { volume: 1, rate: 0.97 + this.visualRandom() * 0.06 });
    this.sound.play("orbit_heat_tick", { volume: 0.5, delay: 0.05, rate: 0.9 + this.match.laser.heat * 0.4 });
    const res = this.shooter.shoot(x, y, this.match.time, this.match.fragments, this.droneTarget(), this.secrets.candidates(), this.skyTargets());
    const from = this.emitterAt(new Vector3());
    this.beams.fire(from, res.point);
    // A shot into the station's own metal glances off it.
    if (res.hit === "station") this.effects.deflect(res.point, tmp.copy(this.camera.camera.position).sub(res.point).normalize(), res.distance);
    this.match.resolveShot(res.target);
  }

  private droneTarget(): { center: Vector3; radius: number } | null {
    return { center: this.droneView.center, radius: 0.45 };
  }

  private skyTargets(): SkyTargets {
    const moonShown = this.stage.sky.uniform<number>("uMoonShow").value > 0.5;
    const moon = moonShown ? { dir: this.stage.sky.uniform<Vector3>("uMoon").value, radius: MOON_RADIUS } : null;
    return {
      moon,
      planet: (dir: Vector3) => {
        const c = this.scenery.planet.center.clone().multiplyScalar(1 / 1000);
        const hit = raySphere(tmp.set(0, 0, 0), dir, c, PLANET_R);
        if (hit === null) return null;
        const onPlanet = dir.clone().multiplyScalar(hit).sub(c).normalize().applyQuaternion(this.stage.planetRotation.clone().invert());
        const sunP = this.stage.sunDirection.clone().applyQuaternion(this.stage.planetRotation.clone().invert());
        const km = (a: Vector3) => Math.acos(Math.min(1, Math.max(-1, onPlanet.dot(a)))) * PLANET_R;
        const hi = this.stage.night > 0.5 && this.hiShown && km(this.hiAt) < HI_REACH_KM && this.hiAt.dot(sunP) < 0;
        // The HI's reach is the tighter: a shot at the letters is for them, even as the storm beside them flashes.
        const storm = !hi && this.secrets.stormOn && km(this.secrets.storm) < 220 && this.secrets.takeFlash();
        return { storm, hi };
      },
    };
  }

  // --- HUD helpers --------------------------------------------------------------------------

  private project(at: Vector3): { x: number; y: number } | null {
    return viewportOf(this.camera.camera, at);
  }

  private popupAt(at: Vector3, text: string, tone: PopupTone = ""): void {
    popupAt(this.hud, this.camera.camera, at, text, tone);
  }

  private offerTip(id: TipId): void {
    if (this.phase !== "playing") return;
    this.hints.offer(id, tipText(id, this.ctx.input));
    this.syncHint();
  }

  /** Tell the HUD what the hint line shows, when it changes. */
  private syncHint(): void {
    this.hintShown.tell(this.hud, this.hints);
  }

  /** The corner panel: the pass, the glass (the cupola in miniature), the streak. */
  private pushReadouts(force: boolean): void {
    const m = this.match;
    const g = m.glass;
    const panes = g.integrity.map((v) => Math.round(v));
    const mult = m.scorer.multiplier;
    const key = `${m.pass}|${panes.join(",")}|${mult}`;
    if (!force && key === this.readoutKey) return;
    this.readoutKey = key;
    const weakest = Math.min(...panes);
    const tone = (v: number): "" | "warning" | "danger" => (v < ALARM_BELOW ? "danger" : v < 60 ? "warning" : "");
    const list: Readout[] = [
      { label: "Pass", value: String(m.pass) },
      {
        label: "Glass",
        value: `${weakest}%`,
        tone: tone(weakest),
        segments: panes.map((v) => ({ value: v / INTEGRITY_MAX, tone: tone(v) })),
        segmentLayout: "ring",
      },
      streakReadout(mult),
    ];
    this.hud.readouts(list);
  }

  private pushHeat(): void {
    const l = this.match.laser;
    const key = `${Math.round(l.heat * 100)}|${l.cooling}`;
    if (key === this.heatShown) return;
    this.heatShown = key;
    this.hud.heat?.(l.heat, l.cooling);
  }

  /** The window's rings round everything coming at the glass, most urgent first. */
  private pushRings(dt: number): void {
    const lead = this.match.tuning.ringLead;
    const t = this.match.time;
    const list: RingShown[] = [];
    const cam = this.camera.camera;
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    const minSide = Math.min(this.width, this.height);
    for (const f of this.match.fragments) {
      if (!f.flying || !f.strike) continue;
      const closing = f.strike.time - t;
      if (closing > lead || closing < 0) continue;
      const b = this.debris.bounds(f.id);
      if (!b) continue;
      const p = this.project(b.center);
      if (!p || p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) continue;
      const d = b.center.distanceTo(cam.position);
      const physical = (b.radius / (d * 2 * tanHalf)) * this.height;
      // The ring is the zone a shot counts in: it follows Aim Assist.
      const assist = ASSIST.debris * assistFactor(this.ctx.settings.aimAssist) * minSide;
      list.push({ x: p.x, y: p.y, radius: Math.max(physical, assist) + 6, seconds: closing, lead });
    }
    list.sort((a, b) => a.seconds - b.seconds);
    this.rings.show(list.slice(0, 14), dt);
  }

  /** The glass gives way: the burst, the air going, the shutters, the card, the results. */
  private updateFailure(dt: number): void {
    this.failT += dt;
    const t = this.failT;
    this.post.set("exposure", 1 - Math.min(0.35, Math.max(0, t - 0.9) * 0.3));
    if (t > 5.2 && this.phase === "failing") {
      this.phase = "over";
      this.hud.gameOver({ ...this.match.results() });
      this.sound.play("orbit_game_over");
    }
  }

  // --- MatchListener ------------------------------------------------------------------------

  banner(title: string, subtitle?: string): void {
    this.hud.banner(title, subtitle);
  }

  passStart(pass: number, _spec: PassSpec): void {
    this.sound.play("orbit_pass_start");
    this.sound.play("orbit_quindar", { volume: 0.6 });
    this.passT = 0;
    this.pushReadouts(true);
    // The pass's walk-ons.
    if (pass === ASTRONAUT_PASS) this.schedule.later(4, () => this.secrets.startAstronaut());
    if (duckPass(pass)) this.schedule.later(9, () => this.secrets.startDuck());
    if (pass === TOOLBAG_PASS) this.schedule.later(12, () => this.secrets.startToolbag());
    if (pass >= MOON_PASS && this.moonT < 0) this.moonT = 0;
  }

  passClear(_pass: number, b: PassBonuses): void {
    this.sound.play("orbit_pass_clear");
    showBonuses(this.hud, this.schedule, b, [
      [b.notAScratch, "Not a Scratch", "gold"],
      [b.goodNeighbour, "Good Neighbour", ""],
    ]);
    this.hints.setNeed(null);
    this.hints.clearWord();
    this.syncHint();
  }

  breather(_next: number): void {
    this.stormStarted = false;
    // The hull ticks as it goes from sun to shadow, and again coming back.
    this.schedule.later(1.6, () => this.ambient.creak());
    this.schedule.later(BREATHER - 1.2, () => this.ambient.creak());
  }

  sealed(_panes: number[]): void {
    this.sound.play("orbit_seal", { volume: 0.8 });
    this.pushReadouts(true);
  }

  spawn(f: Fragment): void {
    this.debris.add(f, this.match.time);
    if (f.kind === "derelict") {
      this.sound.play("orbit_derelict", { volume: 0.9 });
      this.schedule.later(0.8, () => this.offerTip("orbit.derelict"));
    }
  }

  private drift(f: Fragment): Vector3 {
    const a = f.position(this.match.time);
    const b = f.position(this.match.time + 0.05);
    return new Vector3((b.x - a.x) / 0.05, (b.y - a.y) / 0.05, (b.z - a.z) / 0.05);
  }

  vaporise(f: Fragment, award: Award): void {
    const at = this.debris.positionOf(f.id)?.clone() ?? new Vector3().copy(f.position(this.match.time) as Vector3);
    const d = at.distanceTo(this.camera.camera.position);
    this.effects.vaporise(at, this.drift(f).multiplyScalar(0.3), KINDS[f.kind].radius * 2, d, this.golden);
    this.debris.remove(f.id);
    const p = this.project(at);
    if (p) this.hud.hitMarker(p.x, p.y, "kill");
    this.popupAt(at, awardText(award), award.labels.includes("Far") ? "gold" : "");
  }

  split(parent: Fragment, _pieces: Fragment[], award: Award): void {
    const at = this.debris.positionOf(parent.id)?.clone() ?? new Vector3().copy(parent.position(this.match.time) as Vector3);
    this.effects.split(at, this.drift(parent).multiplyScalar(0.5), at.distanceTo(this.camera.camera.position));
    this.debris.remove(parent.id);
    const p = this.project(at);
    if (p) this.hud.hitMarker(p.x, p.y, "hit");
    this.popupAt(at, awardText(award));
    this.schedule.later(0.4, () => this.offerTip("orbit.split"));
  }

  stripped(f: Fragment, award: Award): void {
    const at = this.debris.positionOf(f.id)?.clone();
    if (!at) return;
    this.effects.flakes(at, this.drift(f), at.distanceTo(this.camera.camera.position));
    this.debris.strip(f.id);
    const p = this.project(at);
    if (p) this.hud.hitMarker(p.x, p.y, "hit");
    this.popupAt(at, awardText(award));
  }

  tankHit(f: Fragment, hits: number, award: Award): void {
    const at = this.debris.tankAt(f.id, new Vector3());
    if (!at) return;
    this.debris.vent(f.id, this.match.time);
    this.effects.split(at, this.drift(f), at.distanceTo(this.camera.camera.position));
    const p = this.project(at);
    if (p) this.hud.hitMarker(p.x, p.y, "headshot");
    this.popupAt(at, `${awardText(award)} ${hits} of 3`, "gold");
  }

  breakup(f: Fragment, _pieces: Fragment[], award: Award): void {
    const at = this.debris.positionOf(f.id)?.clone() ?? new Vector3();
    const d = at.distanceTo(this.camera.camera.position);
    this.debris.breakup(f.id);
    this.effects.vaporise(at, this.drift(f).multiplyScalar(0.3), 4, d, this.golden);
    this.debris.remove(f.id);
    this.flash.kick(0.12, this.ctx.settings.reducedFlashing);
    const p = this.project(at);
    if (p) this.hud.hitMarker(p.x, p.y, "kill");
    this.popupAt(at, awardText(award), "gold");
    this.sound.play("orbit_secret", { volume: 0.6, rate: 0.75 });
  }

  deflect(f: Fragment): void {
    const at = this.debris.positionOf(f.id);
    if (!at) return;
    this.effects.deflect(at, tmp.copy(this.camera.camera.position).sub(at).normalize(), at.distanceTo(this.camera.camera.position));
  }

  strike(f: Fragment, mark: Mark, integrity: number): void {
    const pane = this.glass.pane(mark.pane);
    const at = new Vector3(mark.point.x, mark.point.y, mark.point.z);
    this.debris.remove(f.id);
    const size = Math.min(1.5, mark.cost / 20);
    if (pane) this.effects.strike(at, pane.normal, size);
    // Sharp and close; heavier strikes lower and louder.
    const pan = Math.max(-1, Math.min(1, at.x / 1.2));
    this.sound.play("orbit_crack", { volume: Math.min(1, 0.55 + mark.cost / 60), rate: mark.size === "chip" ? 1.25 : mark.size === "crack" ? 1 : 0.85, pan });
    // A jolt through the frame.
    const dir = Math.atan2(at.x, -at.z);
    this.camera.flinch(dir, Math.min(1.4, mark.cost / 30));
    this.camera.rumble(Math.min(1, mark.cost / 45));
    this.flash.kick(Math.min(0.08, mark.cost / 600), this.ctx.settings.reducedFlashing);
    this.pushReadouts(true);
    if (integrity < ALARM_BELOW && integrity > 0) this.hud.hint(null);
  }

  frameStrike(f: Fragment, point: { x: number; y: number; z: number }): void {
    const at = new Vector3(point.x, point.y, point.z);
    this.debris.remove(f.id);
    this.effects.strike(at, at.clone().normalize(), 1);
    this.sound.play("orbit_boom", { volume: 0.9, pan: Math.max(-1, Math.min(1, at.x)) });
    this.camera.rumble(0.8);
  }

  passed(f: Fragment): void {
    this.debris.remove(f.id);
  }

  ring(_f: Fragment): void {
    this.sound.play("orbit_ring", { volume: 0.5 });
    this.offerTip("orbit.ring");
  }

  paneFailed(pane: number, breach: Breach): void {
    this.phase = "failing";
    this.failT = 0;
    this.hud.playerDown?.();
    this.hints.setQuiet(true);
    this.syncHint();
    this.ambient.stop();
    const p = this.glass.pane(pane);
    const point = this.match.glass.marks.filter((m) => m.pane === pane).at(-1)?.point;
    const at = point ? new Vector3(point.x, point.y, point.z) : (p?.center.clone() ?? new Vector3(0, 0, -1.5));
    this.glass.fail(pane, at);
    this.floats.decompress(at);
    if (p) this.effects.burst(p.center, p.normal, 0.4);
    this.sound.play("orbit_decompress");
    this.camera.rumble(this.ctx.settings.reducedMotion ? 0.4 : 1.6);
    this.flash.kick(0.35, this.ctx.settings.reducedFlashing);
    // The air goes, and with it every sound; the shutters slam.
    this.schedule.later(1.9, () => this.sound.stopAll());
    this.schedule.later(0.9, () => {
      this.glass.slam();
      this.sound.play("orbit_shutter");
      this.camera.rumble(0.9);
    });
    // The results' own words: "Breached on Pass 4", and what broke the glass.
    this.schedule.later(1.7, () => this.hud.banner(`Breached on Pass ${breach.pass}`, breachCause(breach)));
  }

  alarm(on: boolean): void {
    this.ambient.alarm(on);
  }

  drone(event: "launch" | "arrive" | "done" | "home" | "back"): void {
    if (event === "launch") {
      this.sound.play("orbit_quindar", { volume: 0.4 });
      this.offerTip("orbit.drone");
    }
  }

  droneShot(award: Award, hits: number, mending: boolean): void {
    this.sound.play("orbit_drone_hit", { volume: 0.9 });
    this.effects.deflect(this.droneView.center, tmp.copy(this.camera.camera.position).sub(this.droneView.center).normalize(), this.droneView.center.distanceTo(this.camera.camera.position));
    this.popupAt(this.droneView.center, awardText(award), "danger");
    this.hints.say(droneShotLine(hits, mending), 2);
    this.syncHint();
  }

  laser(event: "vent" | "vented" | "cooled" | "overheat"): void {
    switch (event) {
      case "overheat":
        this.sound.play("orbit_overheat");
        this.hints.setNeed(ventHint(this.ctx.input));
        this.syncHint();
        break;
      case "vent":
        this.sound.play("orbit_vent");
        this.hints.setNeed(null);
        // Vented by themselves: the next game need not say how.
        if (this.phase === "playing") this.hints.learned("orbit.heat");
        this.syncHint();
        break;
      case "cooled":
        this.hints.setNeed(null);
        this.syncHint();
        break;
      default:
        break;
    }
    this.pushHeat();
  }

  streakUp(multiplier: number): void {
    this.sound.play("orbit_streak", { rate: streakRate(multiplier) });
    this.pushReadouts(true);
  }

  score(value: number): void {
    this.hud.score(value);
  }

  secretFound(id: SecretId, name: string, found: number, total: number): void {
    switch (id) {
      case "astronaut":
        this.astronautShot();
        break;
      case "toolbag":
        this.secrets.toolbagShot();
        break;
      case "duck":
        this.secrets.duckShot();
        // A line to read, not a number to catch: on the hint line, for long enough.
        this.hints.say("In space, no one can hear you squeak.", 3.5);
        break;
      case "arm":
        this.secrets.armShot();
        break;
      case "capsule":
        this.secrets.capsuleShot();
        break;
      case "moon":
        this.secrets.flag();
        break;
      case "message":
        this.secrets.blinkHi();
        break;
      default:
        break;
    }
    this.syncHint();
    const announce = () => {
      if (this.phase !== "playing") return;
      this.hud.secret(name, found, total);
      this.sound.play("orbit_secret", { delay: 0.1 });
    };
    // Its show plays first, the toast after it.
    this.schedule.later(id === "message" ? 1.3 : id === "astronaut" ? 1.2 : 0.3, announce);
  }

  secretAgain(id: SecretId): void {
    // The ones still there to be shot play their show again: the arm waves
    // back every time, the flag glints, the HI says hello again, and the
    // spacewalker, back at work, is no more impressed (or no less flat).
    if (id === "arm") this.secrets.armShot();
    else if (id === "moon") this.secrets.flag();
    else if (id === "message") this.secrets.blinkHi();
    else if (id === "astronaut") this.astronautShot();
  }

  /** The spacewalker: shot near, a thumbs-down; shot square on, there was never anyone there. */
  private astronautShot(): void {
    const shot = this.shooter.result.target;
    const square = shot.kind === "secret" && shot.shot.secret === "astronaut" && shot.shot.at;
    this.secrets.astronautShot(square);
    if (square) {
      this.hints.say("Only a sticker.", 2.5);
      this.syncHint();
    }
  }

  flashShot(count: number, aurora: boolean): void {
    if (!aurora && count < 3) this.popupAt(this.shooter.result.point, `Lightning ×${count}`);
  }

  // --- for the dev harness ----------------------------------------------------------------------

  /** Read-only views and a few switches for scripted play and screenshots. */
  get debug() {
    return {
      phase: () => this.phase,
      match: () => this.match,
      real: () => this.assets?.real,
      camera: () => this.camera.camera,
      /** Hold the sky at a moment: "day" t seconds into a pass, or "breather" t seconds into one. */
      sky: (kind: "day" | "breather" | null, t = 0) => {
        this.skyHeld = kind ? { kind, t } : null;
        this.sky = this.skyHeld ?? this.sky;
        this.applySky(0, true);
      },
      /** Turn the ground to this many degrees from where the art put it (as passes and breathers would). */
      ground: (degrees: number) => {
        this.groundAngle = (degrees * Math.PI) / 180;
        this.applySky(0, true);
      },
      /** What the eye sees along a viewport point: the art's meshes in the way, nearest first. */
      pick: (x: number, y: number) => {
        const ray = new Raycaster();
        ray.setFromCamera(new Vector2(x * 2 - 1, 1 - y * 2), this.camera.camera);
        return ray.intersectObjects([this.assets.cupola, this.assets.station], true).slice(0, 4).map((h) => ({ name: contractName(h.object), distance: +h.distance.toFixed(2) }));
      },
      /** Where the Derelict's fuel tank is on screen, if one is flying. */
      tank: () => {
        const d = this.match.fragments.find((f) => f.kind === "derelict" && f.flying);
        const at = d ? this.debris.tankAt(d.id, new Vector3()) : null;
        const p = at ? this.project(at) : null;
        return p && d ? { ...p, shows: tankShows(d, this.match.time, this.match.layout.eye) } : null;
      },
      /** Bring on a secret's walk-on now (the spacewalker, the duck, the tool bag, the Moon). */
      walkOn: (id: "astronaut" | "duck" | "toolbag" | "moon") => {
        if (id === "astronaut") this.secrets.startAstronaut();
        if (id === "duck") this.secrets.startDuck();
        if (id === "toolbag") this.secrets.startToolbag();
        if (id === "moon") this.moonT = 200;
      },
      /** Find a secret as a shot at it would (its show, its toast). */
      find: (id: SecretId) => {
        const shot = id === "astronaut" ? { secret: id, at: true } : { secret: id };
        this.match.resolveShot({ kind: "secret", shot } as Parameters<Match["resolveShot"]>[0]);
      },
      /** The night map's countries the breathers show, and the HI's light. */
      nights: () => ({ regions: this.litRegions, hiLight: this.hiLight, shown: this.nights }),
      /** Hold the match (nothing more is sent; the pass never ends). */
      hold: (on: boolean) => {
        this.match.director = !on;
      },
      /** Send one fragment now, of a kind, at a pane (or "frame", or "miss"). */
      send: (kind: "shrapnel" | "chunk" | "slab" | "shard" | "foil", at: number | "frame" | "miss" = 0, speed?: number) => {
        const f = typeof at === "number" ? this.match.send(kind, "pane", { pane: at, ...(speed ? { speed } : {}) }) : this.match.send(kind, at, speed ? { speed } : {});
        return f.id;
      },
      derelict: () => this.match.sendDerelict().id,
      /** Bring the end quickly: the centre pane all but gone, and a fast scrap on its way to it. */
      breach: () => {
        this.match.glass.integrity[0] = 4;
        this.pushReadouts(true);
        return this.match.send("shrapnel", "pane", { pane: 0, speed: 45 }).id;
      },
      /** Strike a pane now, at this cost, as a fragment would. */
      strike: (pane: number, cost: number) => {
        const p = this.glass.pane(pane);
        if (!p) return;
        const jitter = new Vector3((this.visualRandom() - 0.5) * 0.3, (this.visualRandom() - 0.5) * 0.3, 0);
        const point = p.center.clone().add(jitter);
        const r = this.match.glass.strike(pane, cost, point, this.match.time);
        this.pushReadouts(true);
        return r.mark.size;
      },
      /** Viewport positions of what can be shot now. */
      targets: () => {
        const out: { kind: string; id: number; x: number; y: number; distance: number; closing: number }[] = [];
        for (const f of this.match.fragments) {
          if (!f.flying) continue;
          const b = this.debris.bounds(f.id);
          if (!b) continue;
          const p = this.project(b.center);
          if (p) out.push({ kind: f.kind, id: f.id, x: p.x, y: p.y, distance: b.center.distanceTo(this.camera.camera.position), closing: f.closing(this.match.time) });
        }
        const d = this.project(this.droneView.center);
        if (d) out.push({ kind: "drone", id: 0, x: d.x, y: d.y, distance: this.droneView.center.distanceTo(this.camera.camera.position), closing: Infinity });
        return out;
      },
      /** Where a world point is on screen. */
      project: (x: number, y: number, z: number) => this.project(new Vector3(x, y, z)),
      secrets: () => this.secrets,
      stage: () => this.stage,
      drone: () => this.match.drone,
    };
  }
}

/** Distance along a ray (unit `d` from `o`) to a sphere, or null if it misses. */
function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number): number | null {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

