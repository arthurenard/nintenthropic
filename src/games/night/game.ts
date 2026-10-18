import { Box3, PCFShadowMap, SRGBColorSpace, Vector3, type Mesh, type Texture, type ToneMapping } from "three";
import type { Aim, CalibrationStage, CalibrationTarget, Game, GameContext, HudSink, Readout, TargetNoun } from "../../engine/types";
import { loadSoundPack } from "../../audio/index";
import { mulberry32 } from "../../engine/rules/rng";
import { RigPool } from "../../engine/world/character";
import { checkFraming, type Framing, type Sight } from "../../engine/world/framing";
import { PlayerCamera } from "../../engine/world/playerCamera";
import { PostFX } from "../../engine/world/post";
import { Sound } from "../../engine/world/sound";
import { Dead as DeadClass, offsetPath, paceOf, type Dead } from "./rules/dead";
import { takenBy } from "./rules/felled";
import { Match, type MatchListener, type Results } from "./rules/match";
import type { Award, WaveBonuses } from "./rules/scoring";
import type { SecretId, SignLetter } from "./rules/secrets";
import type { Survivor } from "./rules/survivors";
import type { DeadKind, DeathCause, HitPart, LaneId } from "./rules/types";
import type { WaveSpec } from "./rules/waves";
import { HintLine, reloadHint, survivorWord, tipText, type TipId } from "./tips";
import { Ambient } from "./world/ambient";
import { loadAssets, type NightAssets } from "./world/assets";
import { BeamEffect, beamVolume, syncBeamCamera, type BeamVolume } from "./world/beam";
import { Cast } from "./world/cast";
import { Effects } from "./world/effects";
import { Eyeshine } from "./world/eyes";
import { Flashlight } from "./world/flashlight";
import { NIGHT } from "./world/grade";
import { JarStage } from "./world/jars";
import { RoadQueries } from "./world/queries";
import { burstMoment, clipSpeeds, nightRim, nightTemplate, rigMaterials } from "./world/rigs";
import type { Surface } from "./world/road";
import { SecretsWorld } from "./world/secretsWorld";
import { withNightFog } from "./world/shading";
import { Shooter } from "./world/shooting";
import { playFraming, playSights } from "./world/sights";
import { Stage } from "./world/stage";

export interface NightOptions {
  /** Start on this wave (the dev harness's ?wave=). */
  startWave?: number;
  /** Hits hurt but never kill (screenshots, performance runs). */
  immortal?: boolean;
  /** Load the art from this folder instead of assets/night/ (the harness's asset tests). */
  assetBase?: string;
  /** No dead come of themselves (the harness stages its own, for screenshots). */
  quiet?: boolean;
}

/** How long the view takes to close in on the road when a round begins. */
const FRAMING_EASE = 1.6;
/**
 * Figures for the dead, made at load: the rules never have more of them up
 * at once (MatchOptions.figures), so none walks without a body to show it.
 */
const WALKER_FIGURES = 22;
const HIT_SOUND: Record<Surface, string> = {
  asphalt: "night_hit_ground",
  dirt: "night_hit_ground",
  wood: "night_hit_wood",
  metal: "night_hit_metal",
  glass: "night_hit_glass",
  cloth: "night_hit_sandbag",
  plant: "night_hit_corn",
  sandbag: "night_hit_sandbag",
  water: "night_hit_water",
};

interface Scheduled {
  at: number;
  run: () => void;
}

const tmp = new Vector3();
const tmp2 = new Vector3();

/** A moment for the page between the long steps of getting ready, so the loading bar keeps moving. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Before load() the aim check has nothing to show; afterwards this forwards
 * to the jars. If the host runs the aim check again on this instance after
 * a game (Play Again), the first call puts the road back for it.
 */
class CalibrationProxy implements CalibrationStage {
  readonly noun: TargetNoun = { one: "jar", many: "jars" };
  target: JarStage | null = null;
  onUse: () => void = () => {};
  onBegin: () => void = () => {};
  begin(): void {
    this.onBegin();
  }
  targets(): CalibrationTarget[] {
    this.onUse();
    return this.target ? this.target.targets() : [];
  }
  light(id: string | null): void {
    this.onUse();
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
 * Dead of Night: the Game the app hosts. It owns the world (the stage and
 * its night shading, the flashlight and its beam in the fog, the cast, the
 * effects, the secrets, the night's sounds, the jars) and the rules
 * (Match), turns the player's aim into the beam and the shots, and answers
 * the rules' events with pictures, sounds and the HUD.
 */
export class DeadOfNight implements Game, MatchListener {
  readonly id = "night";
  readonly title = "Dead of Night";
  readonly calibration: CalibrationStage;
  private readonly calibrationProxy = new CalibrationProxy();

  private ctx!: GameContext;
  private hud!: HudSink;
  private assets!: NightAssets;
  private stage!: Stage;
  private camera!: PlayerCamera;
  private sound!: Sound;
  private queries!: RoadQueries;
  private effects!: Effects;
  private flashlight!: Flashlight;
  private volume!: BeamVolume;
  private eyeshine!: Eyeshine;
  private cast!: Cast;
  private jars!: JarStage;
  private secretsWorld!: SecretsWorld;
  private ambient!: Ambient;
  private shooter!: Shooter;
  private post!: PostFX;
  private match!: Match;
  private pools!: { walker: RigPool; mechanic: RigPool; survivor: RigPool; cat: RigPool };

  private phase: "loading" | "calibration" | "playing" | "dying" | "over" = "loading";
  private paused = false;
  private time = 0;
  private lastDt = 1 / 60;
  private deathT = 0;
  private hurtDisplay = 0;
  private hurtShown = -1;
  private hurtFilter = -1;
  private readoutKey = "";
  private hints = new HintLine(new Set());
  private hintShown: string | null = null;
  private golden = false;
  private tier: GameContext["quality"]["tier"] = "high";
  private reloadKey = false;
  private card = false;
  private hurtSide = 1;
  private readonly schedule: Scheduled[] = [];
  private readonly shotPoint = new Vector3();
  private shotKilled = false;
  private visualRandom = mulberry32(1958);
  private previousToneMapping: ToneMapping | null = null;
  private sights: Sight[] = [];
  private framings: { check: Framing; play: Framing } | null = null;
  private framed: { width: number; height: number } | null = null;
  private bufferHeight = 720;
  private shownFov = 0;
  /** The fog as drawn: eased toward the rules' (it rolls in and out, never jumps). */
  private fog = 0.016;
  private readonly aimAt = { x: 0.5, y: 0.45 };
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.key === "r" || e.key === "R") && !e.repeat) this.reloadKey = true;
  };

