import { Euler, PerspectiveCamera, SRGBColorSpace, Vector3, type Object3D, type ToneMapping } from "three";
import type { Aim, CalibrationStage, CalibrationTarget, Game, GameContext, HudSink, Readout, TargetNoun } from "../../engine/types";
import { loadSoundPack } from "../../audio/index";
import { mulberry32 } from "../../engine/rules/rng";
import { ScreenFlash } from "../../engine/world/flash";
import { chromeKeepOut, fitFraming, WEAPON_DOCK, type Framing, type Sight } from "../../engine/world/framing";
import { PlayerCamera } from "../../engine/world/playerCamera";
import { PostFX } from "../../engine/world/post";
import { Sound } from "../../engine/world/sound";
import type { Actor, Vehicle } from "./rules/actors";
import { landingMils, rangeAt, roundAt, timeOfFlight } from "./rules/ballistics";
import type { StageSpec } from "./rules/jobs";
import { Mission, type AlertCause, type MissionListener, type NearPass } from "./rules/mission";
import { fallCard } from "./rules/notes";
import type { Award, StageBonuses } from "./rules/scoring";
import { Spotter } from "./rules/spotter";
import { HIP_SPREAD } from "./rules/tuning";
import type { Ending, HitPart, HostileRole, Landing, Plan, SecretId, ShotTarget } from "./rules/types";
import { ALL_TIPS, HintLine, innocentWord, placeName, reloadHint, spotterWord, tipText, turnWord, type TipId } from "./tips";
import { Ambient } from "./world/ambient";
import { loadAssets, type RidgeAssets } from "./world/assets";
import { Cast } from "./world/cast";
import { seenStretch } from "./world/duckPath";
import { Effects } from "./world/effects";
import { Foreground } from "./world/foreground";
import { DAWN } from "./world/grade";
import { PlateStage } from "./world/plates";
import { GLASS, Scope } from "./world/scope";
import { SecretsWorld } from "./world/secretsWorld";
import { Shooter, type Flight, type Landing3D } from "./world/shots";
import { Stage } from "./world/stage";
import type { Surface } from "./world/valley";

export interface RidgeOptions {
  /** Start on this stage (the dev harness's ?wave=). */
  startStage?: number;
  /** Hits hurt but never kill (screenshots, performance runs). */
  immortal?: boolean;
  /** Load the art from this folder instead of assets/ridge/. */
  assetBase?: string;
}

/** How long the view takes to widen from the range to the valley when a round begins. */
const FRAMING_EASE = 1.6;
/** Radians of honest help on a hostile's body for a finger pistol (a mouse gets none). */
const HAND_ASSIST = 0.0004;

const IMPACT_SOUND: Record<Surface, string> = {
  grass: "ridge_hit_dirt",
  dirt: "ridge_hit_dirt",
  snow: "ridge_hit_dirt",
  rock: "ridge_hit_rock",
  stone: "ridge_hit_rock",
  wood: "ridge_hit_wood",
  metal: "ridge_hit_metal",
  glass: "ridge_hit_glass",
  water: "ridge_hit_water",
  cloth: "ridge_hit_dirt",
};

interface Scheduled {
  at: number;
  run: () => void;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const TRAIL_POINT = new Vector3();
/** How much the eye opens up for a scoped view in the shade: at most two stops (art/ridge/README.md). */
const SCOPE_ADAPT = 3.2;

/** How far a man is from the eye, metres. */
function rangeFrom(a: Actor, eye: Vector3): number {
  return Math.hypot(a.pos.x - eye.x, a.pos.y - eye.y, a.pos.z - eye.z);
}

/** A moment for the page between the long steps of getting ready, so the bar keeps moving. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The aim check's stage until the plates exist, and a way back to them after a game. */
class CalibrationProxy implements CalibrationStage {
  readonly noun: TargetNoun = { one: "plate", many: "plates" };
  target: PlateStage | null = null;
  onBegin: () => void = () => {};
  begin(): void {
    this.onBegin();
    this.target?.begin();
  }
  targets(): CalibrationTarget[] {
    return this.target ? this.target.targets() : [];
  }
  light(id: string | null): void {
    this.target?.light(id);
  }
  hit(id: string): void {
    this.target?.hit(id);
  }
  miss(id: string, x: number, y: number): void {
    this.target?.miss(id, x, y);
  }
  done(): void {
    this.target?.done();
  }
}

/**
 * Overwatch Ridge: the Game the app hosts. It owns the world (the valley,
 * its people, the scope, the rounds in flight, the effects, the plates of
 * the aim check) and the rules (Mission), turns the player's aim into shots
 * through the scope or from the hip, and answers the rules' events with
 * pictures, sounds and the HUD.
 */
export class OverwatchRidge implements Game, MissionListener {
  readonly id = "overwatch-ridge";
  readonly title = "Overwatch Ridge";
  readonly calibration: CalibrationStage;
  private readonly proxy = new CalibrationProxy();

  private ctx!: GameContext;
  private hud!: HudSink;
  private assets!: RidgeAssets;
  private stage!: Stage;
  /** The plan the missions are played on (see `plan`). */
  private seenPlan: Plan | null = null;
  private camera!: PlayerCamera;
  /** The view without the scope: what the hand aims in, and what the aim check is judged through. */
  private readonly wide = new PerspectiveCamera(46, 16 / 10, 0.25, 16000);
  private wideFov = 46;
  private sound!: Sound;
  private effects!: Effects;
  private cast!: Cast;
  private shooter!: Shooter;
  private readonly scope = new Scope();
  private plates!: PlateStage;
  private foreground!: Foreground;
  private ambient!: Ambient;
  private secrets!: SecretsWorld;
  private post!: PostFX;
  private mission!: Mission;
  /** The spotter: marks over where the job's men are, and a word when no one has found them. */
  private spotter = new Spotter();
  private markClock = 0;
  private marked = false;