  constructor(private readonly options: NightOptions = {}) {
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
    renderer.shadowMap.type = PCFShadowMap;

    // The sound pack synthesises (in workers) while the art loads; both report into one bar.
    let artDone = 0;
    let soundDone = 0;
    const report = () => onProgress(Math.min(0.97, artDone * 0.7 + soundDone * 0.25));
    const sounds = loadSoundPack(ctx.audio, "night", (f) => {
      soundDone = f;
      report();
    }).catch((err) => console.warn("Dead of Night: the sound pack did not load", err));
    this.assets = await loadAssets(
      ctx,
      (f) => {
        artDone = f;
        report();
      },
      this.options.assetBase ?? null,
    );
    const road = this.assets.road;
    this.stage = new Stage(renderer, road, this.assets.sky, this.assets.fog, this.assets.maps);
    this.stage.setQuality(ctx.quality);
    const u = this.stage.u;
    this.camera = new PlayerCamera(road.eye, road.eyeQuaternion, road.fov, { near: 0.1, far: 400 });
    this.camera.reducedMotion = ctx.settings.reducedMotion;
    this.camera.still = true;
    this.sound = new Sound(ctx.audio, this.camera.camera);
    await breathe();
    this.queries = new RoadQueries(road);
    this.effects = new Effects(this.stage.fxRoot, ctx.quality, u);
    this.effects.setRandom(this.visualRandom);
    for (const m of this.effects.materials) withNightFog(m, u, "debris");
    await breathe();

    const rim = nightRim();
    const walkerT = nightTemplate("walker", this.assets.walker, rim);
    const mechanicT = nightTemplate("mechanic", this.assets.mechanic, rim, this.assets.walker.animations);
    const survivorT = nightTemplate("survivor", this.assets.survivor, rim);
    const catT = nightTemplate("cat", this.assets.cat, rim);
    const parent = this.stage.dynamic;
    this.pools = {
      walker: new RigPool(walkerT, WALKER_FIGURES, parent),
      mechanic: new RigPool(mechanicT, 1, parent),
      survivor: new RigPool(survivorT, 1, parent),
      cat: new RigPool(catT, 1, parent),
    };
    // Every figure under the night's own fog, one program between them.
    for (const pool of Object.values(this.pools)) for (const r of pool.rigs) for (const m of rigMaterials(r)) withNightFog(m, u, "rig");
    await breathe();

    this.flashlight = new Flashlight(this.stage.scene);
    this.flashlight.setGolden(this.golden);
    this.volume = beamVolume();
    this.eyeshine = new Eyeshine(u);
    this.stage.scene.add(this.eyeshine.points);
    const toMoon = this.stage.moonDirection.clone().negate();
    this.cast = new Cast(
      { walker: this.pools.walker, mechanic: this.pools.mechanic, survivor: this.pools.survivor },
      parent,
      this.effects,
      this.sound,
      this.queries,
      road.eye,
      toMoon,
      this.flashlight,
      this.eyeshine,
      u,
      this.visualRandom,
      {
        cameIntoView: (d) => this.cameIntoView(d),
        eyesInFog: () => this.offerTip("night.eyes"),
        mechanicSeen: (d) => this.mechanicSeen(d),
      },
      { walker: clipSpeeds(this.assets.walker), mechanic: clipSpeeds(this.assets.mechanic), survivor: clipSpeeds(this.assets.survivor), burstAt: burstMoment(this.assets.walker) },
    );
    this.jars = new JarStage(road, parent, this.camera.camera, this.effects, this.sound, this.queries, road.eye);
    for (const m of this.jars.materials) withNightFog(m, u, "jar");
    this.calibrationProxy.target = this.jars;
    this.calibrationProxy.onUse = () => {
      if (this.phase === "over" || this.phase === "dying") this.rearm();
    };
    this.calibrationProxy.onBegin = () => {
      if (this.phase === "calibration") this.jars.reset();
      else if (this.phase !== "loading") this.rearm();
    };
    this.secretsWorld = new SecretsWorld(road, this.stage, this.effects, this.sound, this.flashlight, this.eyeshine, this.pools.cat, road.eye);
    const lamp = road.streetLight ? road.streetLight.getWorldPosition(new Vector3()) : new Vector3(3.6, 7.4, -24);
    this.ambient = new Ambient(this.sound, u, this.stage.street, this.stage.streetPower, this.stage.lampGlow, lamp, this.visualRandom);
    this.newMatch();
    this.shooter = new Shooter(
      this.camera.camera,
      this.queries,
      road,
      this.cast,
      {
        survivors: () => this.cast.survivors.map((v) => ({ s: v.s, joints: () => v.rig.updateJoints() })),
        cat: () => this.secretsWorld.catCenter(),
        driveInVisible: () => this.match.phase === "breather",
        scarecrowHere: () => this.secretsWorld.scarecrowHere(),
      },
      ctx.settings,
    );
    this.sights = playSights(this.assets.road);
    const volume = this.volume;
    this.post = new PostFX(renderer, this.stage.scene, this.camera.camera, ctx.quality, {
      grade: NIGHT,
      sepia: false,
      flash: false,
      hurt: { color: [0.22, 0.02, 0.018] },
      bloom: { threshold: 0.9, intensity: 0.45, radius: 0.7 },
      vignette: 0.32,
      effects: () => [new BeamEffect(volume)],
    });
    this.tier = ctx.quality.tier;
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720, renderer.getPixelRatio());
    this.flashlight.reset(this.camera.camera);
    this.aimFlashlight(0.5, 0.5);
    await breathe();
    await this.warmUp();
    this.tuneEcho();
    await sounds;
    window.addEventListener("keydown", this.onKey);
    this.ambient.start();
    this.phase = "calibration";
    onProgress(1);
  }

  /**
   * The echoes of an open country road: the station close behind, the
   * motel across the way, the tree line far off; soft surfaces, so the
   * report rolls away rather than slapping back.
   */
  private tuneEcho(): void {
    const engine = this.ctx.audio as { setSpace?: (space: Record<string, number>) => void };
    if (typeof engine.setSpace !== "function") return;
    engine.setSpace({ left: 24, right: 13, behind: 6, depth: 120, facade: 0.3, back: 0.6, far: 0.45 });
  }

  private newMatch(): void {
    const road = this.assets.road;
    this.match = new Match({
      random: this.ctx.random,
      plan: { lanes: road.lanes, slots: road.slots, eye: { x: road.eye.x, y: road.eye.y, z: road.eye.z } },
      survivorPaths: road.survivorPaths,
      listener: this,
      yaw: this.camera.yaw,
      difficulty: this.ctx.settings.difficulty,
      figures: WALKER_FIGURES,
    });
    this.match.health.immortal = this.options.immortal === true;
  }

  /** Every shader compiled before play: a shader first compiled mid-wave is a dropped frame at the worst time. */
  private async warmUp(): Promise<void> {
    const r = this.ctx.renderer;
    const scene = this.stage.scene;
    const shown: { visible: boolean; o: { visible: boolean } }[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        shown.push({ visible: false, o });
        o.visible = true;
      }
    });
    try {
      const textures = new Set<Texture>();
      scene.traverse((o) => {
        const m = (o as Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          for (const v of Object.values(mat)) if ((v as Texture | null)?.isTexture) textures.add(v as Texture);
          const uniforms = (mat as { uniforms?: Record<string, { value: unknown }> }).uniforms;
          if (uniforms) for (const un of Object.values(uniforms)) if ((un.value as Texture | null)?.isTexture) textures.add(un.value as Texture);
        }
      });
      let since = performance.now();
      for (const t of textures) {
        r.initTexture(t);
        if (performance.now() - since > 40) {
          await breathe();
          since = performance.now();
        }
      }
      if ("compileAsync" in r) await r.compileAsync(scene, this.camera.camera);
      else (r as { compile: (s: unknown, c: unknown) => void }).compile(scene, this.camera.camera);
      await breathe();
      syncBeamCamera(this.volume, this.camera.camera);
      this.post.render(0);
    } catch {
      // Compilation is an optimisation; the first frames will do it otherwise.
    }
    for (const s of shown) s.o.visible = s.visible;
  }

  /** Back to the state after load, for another night on this instance. */
  private rearm(): void {
    this.cast.reset();
    this.effects.clearAll();
    this.secretsWorld.reset();
    this.ambient.reset();
    this.newMatch();
    this.jars.reset();
    this.schedule.length = 0;
    this.camera.still = true;
    this.camera.setDeath(0, 1);
    if (this.framings) this.camera.setFraming(this.framings.check, 0);
    this.camera.update(0);
    this.flashlight.reset(this.camera.camera);
    this.deathT = 0;
    this.card = false;
    this.hurtDisplay = 0;
    this.volume.uBlur.value = 0;
    this.post.set("fade", 0);
    this.post.set("hurt", 0);
    this.post.set("desaturate", 0);
    this.post.set("exposure", 1);
    this.sound.filter("slowmo", 0);
    this.sound.filter("hurt", 0);
    this.hints.setQuiet(true);
    this.syncHint();
    this.phase = "calibration";
  }

  start(): void {
    if (this.phase === "loading") return;
    if (this.phase !== "calibration") this.rearm();
    // A fresh match either way: the difficulty is read here.
    else this.newMatch();
    this.jars.done();
    this.jars.active = false;
    this.camera.still = false;
    this.camera.setDeath(0, 1);
    if (this.framings) this.camera.setFraming(this.framings.play, this.ctx.settings.reducedMotion ? 0 : FRAMING_EASE);
    this.phase = "playing";
    this.time = 0;
    this.deathT = 0;
    this.card = false;
    this.hurtShown = -1;
    this.readoutKey = "";
    this.sound.filter("slowmo", 0);
    this.sound.filter("hurt", 0);
    const wave = Math.max(1, Math.floor(this.options.startWave ?? 1));
    this.hud.score(0);
    this.showRifle();
    this.hud.health(0);
    this.match.start({ wave });
    if (this.options.quiet) this.hold();
    this.hints = new HintLine(this.ctx.settings.tipsSeen);
    this.hints.setQuiet(false);
    this.offerTip("night.reload");
    if (this.golden) {
      this.hud.weaponFinish?.("gold");
      this.sound.play("night_golden", { volume: 0.8, delay: 0.4 });
      this.later(1.0, () => this.hud.popup(0.5, 0.62, "Golden Rifle", "gold"));
    }
    this.pushReadouts(true);
  }

  /** The harness's quiet night: the wave's dead stay in the fog. */
  private hold(): void {
    const m = this.match as unknown as { queue: unknown[]; spawnTimer: number };
    m.queue = [{ kind: "walker", lane: "road" }];
    m.spawnTimer = 1e9;
  }

  update(dt: number, _now: number, aim: Aim): void {
    if (this.phase === "loading" || this.paused) return;
    this.lastDt = dt;
    this.effects.reducedFlashing = this.ctx.settings.reducedFlashing;
    this.ambient.reducedFlashing = this.ctx.settings.reducedFlashing;
    this.camera.reducedMotion = this.ctx.settings.reducedMotion;
    if (this.ctx.quality.tier !== this.tier) {
      this.tier = this.ctx.quality.tier;
      this.stage.setQuality(this.ctx.quality);
      this.post.setQuality(this.ctx.quality);
    }
    this.time += dt;
    this.runSchedule();
    // The beam follows the aim; a lost hand leaves it where it was.
    if (aim.tracking) {
      this.aimAt.x = aim.x;
      this.aimAt.y = aim.y;
    }

    if (this.phase === "calibration") {
      if (aim.fired && !aim.offscreen) this.calibrationShot(aim.x, aim.y);
      this.updateWorld(dt, false);
      return;
    }

    if (this.phase === "playing") {
      if (this.reloadKey) {
        this.reloadKey = false;
        this.match.requestReload();
      }
      if (aim.fired && !aim.offscreen) this.fire(aim.x, aim.y);
      this.match.scarecrowLight(this.secretsWorld.scarecrowLit(), dt);
    } else {
      this.reloadKey = false;
    }
    this.match.update(dt, aim.offscreen);
    this.updateWorld(dt, true);
    this.updateHurt(dt);
    if (this.phase === "playing") this.pushReadouts(false);
    if (this.phase === "dying" || this.phase === "over") this.updateDeath(dt);
    this.hints.update(dt);
    this.syncHint();
  }

  private aimFlashlight(x: number, y: number): void {
    this.flashlight.aim(this.camera.camera, x, y, this.queries);
  }

  private updateWorld(dt: number, playing: boolean): void {
    const m = this.match;
    // The fog rolls in and out with the rules: thin in a breather, thicker as the night goes on.
    const target = playing ? m.fogDensity() : m.spec.fog * m.tuning.fogFactor * 0.85;
    this.fog += (target - this.fog) * Math.min(1, dt * 0.6);
    this.stage.setFog(this.fog);
    this.cast.sight = Math.sqrt(Math.log(4)) / Math.max(1e-4, this.fog);
    this.stage.u.uFogTime.value = this.time;
    this.volume.uFogTime.value = this.time;
    this.volume.uFogDensity.value = this.fog;
    this.volume.uFogGround.value = this.stage.u.uFogGround.value;
    this.volume.uFogFalloff.value = this.stage.u.uFogFalloff.value;

    this.camera.update(dt);
    if (!this.flashlight.dropped) this.aimFlashlight(this.aimAt.x, this.aimAt.y);
    this.flashlight.update(dt, this.camera.camera);
    this.flashlight.apply(this.stage.u, this.volume);
    this.cast.update(dt, this.time, m);
    this.secretsWorld.update(dt, 1 - Math.min(1, this.fog / 0.02));
    this.jars.update(dt);
    this.effects.update(dt);
    let nearest = Number.POSITIVE_INFINITY;
    for (const d of m.dead) if (d.alive) nearest = Math.min(nearest, Math.hypot(d.pos.x - m.eye.x, d.pos.z - m.eye.z));
    this.ambient.update(dt, nearest);
    const fov = this.camera.camera.fov;
    if (fov !== this.shownFov) {
      this.shownFov = fov;
      this.effects.setScale(this.bufferHeight, fov);
      this.eyeshine.setScale(this.bufferHeight, fov);
    }
    this.post.set("time", this.time);
  }

  render(): void {
    if (this.phase === "loading") return;
    syncBeamCamera(this.volume, this.camera.camera);
    this.post.render(this.lastDt);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.post) return;
    this.camera.setAspect(width / Math.max(1, height));
    this.post.setSize(width, height);
    this.bufferHeight = height * pixelRatio;
    this.frame(width, height);
    this.effects.setScale(this.bufferHeight, this.camera.camera.fov);
    this.eyeshine.setScale(this.bufferHeight, this.camera.camera.fov);
    this.shownFov = this.camera.camera.fov;
  }

  /** The aim check's framing (the road's own lens) and the tightest one that shows the whole fight, for this window's shape. */
  private frame(width: number, height: number): void {
    if (this.framed && this.framed.width === width && this.framed.height === height) return;
    this.framed = { width, height };
    const roadFov = this.assets.road.fov;
    const check = checkFraming(roadFov, width / Math.max(1, height));
    const play = playFraming(this.sights, width, height, roadFov, check.fov, (this.ctx.input ?? "hand") === "hand");
    this.framings = { check, play };
    const inPlay = this.phase === "playing" || this.phase === "dying" || this.phase === "over";
    this.camera.setFraming(inPlay ? play : check, 0);
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
    this.sound?.filter("hurt", 0);
    this.sound?.filter("slowmo", 0);
    this.post?.dispose();
    for (const p of Object.values(this.pools ?? {})) p.dispose();
    this.effects?.dispose();
    this.eyeshine?.dispose();
    this.queries?.dispose();
    this.stage?.dispose();
    if (this.previousToneMapping !== null) this.ctx.renderer.toneMapping = this.previousToneMapping;
  }

  // --- shooting ---------------------------------------------------------------------------

  /** Where the rifle's muzzle is: a little ahead of the lamp under it. */
  private muzzleAt(out: Vector3): Vector3 {
    return out.copy(this.flashlight.position).addScaledVector(this.flashlight.direction, 0.55).add(tmp2.set(0, 0.04, 0));
  }

  /** During the aim check the platform judges the shot; the world answers only with the rifle. */
  private calibrationShot(_x: number, _y: number): void {
    this.sound.play("night_rifle", { volume: 0.9 });
    this.sound.play("night_lever", { volume: 0.7, delay: 0.28 });
    this.flashlight.kick(this.ctx.settings.reducedMotion);
    this.effects.muzzle(this.muzzleAt(tmp), this.flashlight.direction, this.golden);
  }

  private fire(x: number, y: number): void {
    const result = this.match.trigger();
    if (result === "dry") {
      this.sound.play("night_dry");
      this.hints.setNeed(reloadHint(this.ctx.input));
      this.syncHint();
      return;
    }
    if (result !== "fired") return;
    this.sound.play("night_rifle", { volume: 1, rate: 0.97 + this.visualRandom() * 0.06 });
    if (this.match.rifle.rounds > 0) this.sound.play("night_lever", { volume: 0.75, delay: 0.24 });
    this.camera.kick(this.visualRandom);
    this.flashlight.kick(this.ctx.settings.reducedMotion);
    this.effects.muzzle(this.muzzleAt(tmp), this.flashlight.direction, this.golden);
    this.showRifle();
    const res = this.shooter.shoot(x, y);
    this.shotPoint.copy(res.point);
    this.shotKilled = false;
    this.match.resolveShot(res.target);
    const t = res.target;
    switch (t.kind) {
      case "dead":
        this.hud.hitMarker(x, y, this.shotKilled ? "kill" : res.part === "head" ? "headshot" : "hit");
        break;
      case "survivor":
        this.cast.survivorShot(t.survivor, res.point);
        break;
      case "secret":
        this.secretHit(t.shot.secret, res.point, res.normal, res.surface, res.scenery);
        break;
      case "scenery":
        this.impact(this.surfaceAt(res.surface, res.point), res.point, res.normal);
        break;
      default:
        break;
    }
  }

  /** A shot into the field behind the fence went through the corn. */
  private surfaceAt(surface: Surface, at: Vector3): Surface {
    if (surface === "dirt" && at.x < this.assets.road.eye.x - 6.6 && at.z < this.assets.road.eye.z - 5) return "plant";
    return surface;
  }

  private impact(surface: Surface, at: Vector3, normal: Vector3): void {
    const floor = this.queries.groundAt(at.x, at.z, at.y + 0.02);
    this.effects.impact(surface, at, normal, floor, surface !== "water" && surface !== "plant" && surface !== "cloth");
    this.sound.at(HIT_SOUND[surface], at, 1, 0.95 + this.visualRandom() * 0.1);
    if (surface === "metal" && this.visualRandom() < 0.35) this.sound.at("night_ricochet", at, 0.8, 1, 0.04);
  }

  private secretHit(id: string, at: Vector3, normal: Vector3, surface: Surface, scenery: boolean): void {
    switch (id) {
      case "sign":
        this.effects.glass(at, normal, 5, at.y - 3);
        break;
      case "scarecrow":
        this.secretsWorld.scarecrowShot(at);
        break;
      case "duck":
        this.effects.impact("water", at, normal, at.y);
        break;
      case "radio":
        this.effects.glass(at, normal, 6, at.y - 1);
        this.sound.at("night_hit_glass", at, 0.8);
        break;
      case "cat":
        if (scenery) this.impact(this.surfaceAt(surface, at), at, normal);
        break;
      case "drivein":
      case "moon":
      case "booth":
      default:
        break;
    }
  }

  // --- HUD helpers --------------------------------------------------------------------------

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
    this.hints.offer(id, tipText(id, this.ctx.input));
    this.syncHint();
  }

  private syncHint(): void {
    const text = this.hints.text;
    if (text === this.hintShown) return;
    this.hintShown = text;
    this.hud.hint(text);
  }

  private showRifle(): void {
    const r = this.match.rifle;
    this.hud.ammo(r.rounds, r.capacity, r.reloading, { kind: "magazine", action: r.reloading ? "open" : r.action });
  }

  private pushReadouts(force: boolean): void {
    const m = this.match;
    const left = m.remaining;
    const mult = m.scorer.multiplier;
    const key = `${m.wave}|${left}|${mult}`;
    if (!force && key === this.readoutKey) return;
    this.readoutKey = key;
    const total = Math.max(1, m.waveTotal);
    const list: Readout[] = [
      { label: "Wave", value: String(m.wave) },
      { label: "Dead", value: String(left), meter: m.phase === "breather" ? 0 : left / total },
      { label: "Streak", value: `×${mult}`, meter: (mult - 1) / 3, tone: mult >= 4 ? "warning" : "" },
    ];
    this.hud.readouts(list);
  }

  private updateHurt(dt: number): void {
    const hurt = this.match.health.hurt;
    const shown = this.hurtDisplay;
    if (hurt <= shown) this.hurtDisplay = shown + (hurt - shown) * Math.min(1, dt * 4);
    else this.hurtDisplay = this.effects.reducedFlashing ? shown + (hurt - shown) * Math.min(1, dt * 10) : hurt;
    const h = this.hurtDisplay;
    this.post.set("hurt", h);
    this.post.set("desaturate", Math.min(1, h * 0.65 + (this.phase === "dying" || this.phase === "over" ? Math.min(1, this.deathT / 2) : 0)));
    if (Math.abs(h - this.hurtShown) > 0.01) {
      this.hurtShown = h;
      this.hud.health(h);
    }
    if (Math.abs(h - this.hurtFilter) > 0.02) {
      this.hurtFilter = h;
      this.sound.filter("hurt", h);
    }
  }

  /**
   * The fall: the flashlight drops from your hands and rolls on the asphalt,
   * its beam swinging across the canopy; the dead close in out of focus;
   * black. A card - "The night took you on Wave 5." - then the results.
   */
  private updateDeath(dt: number): void {
    this.deathT += dt;
    const t = this.deathT;
    const reduced = this.ctx.settings.reducedMotion;
    this.camera.setDeath(reduced ? 0 : Math.min(1, t / 2.2), this.hurtSide);
    this.volume.uBlur.value = Math.min(1, t / 2.6);
    this.post.set("fade", Math.min(1, Math.max(0, (t - 2.4) / 1.6)));
    if (t > 1.2 && !this.card) {
      this.card = true;
      const f = this.match.felled;
      const by = f ? takenBy(f) : null;
      // The results' own words: "Fell on Wave 4", and what took you, "A walker at the barricade."
      this.hud.banner(`Fell on Wave ${this.match.wave}`, by ? `${by.charAt(0).toUpperCase()}${by.slice(1)}.` : undefined);
    }
    if (t > 5.2 && this.phase === "dying") {
      this.phase = "over";
      const results: Results = this.match.results();
      this.hud.gameOver({ ...results });
      this.sound.play("night_game_over");
    }
  }

  private later(seconds: number, run: () => void): void {
    this.schedule.push({ at: this.time + seconds, run });
  }

  private runSchedule(): void {
    for (let i = this.schedule.length - 1; i >= 0; i--) {
      const s = this.schedule[i] as Scheduled;
      if (this.time >= s.at) {
        this.schedule.splice(i, 1);
        s.run();
      }
    }
  }

  // --- what the cast notices ------------------------------------------------------------------

  private cameIntoView(d: Dead): void {
    if (d.kind === "walker") this.offerTip("night.head");
    if (d.kind === "crawler") this.offerTip("night.crawler");
    if (d.kind === "bloater") this.offerTip("night.bloater");
  }

  private mechanicSeen(d: Dead): void {
    const v = this.cast.view(d);
    v?.rig.play("roar", 0.15, false);
    this.later(1.9, () => {
      if (d.state === "approaching" && v) v.rig.play(v.gait, 0.3, true);
    });
    this.sound.at("night_mech_roar", d.pos, 1);
    this.sound.play("night_boss", { delay: 0.2 });
    tmp2.set(d.pos.x, d.pos.y + 2.4, d.pos.z);
    this.popupAt(tmp2, "The Mechanic", "gold");
  }

  // --- MatchListener ------------------------------------------------------------------------

  banner(title: string, subtitle?: string): void {
    this.hud.banner(title, subtitle);
  }

  waveStart(_wave: number, _spec: WaveSpec): void {
    this.ambient.steady = false;
    this.sound.play("night_wave_start");
    this.pushReadouts(true);
  }

  waveClear(_wave: number, b: WaveBonuses): void {
    this.sound.play("night_wave_clear");
    const lines: [string, "" | "gold"][] = [];
    if (b.accuracyPoints > 0) lines.push([`+${b.accuracyPoints} Accuracy ${Math.round(b.accuracy * 100)}%`, ""]);
    if (b.untouched > 0) lines.push([`+${b.untouched} Untouched`, "gold"]);
    if (b.cleanHands > 0) lines.push([`+${b.cleanHands} Clean Hands`, ""]);
    lines.forEach(([text, tone], i) => this.later(0.35 + i * 0.45, () => this.hud.popup(0.5, 0.56 + i * 0.05, text, tone)));
    this.hints.setNeed(null);
    this.hints.clearWord();
    this.syncHint();
  }

  /** The breather: the fog thins, the lamp steadies, a far bell counts the wave, the crickets start again. */
  breather(next: number): void {
    this.ambient.steady = true;
    this.hurtDisplay = 0;
    const strokes = Math.min(next, 5);
    for (let i = 0; i < strokes; i++) this.sound.play("night_bell", { volume: 0.8, distance: 900, pan: -0.35, delay: 0.5 + i * 1.05 });
    this.pushReadouts(true);
  }

  deadSpawn(d: Dead): void {
    this.cast.spawn(d);
  }
  deadEmerged(_d: Dead): void {}
  deadArrived(_d: Dead): void {}
  deadLunge(_d: Dead): void {}
  deadSwell(d: Dead): void {
    this.sound.at("night_groan", d.pos, 1, 0.7);
  }
  deadDown(_d: Dead): void {}

  deadStrike(d: Dead, _damage: number): void {
    this.cast.strike(d);
  }

  deadWound(d: Dead, part: HitPart): void {
    this.cast.wound(d, part, this.shotPoint);
  }

  maskOff(d: Dead, award: Award): void {
    this.cast.maskOff(d, this.shotPoint);
    tmp2.set(d.pos.x, d.pos.y + 2.3, d.pos.z);
    this.popupAt(tmp2, this.awardText(award), "gold");
  }

  deadDeath(d: Dead, cause: DeathCause, award: Award | null): void {
    const shot = cause === "head" || cause === "body" || cause === "limb";
    this.cast.death(d, cause, shot ? this.shotPoint : null);
    if (shot) this.shotKilled = true;
    if (!award) return;
    tmp2.set(d.pos.x, d.pos.y + (d.kind === "crawler" ? 0.8 : 2.0), d.pos.z);
    const special = award.labels.some((l) => l === "Headshot" || l === "The Mechanic" || l === "Long Shot");
    this.popupAt(tmp2, this.awardText(award), special ? "gold" : "");
    this.pushReadouts(false);
  }

  bloaterBurst(d: Dead, shot: boolean, caught: readonly Dead[], award: Award | null): void {
    this.cast.burst(d);
    if (!shot) {
      this.camera.rumble(0.8);
      return;
    }
    if (award && caught.length) {
      // Its own copy: the shared scratch vector will have moved on in a quarter second.
      const at = new Vector3(d.pos.x, d.pos.y + 2.4, d.pos.z);
      this.later(0.25, () => this.popupAt(at, this.awardText(award), "gold"));
    }
  }

  bodyCleared(d: Dead): void {
    this.cast.clear(d);
  }

  survivorAppear(s: Survivor): void {
    this.cast.survivorAppear(s);
  }

  survivorGone(s: Survivor): void {
    this.cast.survivorGone(s);
  }

  survivorShot(s: Survivor, award: Award): void {
    tmp2.set(s.pos.x, s.pos.y + 2.0, s.pos.z);
    this.popupAt(tmp2, this.awardText(award), "danger");
    this.hints.say(survivorWord(s.role), 2);
    this.syncHint();
  }

  playerHit(damage: number, direction: number, hurt: number, _by: Dead): void {
    this.hud.damage(direction, hurt);
    this.sound.play("night_hurt", { volume: Math.min(1, 0.6 + damage / 60), pan: Math.sin(direction) * 0.5 });
    this.camera.flinch(direction, Math.min(1.5, damage / 25));
    this.hurtSide = direction >= 0 ? -1 : 1;
  }

  playerDeath(): void {
    this.phase = "dying";
    this.hud.playerDown?.();
    this.deathT = 0;
    this.sound.play("night_death");
    this.sound.filter("slowmo", 0.6);
    this.hints.setQuiet(true);
    this.syncHint();
    this.flashlight.drop(this.hurtSide, this.visualRandom);
  }

  streakUp(multiplier: number): void {
    const semitones = multiplier >= 4 ? 7 : multiplier === 3 ? 4 : 0;
    this.sound.play("night_streak", { rate: Math.pow(2, semitones / 12) });
    this.pushReadouts(true);
  }

  score(value: number): void {
    this.hud.score(value);
  }

  reload(started: boolean): void {
    this.showRifle();
    if (started) {
      this.hints.setNeed(null);
      if (this.phase === "playing") this.hints.learned("night.reload");
      this.syncHint();
    }
  }

  roundsIn(count: number): void {
    for (let i = 0; i < count; i++) this.sound.play("night_round_in", { volume: 0.9, delay: i * 0.03 });
    this.showRifle();
  }

  chambered(): void {
    // After a shot the lever's sound came with it; finishing a reload, the lever is heard now.
    if (this.match.rifle.rounds === this.match.rifle.capacity) this.sound.play("night_lever", { volume: 0.6 });
    this.flashlight.nudge(this.ctx.settings.reducedMotion);
    this.showRifle();
  }

  signLetter(letter: SignLetter, eat: boolean): void {
    this.secretsWorld.letterOut(letter);
    if (eat) this.secretsWorld.eat();
  }

  signRelit(letters: readonly SignLetter[]): void {
    this.secretsWorld.relight(letters);
  }

  scarecrowTurn(): void {
    this.secretsWorld.scarecrowTurns();
  }

  scarecrowGone(): void {}

  boothRing(): void {
    this.secretsWorld.boothRing();
  }

  driveIn(): void {
    this.secretsWorld.driveIn();
  }

  moonShot(_shots: number, howl: "far" | "near" | null): void {
    this.secretsWorld.moonShot(howl);
  }

  catStartled(_startles: number): void {
    this.secretsWorld.catStartled();
  }

  radio(on: boolean): void {
    this.secretsWorld.radio(on);
  }

  duckSqueak(_squeaks: number): void {
    this.secretsWorld.duckSqueak();
  }

  secretFound(id: SecretId, name: string, found: number, total: number): void {
    const announce = () => {
      if (this.phase !== "playing") return;
      this.hud.secret(name, found, total);
      this.sound.play("night_secret", { delay: 0.3 });
    };
    // Let the show play before the toast: the scarecrow's turn, the phones, the howl.
    const wait: Partial<Record<SecretId, number>> = { scarecrow: 1.6, booth: 2.5, moon: 2.4, eat: 1.2, drivein: 1.5 };
    this.later(wait[id] ?? 0, announce);
  }

  // --- for the dev harness ----------------------------------------------------------------------

  get debug() {
    return {
      phase: () => this.phase,
      match: () => this.match,
      camera: () => this.camera.camera,
      real: () => this.assets?.real,
      framing: () => ({ ...this.framings, fov: this.camera.camera.fov }),
      setFraming: (which: "check" | "play") => {
        if (this.framings) this.camera.setFraming(this.framings[which], 0);
      },
      setImmortal: (on: boolean) => {
        this.match.health.immortal = on;
      },
      /** Hold the wave's own dead in the fog (for staging screenshots). */
      hold: () => this.hold(),
      /** End the wave now: the breather follows on the next frame (for the drive-in, the bell, the fog thinning). */
      breather: () => {
        const m = this.match as unknown as { queue: unknown[]; dead: Dead[] };
        m.queue = [];
        for (const d of m.dead) if (d.alive) d.die("head", this.match.time, 10);
        for (const d of m.dead) d.state = "dead";
      },
      /** Hurt the player (for the hurt state's pictures), as if from straight ahead. */
      hurt: (amount: number) => {
        this.match.health.hit(amount);
        this.playerHit(amount, 0, this.match.health.hurt, this.match.dead[0] as Dead);
      },
      /** Send one of the dead now, on a lane, `along` metres down it (or, negative, that far short of its end). Returns its id. */
      send: (kind: DeadKind = "walker", lane: LaneId = "road", along = 0) => {
        const l = this.match.plan.lanes.find((x) => x.id === lane) ?? this.match.plan.lanes[0];
        if (!l) return -1;
        const m = this.match as unknown as { nextId: number };
        const d = new DeadClass(m.nextId++, kind, l, offsetPath(l, 0), paceOf(kind, "walk.shamble", 1.3), "walk.shamble");
        if (kind === "mechanic") d.mask = this.match.tuning.maskHits;
        d.spawn(this.match);
        if (along !== 0) d.placeAt(along > 0 ? along : d.pathLength + along);
        this.match.dead.push(d);
        this.cast.spawn(d);
        return d.id;
      },
      /** Viewport positions of what can be shot now. */
      targets: () => this.debugTargets(),
      /** Where the secrets are on screen. */
      secrets: () => this.debugSecrets(),
      /** The beam: where it is and where it points. */
      beam: () => ({ position: this.flashlight.position.toArray(), direction: this.flashlight.direction.toArray() }),
      fog: () => this.fog,
    };
  }

  private debugTargets() {
    const out: { kind: string; id: number; state: string; x: number; y: number; hx: number; hy: number; distance: number }[] = [];
    const cam = this.camera.camera.position;
    const chest = new Vector3();
    for (const v of this.cast.dead) {
      if (!v.d.shootable) continue;
      const j = v.rig.updateJoints();
      chest.copy(j.hips).lerp(j.neck, 0.6);
      const distance = chest.distanceTo(cam);
      const body = this.project(chest);
      const head = this.project(j.head);
      if (!body || !head) continue;
      out.push({ kind: v.d.kind, id: v.d.id, state: v.d.state, x: body.x, y: body.y, hx: head.x, hy: head.y, distance });
    }
    return out;
  }

  private debugSecrets() {
    const s = this.assets.road.secrets;
    const out: Record<string, { x: number; y: number } | null> = {};
    const box = new Box3();
    const at = (name: string, o: import("three").Object3D | null) => {
      out[name] = o ? this.project(box.setFromObject(o).getCenter(new Vector3())) : null;
    };
    for (const [l, node] of s.sign) at(`sign.${l}`, node);
    at("moon", s.moonDisc);
    at("booth", s.boothLight);
    at("radio", s.radio);
    at("duck", s.duck);
    at("scarecrow", s.scarecrow);
    at("drivein", s.driveInLamp);
    const cat = this.secretsWorld.catCenter();
    out["cat"] = cat ? this.project(cat.clone()) : null;
    return out;
  }
}