  private phase: "loading" | "calibration" | "playing" | "failing" | "dying" | "over" = "loading";
  private paused = false;
  private time = 0;
  private runTime = 0;
  private lastDt = 1 / 60;
  private readonly flash = new ScreenFlash();
  private hurtDisplay = 0;
  private hurtShown = -1;
  private hurtFilter = -1;
  private deathT = 0;
  private hurtSide = 1;
  private failT = 0;
  private hints = new HintLine(new Set());
  private hintShown: string | null = null;
  private readonly schedule: Scheduled[] = [];
  private readonly visual = mulberry32(17);
  private golden = false;
  private reloadKey = false;
  private wasOffscreen = false;
  private wasArmed = true;
  private wasDown = false;
  /** A shot waits for the bolt: the thumb raised (the hand) or the button let go (a pointer). */
  private boltWaiting = false;
  private readoutKey = "";
  private readoutClock = 0;
  private range: number | null = null;
  private rangeClock = 0;
  private framings: { check: Framing; play: Framing } | null = null;
  private framed: { width: number; height: number } | null = null;
  private bufferHeight = 720;
  private width = 1280;
  private height = 720;
  private shownFov = 0;
  private previousToneMapping: ToneMapping | null = null;
  private readonly landings: { kind: string; surface: string; id: number; part: string; point: number[]; range: number }[] = [];
  /** The rounds whose trail is being drawn, and how far along their path it has been. */
  private readonly trails = new Map<number, { flight: Flight; x: number }>();
  private readonly engineLoops = new Set<string>();
  private recoilFlash = 0;
  private stillDebug = false;
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.key === "r" || e.key === "R") && !e.repeat) this.reloadKey = true;
  };

  constructor(private readonly options: RidgeOptions = {}) {
    this.calibration = this.proxy;
  }

  // --- Game ------------------------------------------------------------------------------

  async load(ctx: GameContext, onProgress: (fraction: number) => void): Promise<void> {
    this.ctx = ctx;
    this.hud = ctx.hud;
    this.golden = ctx.settings.unlocks.has("golden");
    const renderer = ctx.renderer;
    this.previousToneMapping = renderer.toneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.enabled = false;

    let artDone = 0;
    let soundDone = 0;
    const report = () => onProgress(Math.min(0.97, artDone * 0.72 + soundDone * 0.22));
    const sounds = loadSoundPack(ctx.audio, "ridge", (f) => {
      soundDone = f;
      report();
    }).catch((err) => console.warn("Overwatch Ridge: the sound pack did not load", err));
    this.assets = await loadAssets(
      ctx,
      (f) => {
        artDone = f;
        report();
      },
      this.options.assetBase ?? null,
    );
    await breathe();
    const valley = this.assets.valley;
    this.stage = new Stage(renderer, valley, this.assets.sky, this.assets.terrainArt);
    await breathe();
    const ground = this.stage.heightfield.height(valley.eye.x, valley.eye.z);
    this.camera = new PlayerCamera(valley.eye, valley.eyeQuaternion, valley.fov, { near: 0.25, far: 16000, groundY: ground });
    this.camera.reducedMotion = ctx.settings.reducedMotion;
    this.camera.still = true;
    this.wideFov = valley.fov;
    this.sound = new Sound(ctx.audio, this.camera.camera);
    this.effects = new Effects(this.stage.fxRoot, ctx.quality, this.stage.atmosphere);
    this.effects.setRandom(this.visual);
    this.cast = new Cast(this.assets, this.stage.dynamic, this.stage.heightfield, this.stage.atmosphere, valley.eye, valley.secrets.duck);
    this.cast.assist = (ctx.input ?? "hand") === "hand" ? HAND_ASSIST : 0;
    this.cast.sunFlat.set(this.stage.toSun.x, 0, this.stage.toSun.z).normalize();
    this.cast.horizonAt = (x, y, z) => this.stage.horizonAt(x, y, z);
    await breathe();
    this.shooter = new Shooter(this.stage.heightfield, this.stage.queries, (o) => this.secretOf(o), this.visual);
    this.plates = new PlateStage(valley.plates, this.stage.fxRoot, () => this.wide, this.effects, this.sound, this.stage.heightfield, () => ({ width: this.width, height: this.height }), this.stage.atmosphere);
    this.proxy.target = this.plates;
    this.proxy.onBegin = () => {
      if (this.phase === "over" || this.phase === "dying" || this.phase === "failing") this.rearm();
    };
    this.foreground = new Foreground(this.stage.atmosphere, valley.foregroundGrass === null);
    this.foreground.golden = this.golden;
    this.scope.gold = this.golden;
    // The grass lies just ahead of the eye, turned the way it looks (about Y only).
    this.foreground.root.position.copy(valley.eye);
    this.foreground.root.rotation.y = new Euler().setFromQuaternion(valley.eyeQuaternion, "YXZ").y;
    this.stage.scene.add(this.foreground.root);
    const bell = valley.secrets.bell ? valley.secrets.bell.getWorldPosition(new Vector3()) : null;
    const riverLine = valley.plan.duck.length ? valley.plan.duck : valley.plan.road;
    // The art's own mist ribbons lie on the real river; the placeholder's banks only stand in for them.
    this.ambient = new Ambient(this.stage.fxRoot, this.stage.atmosphere, valley.mist.length ? [] : riverLine, this.sound, valley.flag, bell);
    this.secrets = new SecretsWorld(valley.secrets, this.effects, this.sound, this.stage.heightfield, valley.plan.cheese, valley.eye);
    this.post = new PostFX(renderer, this.stage.scene, this.camera.camera, ctx.quality, {
      grade: DAWN,
      bloom: { threshold: 1.05, intensity: 0.6, radius: 0.65 },
      sepia: false,
      hurt: { color: [0.32, 0.015, 0.01] },
      vignette: 0.26,
    });
    // The white balance the art was graded with (1 on the placeholder).
    const wb = valley.light?.whiteBalance ?? [1, 1, 1];
    this.post.set("wbR", wb[0]);
    this.post.set("wbG", wb[1]);
    this.post.set("wbB", wb[2]);
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720, renderer.getPixelRatio());
    this.newMission();
    await breathe();
    await this.warmUp();
    await sounds;
    window.addEventListener("keydown", this.onKey);
    const nearRiver = riverLine[Math.floor(riverLine.length / 2)] ?? null;
    this.ambient.start(valley.plan.eye, nearRiver);
    this.phase = "calibration";
    this.plates.begin();
    onProgress(1);
  }

  /**
   * The valley's plan, with the duck swimming only the stretch of its river
   * the scope can see: the far bend lies behind the bank, and the duck's slow
   * swim would spend the round there (see duckPath.ts).
   */
  private get plan(): Plan {
    if (!this.seenPlan) {
      const valley = this.assets.valley;
      const { eye } = valley;
      const ground = this.stage.heightfield;
      // A duck sits a hand above the water: seen if the eye reaches its middle and its top.
      const seen = (p: { x: number; y: number; z: number }) => [0.12, 0.2].every((h) => ground.segmentHit(eye.x, eye.y, eye.z, p.x, p.y + h, p.z) < 0);
      this.seenPlan = { ...valley.plan, duck: seenStretch(valley.plan.duck, seen) };
    }
    return this.seenPlan;
  }

  private newMission(): void {
    this.cast?.reset();
    this.mission = new Mission({ random: this.ctx.random, plan: this.plan, listener: this, difficulty: this.ctx.settings.difficulty });
    this.mission.health.immortal = this.options.immortal === true;
    this.spotter = new Spotter(this.ctx.settings.difficulty);
    this.marked = false;
  }

  /** Compile every shader before play: a shader first compiled mid-shot is a dropped frame at the worst time. */
  private async warmUp(): Promise<void> {
    const r = this.ctx.renderer;
    const scene = this.stage.scene;
    const hidden: Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      if ("compileAsync" in r) await r.compileAsync(scene, this.camera.camera);
      await breathe();
      this.post.render(0);
      this.scope.zoom = 1;
      this.scope.render(r, this.camera.camera, { right: 0, down: 1 });
      this.scope.zoom = 0;
    } catch {
      // Compiling ahead is an optimisation; the first frames will do it otherwise.
    }
    for (const o of hidden) o.visible = false;
  }

  /** Back to the state after load, for another game on this instance. */
  private rearm(): void {
    for (const key of this.engineLoops) this.sound.stopLoop(key);
    this.engineLoops.clear();
    this.cast.reset();
    this.effects.clearAll();
    this.shooter.clear();
    this.trails.clear();
    this.secrets.reset();
    this.ambient.reset();
    this.scope.reset();
    this.newMission();
    this.schedule.length = 0;
    this.camera.still = true;
    this.camera.setDeath(0, 1);
    this.foreground?.fall(0);
    this.fallTilt = 0;
    if (this.framings) this.camera.setFraming(this.framings.check, 0);
    this.camera.update(0);
    this.hurtDisplay = 0;
    this.flash.reset();
    this.post.set("hurt", 0);
    this.post.set("desaturate", 0);
    this.dim = 1;
    this.sound.filter("slowmo", 0);
    this.sound.filter("hurt", 0);
    this.hints.setQuiet(true);
    this.syncHint();
    this.hud.crosshair?.("default");
    this.phase = "calibration";
  }

  start(): void {
    if (this.phase === "loading") return;
    if (this.phase !== "calibration") this.rearm();
    else this.newMission();
    this.plates.done();
    this.plates.active = false;
    // The eye holds still: the breath is the scope's, the kick the rifle's (scope.ts).
    this.camera.still = true;
    this.camera.setDeath(0, 1);
    this.foreground?.fall(0);
    this.fallTilt = 0;
    if (this.framings) this.camera.setFraming(this.framings.play, this.ctx.settings.reducedMotion ? 0 : FRAMING_EASE);
    this.phase = "playing";
    this.time = 0;
    this.runTime = 0;
    this.deathT = 0;
    this.failT = 0;
    this.hurtShown = -1;
    this.readoutKey = "";
    this.boltWaiting = false;
    this.sound.filter("slowmo", 0);
    this.sound.filter("hurt", 0);
    this.hud.score(0);
    this.hud.health(0);
    this.hud.crosshair?.("default");
    this.hints = new HintLine(this.ctx.settings.tipsSeen);
    this.hints.setQuiet(false);
    this.mission.start(Math.max(1, Math.floor(this.options.startStage ?? 1)));
    this.showAmmo();
    // How to look through the scope stands at the foot of the view until the player has done it.
    this.standScope();
    if (this.golden) {
      this.hud.weaponFinish?.("gold");
      this.sound.play("ridge_golden", { volume: 0.8, delay: 0.4 });
      this.later(1.0, () => this.hud.popup(0.5, 0.62, "Golden Rifle", "gold"));
    }
    this.pushReadouts(true);
  }

  update(dt: number, _now: number, aim: Aim): void {
    if (this.phase === "loading" || this.paused) return;
    this.lastDt = dt;
    this.effects.reducedFlashing = this.ctx.settings.reducedFlashing;
    this.camera.reducedMotion = this.ctx.settings.reducedMotion;
    this.scope.reducedMotion = this.ctx.settings.reducedMotion;
    this.time += dt;
    if (this.phase === "playing") this.runTime += dt;
    this.runSchedule();

    // The scope: asked for in play (and only while the rifle is shouldered: not in the fall).
    // Whether the hand is in view does not matter to it: Shift, the right button or the Scope
    // button must scope with the hand lowered or lost (the view stays where it was aimed), and the
    // eye's scope is held on while the pointing hand hides the face.
    const canScope = this.phase === "playing" && this.mission.phase !== "failed";
    const changed = this.scope.update(dt, canScope && aim.scope, aim);
    if (changed === "in") {
      this.hud.crosshair?.("none");
      this.sound.play("ridge_scope_in", { volume: 0.8 });
      this.sound.loop("breath", "ridge_breath", { volume: 0.7 });
      if (this.phase === "playing") {
        this.hints.learned("ridge.scope");
        this.hints.setStanding(null);
      }
    } else if (changed === "out") {
      this.hud.crosshair?.("default");
      this.sound.play("ridge_scope_out", { volume: 0.7 });
      this.sound.stopLoop("breath");
    }

    if (this.phase === "calibration") {
      if (aim.fired && !aim.offscreen) this.calibrationShot(aim);
    } else if (this.phase === "playing") {
      this.gun(dt, aim);
    } else {
      this.reloadKey = false;
    }
    this.wasArmed = aim.armed;
    this.wasDown = aim.travel > 0.5;

    const wdt = this.phase === "dying" ? dt * Math.max(0.3, 1 - this.deathT / 0.4) : dt;
    if (this.phase !== "calibration") this.mission.update(wdt);
    else this.mission.update(0);
    this.updateWorld(wdt, dt, aim);
    if (this.phase === "playing") {
      this.pushReadouts(false);
      this.watchScope();
      this.watchSpotter(dt);
    } else {
      this.showMarks(null);
    }
    if (this.phase === "dying" || this.phase === "over") this.updateDeath(dt);
    if (this.phase === "failing") this.updateFail(dt);
    this.updateHurt(dt);
    this.hints.update(dt);
    this.syncHint();
  }

  /** The rifle: the bolt worked by the thumb, a reload off the screen or on R, and the trigger. */
  private gun(_dt: number, aim: Aim): void {
    const hand = (this.ctx.input ?? "hand") === "hand";
    // The bolt, after a shot: the thumb raised again (the re-arm), or a pointer's button let go.
    if (this.boltWaiting) {
      // The thumb back up (cocked, unfolded) - a pointer's button let go reads the same way.
      const raised = aim.armed && aim.travel < 0.3 && !aim.fired;
      if (raised && this.mission.cycle()) this.boltWaiting = false;
      else if (this.mission.rifle.state !== "spent") this.boltWaiting = false;
    }
    // Reload: off the screen (not while looking through the scope) or R.
    const off = aim.offscreen && !this.wasOffscreen && !this.scope.showing;
    this.wasOffscreen = aim.offscreen;
    if (this.reloadKey || off) {
      this.reloadKey = false;
      this.mission.requestReload();
    }
    if (aim.fired && !aim.offscreen) this.fire(aim);
  }

  private updateWorld(wdt: number, dt: number, aim: Aim): void {
    const m = this.mission;
    const windX = m.wind.speed;
    // The camera: the wide view (framing, breath, kick, flinch, the fall), then the scope over it.
    this.camera.camera.fov = this.wideFov;
    this.camera.still = true;
    this.camera.update(dt);
    this.wideFov = this.camera.camera.fov;
    const cam = this.camera.camera;
    this.wide.position.copy(cam.position);
    this.wide.quaternion.copy(cam.quaternion);
    this.wide.fov = this.wideFov;
    this.wide.aspect = cam.aspect;
    this.wide.updateProjectionMatrix();
    this.wide.updateMatrixWorld(true);
    if (this.stillDebug) this.scope.sway.set(0, 0);
    this.scope.apply(cam, this.wide, this.wideFov);
    if (this.fallTilt > 0) {
      // Lying there: the view tips down into the grass by the head.
      cam.rotateX(-0.6 * this.fallTilt);
      cam.updateMatrixWorld(true);
    }
    if (Math.abs(cam.fov - this.shownFov) > 1e-3) {
      this.shownFov = cam.fov;
      this.effects.setScale(this.bufferHeight, cam.fov);
    }
    this.post.set("scoped", this.scope.zoom);
    // The eye adapts through the glass: the targets lie in the ridge's shadow, so the scope on
    // the shade brightens toward mid-grey, by up to two stops, over about half a second.
    const adaptTo = 1 + (SCOPE_ADAPT - 1) * (1 - this.aimLit) * this.scope.zoom;
    this.scopeGain += (adaptTo - this.scopeGain) * Math.min(1, dt / 0.35);
    this.post.set("exposure", this.scopeGain * this.dim);

    this.cast.sunElevation = this.stage.atmosphere.uSunElev.value;
    // The duck bobs on its river; the rest of the valley's people as the rules have them.
    const duck = m.actors.find((a) => a.role === "duck");
    if (duck) this.cast.placeDuck(duck, 0);
    this.cast.update(wdt);
    this.shooter.update(
      wdt,
      this.cast,
      (f, where) => this.landed(f, where),
      (f, at, id) => this.throughGlass(f, at, id),
    );
    this.updateTrails();
    this.secrets.update(wdt);
    this.plates.update(wdt);
    this.ambient.update(wdt, windX, m.mist, cam.position, m.actors.filter((a) => a.role === "cow" && a.alive), m.plan.farm);
    // Hidden behind the scope; there for the fall, when the view tips into it.
    this.foreground.update(dt, windX, aim, this.scope.zoom < 0.4);
    this.steam(wdt);
    this.effects.update(wdt);
    this.stage.update(wdt, this.time, this.runTime, windX, m.mist);
    this.recoilFlash *= Math.exp(-dt / 0.06);
    this.post.set("flash", this.flash.update(dt));
    this.post.set("time", this.time);
  }

  render(): void {
    if (this.phase === "loading") return;
    this.post.render(this.lastDt);
    const dot = this.holdoverDot();
    this.scope.render(this.ctx.renderer, this.camera.camera, dot, this.recoilFlash);
  }

  /** Relaxed's help in the scope: where the round will land at the range under the reticle. */
  private holdoverDot(): { right: number; down: number } | null {
    if (!this.mission.tuning.holdoverDot || !this.scope.scoped || this.range === null) return null;
    const dir = tmp.set(0, 0, -1).applyQuaternion(this.camera.camera.quaternion);
    return landingMils(this.range, dir, this.mission.wind.speed);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.post) return;
    this.width = width;
    this.height = height;
    this.camera.setAspect(width / Math.max(1, height));
    this.post.setSize(width, height);
    this.bufferHeight = height * pixelRatio;
    this.scope.resize(width, height, pixelRatio);
    this.frame(width, height);
    this.camera.camera.fov = this.wideFov;
    this.effects.setScale(this.bufferHeight, this.camera.camera.fov);
    this.shownFov = this.camera.camera.fov;
  }

  /**
   * The two framings for this window's shape: the aim check's, close on the
   * soldiers' range and its plates, and play's, the whole valley from the farm
   * to the dam with the peaks above it, clear of the page's chrome.
   */
  private frame(width: number, height: number): void {
    if (this.framed && this.framed.width === width && this.framed.height === height) return;
    this.framed = { width, height };
    const aspect = width / Math.max(1, height);
    const hand = (this.ctx.input ?? "hand") === "hand";
    const keepOut = chromeKeepOut(width, height, hand, { panel: { width: 176, height: 196 }, dock: WEAPON_DOCK.magazine, scopeButton: this.ctx.input === "touch" });
    const RAD = Math.PI / 180;
    const check = fitFraming(this.sights("check"), aspect, {
      minFov: 14,
      maxFov: 56,
      minPitch: -30 * RAD,
      maxPitch: 0,
      preferPitch: -15 * RAD,
      slack: 2,
      marginX: 0.06,
      marginY: 0.08,
      keepOut,
    });
    const play = fitFraming(this.sights("play"), aspect, {
      minFov: 34,
      maxFov: 62,
      minPitch: -24 * RAD,
      maxPitch: 4 * RAD,
      preferPitch: -6 * RAD,
      slack: 1.5,
      marginX: 0.02,
      marginY: 0.03,
      keepOut,
    });
    this.framings = { check, play };
    const inPlay = this.phase === "playing" || this.phase === "dying" || this.phase === "over" || this.phase === "failing";
    this.camera.setFraming(inPlay ? play : check, 0);
    this.wideFov = (inPlay ? play : check).fov;
  }

  /** The points a framing must show, in the eye's own space. */
  private sights(which: "check" | "play"): Sight[] {
    const valley = this.assets.valley;
    const eye = valley.eye;
    const toEye = valley.eyeQuaternion.clone().invert();
    const out: Sight[] = [];
    const add = (p: { x: number; y: number; z: number }, clear: boolean, lift = 0) => {
      tmp.set(p.x, p.y + lift, p.z).sub(eye).applyQuaternion(toEye);
      out.push({ x: tmp.x, y: tmp.y, z: tmp.z, clear });
    };
    if (which === "check") {
      for (const c of this.plates.centres()) {
        add(c, true, 1.5);
        add(c, true, -1.5);
      }
      return out;
    }
    const plan = valley.plan;
    for (const p of plan.posts) if (p.kind !== "mortar") add(p.at, true, 1.8);
    for (const n of plan.nests) add(n.exposed, true, 0.5);
    for (const p of plan.dam) add(p, false, 2);
    for (const p of plan.patrol) add(p, true, 1.8);
    add(plan.chapel, false, 20);
    add(plan.farm, false, 3);
    const s = valley.secrets;
    for (const o of [s.siren, s.bell]) if (o) add(o.getWorldPosition(tmp2), false);
    return out;
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
    if (!this.stage) return;
    this.sound?.stopAll();
    this.sound?.filter("hurt", 0);
    this.sound?.filter("slowmo", 0);
    this.post?.dispose();
    this.cast?.dispose();
    this.effects?.dispose();
    this.scope.dispose();
    this.foreground?.dispose();
    this.ambient?.dispose();
    this.stage.dispose();
    if (this.previousToneMapping !== null) this.ctx.renderer.toneMapping = this.previousToneMapping;
  }

  // --- shooting --------------------------------------------------------------------------

  /** During the aim check the platform judges the shot; the valley answers only with the rifle. */
  private calibrationShot(aim: Aim): void {
    this.sound.play("ridge_rifle_shot", { volume: 0.9 });
    this.scope.kick(this.visual);
    this.foreground.fire();
    // No smoke: the aim check's view is drawn in close on the plates, and a
    // puff at the muzzle would fill it.
  }

  private fire(aim: Aim): void {
    const r = this.mission.trigger();
    if (r === "spent") {
      if ((this.ctx.input ?? "hand") === "hand") {
        this.hints.say(tipText("ridge.bolt", this.ctx.input, this.ctx.settings.scope), 1.8);
        this.syncHint();
      } else {
        // A pointer works the bolt as the button comes up: a quick second click finds it still closing.
        this.mission.cycle();
      }
      return;
    }
    if (r === "dry") {
      this.hints.setNeed(reloadHint(this.ctx.input));
      this.syncHint();
      return;
    }
    if (r !== "fired") return;
    this.boltWaiting = true;
    const cam = this.camera.camera;
    const scoped = this.scope.scoped;
    const dir = new Vector3();
    if (scoped) {
      dir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    } else {
      // From the hip: where the hand points, and wherever the rifle wanders.
      dir.set(aim.x * 2 - 1, 1 - aim.y * 2, 0.5).unproject(this.wide).sub(this.wide.position).normalize();
      const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, this.visual()))) * Math.cos(2 * Math.PI * this.visual());
      dir.x += g() * HIP_SPREAD;
      dir.y += g() * HIP_SPREAD;
      dir.z += g() * HIP_SPREAD;
      dir.normalize();
      const far = this.rangeAlong(cam.position, dir);
      if (far === null || far > 200) this.offerTip("ridge.hip");
    }
    const flight = this.shooter.fire(cam.position, dir, this.mission.wind.speed);
    this.trails.set(flight.tag, { flight, x: 12 });
    if (scoped) {
      this.scope.kick(this.visual);
      this.recoilFlash = this.effects.reducedFlashing ? 0.05 : 0.35;
    } else {
      this.scope.kick(this.visual);
      this.effects.puff(this.foreground.muzzle(tmp), this.golden);
    }
    this.foreground.fire();
    this.showAmmo();
    if ((this.ctx.input ?? "hand") === "hand") this.offerTip("ridge.bolt");
  }

  /** The round went through a windshield: it cracks, and the round goes on, turned a little. */
  private throughGlass(_f: Flight, at: Vector3, id: number): void {
    this.effects.impact("glass", at, tmp.set(0, 0, 1), tmp2.set(0, 0, 1));
    this.sound.at("ridge_hit_glass", at, 0.9);
    this.cast.crackGlass(id);
  }

  /** A round arrived: the picture and the sound where it landed, and the rules told. */
  private landed(f: Flight, where: Landing3D): void {
    // The real valley marks its great wall as a rectangle (secret.cliff's extras), not a mesh:
    // a round into the rock or the ground inside it is the echo's.
    const face = this.assets.valley.cliffFace;
    if (face && where.kind === "scenery" && this.onCliffFace(where.point)) where = { ...where, kind: "secret", secret: "echo" };
    const at = where.point;
    // The last few landings, for the harness and the tests.
    this.landings.push({ kind: where.kind, surface: where.surface, id: where.id, part: where.part, point: at.toArray(), range: Math.round(where.range) });
    if (this.landings.length > 20) this.landings.shift();
    const back = tmp2.copy(where.dir).negate();
    switch (where.kind) {
      case "actor": {
        this.effects.body(at, back);
        this.sound.at("ridge_hit_flesh", at, 1);
        break;
      }
      case "engine":
        this.effects.impact("metal", at, where.normal, back);
        this.sound.at("ridge_hit_metal", at, 0.9);
        break;
      case "vehicle":
        this.effects.impact("metal", at, where.normal, back);
        this.sound.at("ridge_hit_metal", at, 0.7);
        break;
      case "duck":
        this.secrets.duck(at);
        break;
      case "none":
        break;
      default:
        this.effects.impact(where.surface, at, where.normal, back);
        this.sound.at(IMPACT_SOUND[where.surface], at, 1);
        break;
    }
    if (this.phase === "calibration") return;
    const target = this.targetOf(where);
    const near: NearPass[] = [...f.near.entries()].map(([id, distance]) => ({ id, distance }));
    if (where.kind === "secret" && where.secret) this.secretShow(where.secret, where);
    const landing: Landing = { target, point: { x: at.x, y: at.y, z: at.z }, range: where.range };
    const scoped = this.scope.scoped;
    this.mission.land(landing, near);
    if (target.kind === "scenery" && scoped) this.missLesson(where);
  }

  private targetOf(where: Landing3D): ShotTarget {
    switch (where.kind) {
      case "actor":
      case "duck":
        return { kind: "actor", id: where.id, part: where.part };
      case "engine":
        return { kind: "engine", vehicle: where.id };
      case "vehicle":
        return { kind: "vehicle", vehicle: where.id };
      case "secret":
        return where.secret ? { kind: "secret", secret: where.secret } : { kind: "scenery" };
      case "none":
        return { kind: "none" };
      default:
        return { kind: "scenery" };
    }
  }

  /** Whether a point lies on the great wall's face (within its extras' rectangle, facing the eye). */
  private onCliffFace(p: Vector3): boolean {
    const face = this.assets.valley.cliffFace;
    if (!face) return false;
    const eye = this.assets.valley.eye;
    // Across: along the wall, square to the line from the eye; up: height.
    const toFace = tmp2.copy(face.centre).sub(eye).setY(0).normalize();
    const dx = p.x - face.centre.x;
    const dz = p.z - face.centre.z;
    const across = Math.abs(dx * -toFace.z + dz * toFace.x);
    const depth = Math.abs(dx * toFace.x + dz * toFace.z);
    return across <= face.halfWidth && Math.abs(p.y - face.centre.y) <= face.halfHeight && depth <= face.halfWidth;
  }

  /** Which secret an object of the valley is, if any. */
  private secretOf(o: Object3D): SecretId | null {
    const s = this.assets.valley.secrets;
    for (let n: Object3D | null = o; n; n = n.parent) {
      if (n === s.bell) return "bell";
      if (n === s.siren) return "siren";
      if (n === s.wedge || n === s.cheese) return "cheese";
      if (n === s.yetiRock || n === s.yeti) return "yeti";
      if (n === s.cliff) return "echo";
    }
    return null;
  }

  /** The secrets' shows, as a round lands on one (the rules count them). */
  private secretShow(id: SecretId, where: Landing3D): void {
    switch (id) {
      case "bell":
        this.secretDelay.bell = this.secrets.bell(where.point, where.normal);
        break;
      case "siren":
        this.secretDelay.siren = this.secrets.siren();
        this.later(this.secretDelay.siren + 1.2, () => this.mission.cowsLook(6));
        break;
      case "cheese":
        this.secretDelay.cheese = this.secrets.cheeseRoll();
        break;
      case "yeti":
        this.secretDelay.yeti = this.secrets.yeti();
        break;
      case "echo":
        this.secretDelay.echo = this.secrets.echo();
        break;
      default:
        break;
    }
  }

  private readonly secretDelay: Partial<Record<SecretId, number>> = {};

  /**
   * A miss through the scope, near a hostile: was it the drop or the wind?
   * The first of each is a lesson (the tips).
   */
  private missLesson(where: Landing3D): void {
    const cam = this.camera.camera;
    let nearest: Actor | null = null;
    let best = 12;
    for (const a of this.mission.actors) {
      if (!a.hostile || !a.shootable) continue;
      const d = Math.hypot(a.pos.x - where.point.x, a.pos.z - where.point.z);
      if (d < best) {
        best = d;
        nearest = a;
      }
    }
    if (!nearest) return;
    const chest = this.cast.chestOf(nearest.id, tmp) ?? tmp.set(nearest.pos.x, nearest.pos.y + 1.2, nearest.pos.z);
    // The miss in the scope's terms: up and down, left and right of him.
    const right = tmp2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const off = where.point.clone().sub(chest);
    const across = off.dot(right);
    const up = off.y;
    if (Math.abs(up) > Math.abs(across) * 0.8 && Math.abs(up) > 0.4) this.offerTip("ridge.drop");
    else if (Math.abs(across) > 0.4 && Math.abs(this.mission.wind.speed) > 1.5) this.offerTip("ridge.wind");
  }

  /** The distance straight along `dir` to the first thing in the valley, or null (the sky). */
  private rangeAlong(origin: Vector3, dir: Vector3): number | null {
    const hf = this.stage.heightfield;
    let best: number | null = null;
    const hit = this.stage.queries.cast(origin, dir, 3500, { point: new Vector3(), normal: new Vector3(), distance: 0, object: null });
    if (hit) best = hit.distance;
    const far = best ?? 3500;
    for (let d0 = 0; d0 < far; d0 += 40) {
      const d1 = Math.min(far, d0 + 40);
      const g = hf.segmentHit(origin.x + dir.x * d0, origin.y + dir.y * d0, origin.z + dir.z * d0, origin.x + dir.x * d1, origin.y + dir.y * d1, origin.z + dir.z * d1, 2);
      if (g >= 0) {
        best = d0 + g * (d1 - d0);
        break;
      }
    }
    // The people in the way (a rangefinder ranges a man, not the hill behind him).
    const end = tmp2.copy(dir).multiplyScalar(best ?? far).add(origin);
    const man = this.cast.test(origin, end, () => {});
    if (man) best = (best ?? far) * man.t;
    return best;
  }

  /**
   * The vapour trails: wisps along each round's path as it flies, from just
   * under the scope (the barrel sits below the line of sight) to the round.
   */
  private updateTrails(): void {
    const strength = this.scope.zoom > 0.5 ? 1 : 0.45;
    const p = TRAIL_POINT;
    for (const [tag, t] of this.trails) {
      const f = t.flight;
      const to = Math.min(f.done ? f.stopAt : rangeAt(f.t), f.stopAt);
      while (t.x < to) {
        roundAt(f.frame, t.x, p);
        // The barrel's height below the sight, closing over the first tens of metres.
        p.y -= 0.05 * Math.max(0, 1 - t.x / 45);
        this.effects.vapour(p, t.x, strength);
        t.x += Math.max(1.2, t.x * 0.02);
      }
      if (f.done || t.x >= f.stopAt) this.trails.delete(tag);
    }
  }

  /** Dead engines steam. */
  private steam(dt: number): void {
    for (const v of this.mission.vehicles) {
      if (!v.steaming) continue;
      const at = this.cast.engineOf(v.id, tmp);
      if (at && this.visual() < dt * 12) this.effects.steam(at, 1);
    }
  }

  // --- the HUD and the hint line ----------------------------------------------------------

  private project(at: Vector3): { x: number; y: number } | null {
    tmp.copy(at).project(this.camera.camera);
    if (tmp.z > 1) return null;
    return { x: (tmp.x + 1) / 2, y: (1 - tmp.y) / 2 };
  }

  private popupAt(at: Vector3, text: string, tone: "" | "gold" | "danger" = ""): void {
    const p = this.project(at);
    if (!p) return;
    this.hud.popup(Math.min(0.94, Math.max(0.06, p.x)), Math.min(0.9, Math.max(0.1, p.y)), text, tone);
  }

  private awardText(award: Award): string {
    const sign = award.points >= 0 ? "+" : "−";
    const label = award.labels.length ? ` ${award.labels.join(" · ")}` : "";
    return `${sign}${Math.abs(award.points).toLocaleString("en-US")}${label}`;
  }

  private offerTip(id: TipId): void {
    if (this.phase !== "playing") return;
    this.hints.offer(id, tipText(id, this.ctx.input, this.ctx.settings.scope));
    this.syncHint();
  }

  private syncHint(): void {
    const text = this.hints.text;
    if (text === this.hintShown) return;
    this.hintShown = text;
    this.hud.hint(text);
  }

  private showAmmo(): void {
    const r = this.mission.rifle;
    this.hud.ammo(r.rounds, r.capacity, r.reloading, r.style());
  }

  /** Range under the reticle, the wind, the stage, the targets left; the clock of a timed job. */
  private pushReadouts(force: boolean): void {
    const m = this.mission;
    this.rangeClock -= this.lastDt;
    if (this.rangeClock <= 0 || force) {
      this.rangeClock = 0.1;
      const cam = this.camera.camera;
      const dir = this.scope.showing ? tmp.set(0, 0, -1).applyQuaternion(cam.quaternion) : tmp.set(this.scope.look.x * 2 - 1, 1 - this.scope.look.y * 2, 0.5).unproject(this.wide).sub(this.wide.position).normalize();
      this.range = this.rangeAlong(cam.position, dir.clone());
      // Is the sun on what the reticle rests on? (For the eye's adaptation through the glass.)
      if (this.range !== null) {
        const p = tmp2.copy(dir).multiplyScalar(this.range).add(cam.position);
        const horizon = this.stage.horizonAt(p.x, p.y + 1, p.z);
        this.aimLit = Math.min(1, Math.max(0, (this.stage.atmosphere.uSunElev.value - horizon) / 0.02 + 0.5));
      } else {
        this.aimLit = 1;
      }
    }
    const w = m.wind.speed;
    const windValue = `${Math.abs(w) < 0.05 ? "" : w > 0 ? "→ " : "← "}${Math.abs(w).toFixed(1)} m/s`;
    const rangeValue = this.range === null ? "–" : `${Math.round(this.range)} m`;
    const objectives = Math.max(1, m.objectives);
    const key = `${rangeValue}|${windValue}|${m.stage}|${m.remaining}`;
    if (force || key !== this.readoutKey) {
      this.readoutKey = key;
      // The round first, then what is left of it, as in every game; the rifle's own readings after.
      const list: Readout[] = [
        { label: "Stage", value: String(m.stage) },
        { label: "Targets", value: String(m.remaining), meter: m.remaining / objectives },
        { label: "Range", value: rangeValue },
        { label: "Wind", value: windValue, meter: Math.max(-1, Math.min(1, w / 8)), signed: true, tone: Math.abs(w) > 5.5 ? "warning" : "" },
      ];
      this.hud.readouts(list);
    }
    this.readoutClock -= this.lastDt;
    if (this.readoutClock <= 0) {
      this.readoutClock = 0.25;
      const clock = m.clock();
      this.hud.clock?.(clock === null ? null : Math.ceil(clock), clock !== null && clock <= 10 ? "warning" : "");
    }
  }

  /**
   * How to look through the scope, said at the foot of the view and left
   * there until the player has done it themselves (a scope by the eye, Shift
   * or the button all count). Said again as the settings change under it.
   */
  private standScope(): void {
    if (this.ctx.settings.tipsSeen.has("ridge.scope")) {
      this.hints.setStanding(null);
      return;
    }
    this.hints.setStanding(tipText("ridge.scope", this.ctx.input, this.ctx.settings.scope));
  }

  /**
   * The spotter. While the view is wide he marks where the job's men are
   * (a chevron, the place, the range): for a newcomer a man 300 m away is a
   * few pixels, and nothing says where to look. When the fight is some
   * seconds old and no one has been in the glass, he says so too.
   */
  private watchSpotter(dt: number): void {
    this.standScope();
    const m = this.mission;
    const fighting = m.phase === "combat";
    const inPlay = fighting || m.phase === "intro";
    const w = this.width;
    const h = this.height;
    const scoped = this.scope.scoped;
    // The job's men in sight: what a mark is for, and what the glass finds.
    let men: Actor[] | null = null;
    const inSight = (): Actor[] => (men ??= m.actors.filter((a) => a.hostile && a.objective && a.shootable));
    let inGlass = false;
    if (scoped && fighting) {
      const reach = GLASS * Math.min(w, h) * 0.9;
      for (const a of inSight()) {
        const at = this.cast.chestOf(a.id, tmp) ?? tmp.set(a.pos.x, a.pos.y + 1.2, a.pos.z);
        const p = this.project(at);
        if (p && Math.hypot((p.x - 0.5) * w, (p.y - 0.5) * h) < reach) {
          inGlass = true;
          break;
        }
      }
    }
    const says = this.spotter.update(dt, fighting, this.scope.showing, inGlass);
    if (says) {
      const eye = this.camera.camera.position;
      const first = [...inSight()].sort((a, b) => rangeFrom(a, eye) - rangeFrom(b, eye))[0];
      if (first) {
        // Through the scope the marks are not drawn: which way to turn is what helps; in the wide view, where.
        const way = this.scope.showing ? this.turnToward(first, w, h) : null;
        this.hints.say(way ?? spotterWord(first.place, rangeFrom(first, eye)), 5);
        this.syncHint();
      }
    }
    // The marks follow the men ten times a second, only while the wide view is up.
    this.markClock -= dt;
    if (this.markClock > 0) return;
    this.markClock = 0.1;
    // Not while the view is still widening to the valley (the marks would split and merge as it goes).
    const settled = this.ctx.settings.reducedMotion || this.runTime > FRAMING_EASE + 0.2;
    if (!inPlay || !settled || !this.spotter.marking || this.scope.showing) {
      this.showMarks(null);
      return;
    }
    const eye = this.camera.camera.position;
    const marks: { id: number; x: number; y: number; label: string; range: number }[] = [];
    for (const a of inSight()) {
      const head = this.cast.headOf(a.id, tmp) ?? tmp.set(a.pos.x, a.pos.y + 1.7, a.pos.z);
      const p = this.project(head);
      if (!p || p.x < 0.02 || p.x > 0.98 || p.y < 0.05 || p.y > 0.95) continue;
      const range = rangeFrom(a, eye);
      // Men standing together share one mark: the first of them keeps its id, the nearest speaks for them.
      const near = marks.find((o) => Math.hypot((o.x - p.x) * w, (o.y - p.y) * h) < 56);
      if (near) {
        if (range < near.range) {
          near.range = range;
          near.label = `${placeName(a.place)} · ${Math.round(range)} m`;
        }
        near.y = Math.min(near.y, p.y);
        continue;
      }
      marks.push({ id: a.id, x: p.x, y: p.y, label: `${placeName(a.place)} · ${Math.round(range)} m`, range });
    }
    this.showMarks(marks);
  }

  /** Which way to turn the scope to bring a man into the glass, in words; null if he is behind the view. */
  private turnToward(a: Actor, w: number, h: number): string | null {
    const at = this.cast.chestOf(a.id, tmp) ?? tmp.set(a.pos.x, a.pos.y + 1.2, a.pos.z);
    const p = this.project(at);
    if (!p) return null;
    const dx = (p.x - 0.5) * w;
    const dy = (p.y - 0.5) * h;
    return turnWord(Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down");
  }

  private showMarks(marks: { id: number; x: number; y: number; label: string }[] | null): void {
    if (!marks?.length) {
      if (this.marked) this.hud.spotter?.(null);
      this.marked = false;
      return;
    }
    this.marked = true;
    this.hud.spotter?.(marks.map(({ id, x, y, label }) => ({ id, x, y, label })));
  }

  /** The first local seen through the scope is a lesson; so is the counter-sniper's first glint. */
  private watchScope(): void {
    if (!this.scope.scoped) return;
    for (const a of this.mission.actors) {
      if (a.side !== "civilian" || !a.alive) continue;
      const p = this.project(tmp.set(a.pos.x, a.pos.y + 1, a.pos.z));
      if (p && Math.hypot(p.x - 0.5, (p.y - 0.5) * (this.height / this.width)) < 0.3) {
        this.offerTip("ridge.civilian");
        break;
      }
    }
  }

  private updateHurt(dt: number): void {
    const hurt = this.mission.health.hurt;
    const shown = this.hurtDisplay;
    if (hurt <= shown) this.hurtDisplay = shown + (hurt - shown) * Math.min(1, dt * 4);
    else this.hurtDisplay = this.effects.reducedFlashing ? shown + (hurt - shown) * Math.min(1, dt * 10) : hurt;
    const h = this.hurtDisplay;
    this.post.set("hurt", h);
    const dying = this.phase === "dying" || this.phase === "over" ? Math.min(1, this.deathT / 2) : 0;
    this.post.set("desaturate", Math.min(1, h * 0.6 + dying * 0.7));
    if (Math.abs(h - this.hurtShown) > 0.01) {
      this.hurtShown = h;
      this.hud.health(h);
    }
    if (Math.abs(h - this.hurtFilter) > 0.02) {
      this.hurtFilter = h;
      this.sound.filter("hurt", h);
    }
  }

  /** The fall: the glass cracks, the scope comes down, the view tips into the grass, the card. */
  private updateDeath(dt: number): void {
    this.deathT += dt;
    const t = this.deathT;
    if (t > 0.7 && this.scope.on) {
      this.scope.update(0, false, { x: 0.5, y: 0.5, tracking: false });
    }
    if (t > 1.2) this.scope.cracked = false;
    this.dim = 1 - Math.min(0.25, t * 0.08);
    const fall = this.ctx.settings.reducedMotion ? 0 : Math.min(1, Math.max(0, t - 0.6) / 2.2);
    this.camera.setDeath(fall, this.hurtSide);
    this.foreground.fall(fall);
    this.fallTilt = fall * fall;
    if (t > 2.2 && this.phase === "dying") {
      const ending = this.mission.ending;
      if (ending && !this.cardShown) {
        this.cardShown = true;
        const card = fallCard(ending, this.mission.stage);
        this.hud.banner(card.title, card.line);
      }
    }
    if (t > 5.2 && this.phase === "dying") {
      this.phase = "over";
      this.hud.gameOver(this.mission.results());
      this.sound.play("ridge_game_over");
    }
  }

  private cardShown = false;
  /** Whether the sun is on what the reticle rests on (0 in the shade, 1 in the sun). */
  private aimLit = 1;
  /** The eye's adaptation through the scope, as an exposure. */
  private scopeGain = 1;
  /** The fall's dimming. */
  private dim = 1;
  /** How far the fallen view has tipped down into the grass (0-1). */
  private fallTilt = 0;

  /** A failed job: its moment, then the results. */
  private updateFail(dt: number): void {
    this.failT += dt;
    if (this.failT > this.mission.failHold) {
      this.phase = "over";
      if (this.scope.on) this.scope.update(0, false, { x: 0.5, y: 0.5, tracking: false });
      this.hud.crosshair?.("default");
      this.hud.gameOver(this.mission.results());
      this.sound.play("ridge_game_over");
    }
  }

  private later(seconds: number, run: () => void): void {
    this.schedule.push({ at: this.time + seconds, run });
  }

  private runSchedule(): void {
    for (let i = this.schedule.length - 1; i >= 0; i--) {
      const s = this.schedule[i]!;
      if (this.time >= s.at) {
        this.schedule.splice(i, 1);
        s.run();
      }
    }
  }

  // --- MissionListener ----------------------------------------------------------------------

  stageIntro(stage: number, _spec: StageSpec, title: string, line: string): void {
    this.spotter.begin(stage);
    this.hud.banner(title, line);
    this.sound.play("ridge_stage_start", { volume: 0.9 });
    this.pushReadouts(true);
  }

  stageStart(): void {
    this.pushReadouts(true);
  }

  stageClear(_stage: number, b: StageBonuses): void {
    this.sound.play("ridge_stage_clear");
    const lines: [string, "" | "gold"][] = [];
    if (b.accuracyPoints > 0) lines.push([`+${b.accuracyPoints} Accuracy ${Math.round(b.accuracy * 100)}%`, ""]);
    if (b.ghost > 0) lines.push([`+${b.ghost} Ghost`, "gold"]);
    if (b.cleanConscience > 0) lines.push([`+${b.cleanConscience} Clean Conscience`, ""]);
    if (b.time > 0) lines.push([`+${b.time} Time`, ""]);
    lines.forEach(([text, tone], i) => this.later(0.35 + i * 0.45, () => this.hud.popup(0.5, 0.56 + i * 0.05, text, tone)));
    this.hints.setNeed(null);
    this.hints.clearWord();
    this.syncHint();
    this.hud.clock?.(null);
  }

  breather(): void {
    this.hurtDisplay = 0;
  }

  spawn(a: Actor): void {
    this.cast.spawn(a);
  }

  gone(a: Actor): void {
    this.cast.gone(a);
  }

  vehicleSpawn(v: Vehicle): void {
    this.cast.vehicleSpawn(v);
    const key = `engine.${v.id}`;
    this.engineLoops.add(key);
    this.sound.loopAt(key, "ridge_truck", v.pos, v.kind === "jeep" ? 0.6 : 1);
  }

  vehicleGone(v: Vehicle): void {
    this.cast.vehicleGone(v);
    const key = `engine.${v.id}`;
    this.sound.stopLoop(key);
    this.engineLoops.delete(key);
  }

  alerted(_cause: AlertCause, by: Actor | null): void {
    const who = by ?? this.mission.actors.find((a) => a.hostile && a.alive) ?? null;
    if (who) this.sound.at("ridge_whistle_alarm", who.pos, 1);
    this.hints.say("They know you’re here.", 2);
    this.syncHint();
  }

  glint(a: Actor, seconds: number, kind: "scope" | "binoculars"): void {
    const at = this.cast.lensOf(a.id, new Vector3());
    if (!at) return;
    const d = at.distanceTo(this.camera.camera.position);
    this.effects.glint(at, d, seconds, kind === "scope" ? 1 : 0.55);
    if (kind === "scope") this.offerTip("ridge.glint");
  }

  enemyFire(a: Actor, weapon: "sniper" | "mg", hit: boolean): void {
    const at = this.cast.lensOf(a.id, new Vector3()) ?? new Vector3(a.pos.x, a.pos.y + 1.2, a.pos.z);
    const eye = this.camera.camera.position;
    const toEye = tmp.copy(eye).sub(at).normalize();
    if (weapon === "mg") {
      for (let k = 0; k < 7; k++) this.later(k * 0.085, () => this.effects.muzzle(at, toEye, 0.8));
      this.sound.at("ridge_mg_burst", at, 1);
    } else {
      this.effects.muzzle(at, toEye, 1.2);
      this.sound.at("ridge_far_shot", at, 1);
    }
    // The bullets outrun their sound: the crack by your head comes first.
    const d = at.distanceTo(eye);
    if (!hit) this.later(d / 780, () => this.sound.play("ridge_crack_near", { volume: 0.8, pan: (this.visual() - 0.5) * 1.2 }));
  }

  mortarLaunch(a: Actor, flight: number): void {
    this.sound.at("ridge_mortar_launch", a.pos, 1);
    this.later(Math.max(0, flight - 1.6), () => this.sound.play("ridge_mortar_whistle", { volume: 0.9 }));
  }

  mortarLand(outcome: "hit" | "near" | "far"): void {
    const eye = this.camera.camera.position;
    const d = outcome === "hit" ? 7 : outcome === "near" ? 16 + this.visual() * 10 : 40 + this.visual() * 30;
    const a = (this.visual() - 0.5) * 1.6;
    const x = eye.x + Math.sin(a) * d;
    const z = eye.z - Math.cos(a) * d * (this.visual() < 0.35 ? -0.6 : 1);
    const at = new Vector3(x, this.stage.heightfield.height(x, z), z);
    this.effects.blast(at, outcome !== "far");
    this.sound.play("ridge_mortar_blast", { volume: outcome === "far" ? 0.7 : 1, pan: Math.sin(a) });
    this.camera.rumble(outcome === "hit" ? 1.3 : outcome === "near" ? 0.8 : 0.3);
    if (outcome !== "far") this.flash.kick(outcome === "hit" ? 0.3 : 0.12, this.effects.reducedFlashing);
    if (this.scope.scoped) this.scope.boltShake();
  }

  playerHit(damage: number, direction: number, hurt: number, _by: HostileRole): void {
    this.hud.damage(direction, hurt);
    this.sound.play("ridge_hurt", { volume: Math.min(1, 0.6 + damage / 80), pan: Math.sin(direction) * 0.5 });
    this.sound.play("ridge_crack_near", { volume: 0.9, pan: Math.sin(direction) * 0.6 });
    this.camera.flinch(direction, Math.min(1.5, damage / 30));
    if (this.scope.scoped) {
      this.scope.kick(this.visual);
      this.scope.boltShake();
    }
    this.hurtSide = direction >= 0 ? -1 : 1;
  }

  playerDeath(_ending: Ending): void {
    this.phase = "dying";
    this.cardShown = false;
    this.deathT = 0;
    this.hud.playerDown?.();
    this.hud.clock?.(null);
    if (this.scope.zoom > 0.5) {
      this.scope.cracked = true;
      this.sound.play("ridge_scope_crack");
    }
    this.sound.play("ridge_death");
    this.sound.filter("slowmo", 1);
    this.sound.stopLoop("breath");
    this.hints.setQuiet(true);
    this.syncHint();
  }

  failed(ending: Ending): void {
    this.phase = "failing";
    this.failT = 0;
    this.hud.clock?.(null);
    const card = fallCard(ending, this.mission.stage);
    this.hud.banner(card.title, card.line);
    this.hints.setQuiet(true);
    this.syncHint();
  }

  kill(a: Actor, part: HitPart, award: Award): void {
    const chest = this.cast.chestOf(a.id, new Vector3()) ?? new Vector3(a.pos.x, a.pos.y + 1.3, a.pos.z);
    const p = this.project(chest);
    if (p) this.hud.hitMarker(p.x, p.y, part === "head" ? "headshot" : "kill");
    if (award.points !== 0) {
      const special = award.labels.some((l) => l === "Headshot" || l === "Officer" || l === "Sniper" || l === "Driver");
      this.popupAt(chest.add(tmp.set(0, 1.2, 0)), this.awardText(award), special ? "gold" : "");
    }
    this.sound.play("ridge_kill", { volume: 0.7 });
    this.sound.at("ridge_body_fall", a.pos, 0.8, 1, 0.5);
  }

  wound(a: Actor): void {
    const chest = this.cast.chestOf(a.id, new Vector3());
    const p = chest ? this.project(chest) : null;
    if (p) this.hud.hitMarker(p.x, p.y, "hit");
  }

  innocentHit(a: Actor, award: Award): void {
    this.popupAt(new Vector3(a.pos.x, a.pos.y + 2.2, a.pos.z), this.awardText(award), "danger");
    this.hints.say(innocentWord(a.role), 2);
    this.syncHint();
    if (a.role === "cow") this.sound.at("ridge_cow_moo", a.pos, 1);
  }

  vehicleHit(v: Vehicle, engine: boolean): void {
    if (engine && v.engineHits < 3) {
      const at = this.cast.engineOf(v.id, new Vector3());
      if (at) this.popupAt(at.add(tmp.set(0, 1.5, 0)), `Engine ${v.engineHits} of 3`);
    }
  }

  vehicleStopping(v: Vehicle, why: "driver" | "engine"): void {
    if (why === "engine") {
      const at = this.cast.engineOf(v.id, new Vector3());
      if (at) this.sound.at("ridge_steam", at, 1);
    }
    this.later(3, () => {
      const key = `engine.${v.id}`;
      this.sound.stopLoop(key);
      this.engineLoops.delete(key);
    });
  }

  engineStop(v: Vehicle, award: Award): void {
    const at = this.cast.engineOf(v.id, new Vector3());
    if (at) this.popupAt(at.add(tmp.set(0, 1.8, 0)), this.awardText(award), "gold");
  }

  dismount(): void {}

  startled(a: Actor): void {
    if (a.role === "goat") this.sound.at("ridge_goat", a.pos, 1);
    if (a.role === "sheep" && this.visual() < 0.3) this.sound.at("ridge_sheep", a.pos, 0.8);
  }

  streakUp(multiplier: number): void {
    const semitones = multiplier >= 4 ? 7 : multiplier === 3 ? 4 : 0;
    this.sound.play("ridge_streak", { rate: Math.pow(2, semitones / 12) });
  }

  score(value: number): void {
    this.hud.score(value);
  }

  rifle(event: "fired" | "spent" | "dry" | "busy" | "cycling" | "cycled" | "opened" | "reload" | "reloaded"): void {
    switch (event) {
      case "fired":
        this.sound.play("ridge_rifle_shot", { volume: 1 });
        break;
      case "spent":
      case "dry":
        this.sound.play("ridge_dry");
        break;
      case "cycling":
        this.sound.play("ridge_bolt");
        this.scope.boltShake();
        this.showAmmo();
        break;
      case "cycled":
      case "opened":
      case "reloaded":
        this.showAmmo();
        break;
      case "reload":
        this.sound.play("ridge_reload");
        this.showAmmo();
        this.hints.setNeed(null);
        this.syncHint();
        break;
      default:
        break;
    }
  }

  secretFound(id: SecretId, name: string, found: number, total: number): void {
    // Each secret is announced when its show has played: the bell when it is heard.
    const delay = (this.secretDelay[id] ?? 0) + (id === "duck" ? 0.2 : 0.4);
    if (id === "duck") {
      const duck = this.mission.actors.find((a) => a.role === "duck");
      if (duck) {
        const range = Math.round(Math.hypot(duck.pos.x, duck.pos.y, duck.pos.z));
        this.popupAt(new Vector3(duck.pos.x, duck.pos.y + 1, duck.pos.z), `Duck at ${range} m.`, "gold");
      }
    }
    this.later(delay, () => {
      if (this.phase !== "playing") return;
      this.hud.secret(name, found, total);
      this.sound.play("ridge_secret", { delay: 0.1 });
    });
  }

  goatHop(a: Actor): void {
    this.sound.at("ridge_goat", a.pos, 1, 1, 0.1);
  }

  eagleLands(a: Actor): void {
    this.sound.at("ridge_eagle", a.pos, 1);
    this.later(3, () => this.sound.at("ridge_eagle", this.assets.valley.plan.eagleRock, 0.8));
  }

  // --- for the dev harness and the tests -------------------------------------------------------

  get debug() {
    return {
      phase: () => this.phase,
      mission: () => this.mission,
      camera: () => this.camera.camera,
      wide: () => this.wide,
      scoped: () => this.scope.scoped,
      zoom: () => this.scope.zoom,
      real: () => this.assets?.real,
      range: () => this.range,
      framing: () => ({ ...this.framings, fov: this.camera.camera.fov }),
      trees: () => this.stage.treeCount,
      /** Hold the breath: no sway (for scripted shots and pictures). */
      still: (on: boolean) => {
        this.stillDebug = on;
      },
      /** A round from the counter-sniper's ledge, now (the fall and the results, for the tests). */
      hurt: (damage: number) => this.mission.debugHit(damage),
      setImmortal: (on: boolean) => {
        this.mission.health.immortal = on;
      },
      /** Viewport positions of what can be shot now (hostiles, locals, animals), through the wide view. */
      targets: () => this.debugTargets(),
      /**
       * Where to point the wide view (fractions) so that, scoped in there
       * and fired at once, the round lands on `id`'s chest (or head): the
       * drop, the wind and his walking worked out.
       */
      aimFor: (id: number, part: "head" | "chest" = "chest") => this.aimFor(id, part),
      /** Where to point the wide view to put a round on a world point (the hold worked out). */
      aimPoint: (x: number, y: number, z: number) => this.aimAtPoint(new Vector3(x, y, z)),
      /** Where the last rounds landed, oldest first. */
      landings: () => this.landings.slice(),
      /** Where someone's chest and head are in the world now. */
      bodyOf: (id: number) => ({ chest: this.cast.chestOf(id, new Vector3())?.toArray(), head: this.cast.headOf(id, new Vector3())?.toArray() }),
      /** The secrets' points, as viewport positions through the wide view. */
      secrets: () => {
        const out: Record<string, { x: number; y: number; distance: number; aim: { x: number; y: number } } | null> = {};
        for (const [k, p] of Object.entries(this.secrets.points())) {
          if (!p) {
            out[k] = null;
            continue;
          }
          tmp.copy(p).project(this.wide);
          out[k] = { x: (tmp.x + 1) / 2, y: (1 - tmp.y) / 2, distance: p.distanceTo(this.wide.position), aim: this.aimAtPoint(p) };
        }
        return out;
      },
      /** Point the scope at a world point now (for pictures), fully in. */
      lookAt: (x: number, y: number, z: number) => {
        tmp.set(x, y, z).project(this.wide);
        this.scope.look.set((tmp.x + 1) / 2, (1 - tmp.y) / 2);
      },
      /** Jump the wide view to a framing at once. */
      setFraming: (which: "check" | "play") => {
        if (this.framings) this.camera.setFraming(this.framings[which], 0);
      },
      /** Advance the sun's clock (for the shadow line's pictures). */
      setRunTime: (seconds: number) => {
        this.runTime = seconds;
      },
    };
  }

  private debugTargets() {
    const out: { id: number; role: string; side: string; activity: string; x: number; y: number; hx: number; hy: number; distance: number }[] = [];
    for (const a of this.mission.actors) {
      if (!a.shootable) continue;
      const chest = this.cast.chestOf(a.id, new Vector3()) ?? new Vector3(a.pos.x, a.pos.y + (a.role === "duck" ? 0.12 : 1), a.pos.z);
      const head = this.cast.headOf(a.id, new Vector3()) ?? chest.clone();
      const c = chest.clone().project(this.wide);
      const h = head.clone().project(this.wide);
      if (c.z > 1) continue;
      out.push({ id: a.id, role: a.role, side: a.side, activity: a.activity, x: (c.x + 1) / 2, y: (1 - c.y) / 2, hx: (h.x + 1) / 2, hy: (1 - h.y) / 2, distance: chest.distanceTo(this.wide.position) });
    }
    return out;
  }

  private aimFor(id: number, part: "head" | "chest"): { x: number; y: number; distance: number } | null {
    const a = this.mission.actors.find((x) => x.id === id);
    if (!a) return null;
    const spot = (part === "head" ? this.cast.headOf(id, new Vector3()) : this.cast.chestOf(id, new Vector3())) ?? new Vector3(a.pos.x, a.pos.y + (a.role === "duck" ? 0.12 : 1.3), a.pos.z);
    return this.aimAtPoint(spot, a.vel);
  }

  /** Where to point the wide view so a round fired at once lands on `spot` (moving at `vel`). */
  private aimAtPoint(spot: Vector3, vel: { x: number; z: number } = { x: 0, z: 0 }): { x: number; y: number; distance: number } {
    const eye = this.wide.position;
    const d = spot.distanceTo(eye);
    const t = timeOfFlight(d);
    // Lead a walking man by where he will be when the round arrives.
    spot = spot.clone();
    spot.x += vel.x * t;
    spot.z += vel.z * t;
    const dir = spot.clone().sub(eye).normalize();
    const hold = landingMils(d, dir, this.mission.wind.speed);
    // Aim high by the drop and into the wind by the drift.
    const right = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(up, hold.down / 1000).addScaledVector(right, -hold.right / 1000).normalize();
    const p = eye.clone().add(dir).project(this.wide);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, distance: d };
  }
}

export { ALL_TIPS };
