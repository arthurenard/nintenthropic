import { Color, PCFShadowMap, SRGBColorSpace, Vector3, type Mesh, type ToneMapping } from "three";
import type { Aim, CalibrationStage, Game, GameContext, HudSink, Readout } from "../../engine/types";
import { announceGolden, awardText, HintShown, HurtShown, popupAt, showBonuses, streakReadout, viewportOf, type PopupTone } from "../../engine/hud";
import { breathe, CalibrationProxy, Schedule } from "../../engine/round";
import { Bandit as BanditClass, type Bandit } from "./rules/bandit";
import type { Dynamite } from "./rules/dynamite";
import { felledCause } from "./rules/felled";
import { Match, type MatchListener, type Results } from "./rules/match";
import { loadSoundPack } from "../../audio/index";
import type { StreetSpace } from "../../audio/routing";
import { mulberry32 } from "../../engine/rules/rng";
import { streakRate } from "../../engine/rules/streak";
import type { Award, WaveBonuses } from "./rules/scoring";
import { isHighNoon, type SecretId } from "./rules/secrets";
import type { Townsperson } from "./rules/townsfolk";
import type { Cover, HitPart } from "./rules/types";
import type { WaveSpec } from "./rules/waves";
import { Ambient } from "./world/ambient";
import { loadAssets, type HighNoonAssets } from "./world/assets";
import { BottleStage } from "./world/bottles";
import { Cast } from "./world/cast";
import { checkCovers, COVER_SHIFTS, fallPaths, readySpots, shiftCovers, unblockCovers, type CoverReport } from "./world/coverCheck";
import { RigPool } from "../../engine/world/character";
import { warmUp } from "../../engine/world/scene";
import { highNoonTemplate, streetRim } from "./world/rigs";
import { DynamiteView } from "./world/dynamiteView";
import { Hammer } from "../../engine/rules/hammer";
import { HintLine, reloadHint } from "../../engine/rules/hints";
import { bossWoundWord, chickenWord, innocentWord, UNSPORTING } from "./hints";
import { LEARNED_BY_DOING, tipText, type TipId } from "./tips";
import { Effects } from "./world/effects";
import { checkFraming, chromeKeepOut, fitFraming, type Framing, type Sight } from "../../engine/world/framing";
import { PlayerCamera } from "../../engine/world/playerCamera";
import { ScreenFlash } from "../../engine/world/flash";
import { PostFX } from "../../engine/world/post";
import { GOLDEN_HOUR } from "./world/grade";
import { TownQueries } from "./world/queries";
import { SecretsWorld } from "./world/secretsWorld";
import { Shooter } from "./world/shooting";
import { Sound } from "../../engine/world/sound";
import { Stage } from "./world/stage";
import type { Surface } from "./world/town";

export interface HighNoonOptions {
  /** Start on this wave (the dev harness's ?wave=). */
  startWave?: number;
  /** Hits hurt but never kill (screenshots, performance runs). */
  immortal?: boolean;
  /** Force High Noon for real on or off, whatever the clock says. */
  noon?: boolean;
  /** Load the art from this folder instead of assets/western/ (the harness's asset tests). */
  assetBase?: string;
}

/** How long the view takes to close in on the street when a round begins. */
const FRAMING_EASE = 1.4;
const HIT_SOUND: Record<Surface, string> = {
  wood: "hit_wood",
  dirt: "hit_dirt",
  glass: "hit_glass",
  metal: "hit_metal",
  stone: "hit_dirt",
  cloth: "hit_dirt",
  water: "hit_water",
};

const tmp = new Vector3();
const tmp2 = new Vector3();

/**
 * High Noon: the Game the app hosts. It owns the world (stage, cast, effects,
 * secrets, ambience, bottles) and the rules (Match), turns the player's aim
 * into shots, and answers the rules' events with pictures, sounds and HUD.
 */
export class HighNoon implements Game, MatchListener {
  readonly id = "western";
  readonly title = "High Noon";
  readonly calibration: CalibrationStage;
  /** The bottles, once they exist; and the town put back when the aim check comes round again after a game. */
  private readonly calibrationProxy = new CalibrationProxy({ one: "bottle", many: "bottles" });

  private ctx!: GameContext;
  private hud!: HudSink;
  private assets!: HighNoonAssets;
  private stage!: Stage;
  private camera!: PlayerCamera;
  private sound!: Sound;
  private queries!: TownQueries;
  private effects!: Effects;
  private cast!: Cast;
  private shooter!: Shooter;
  private secretsWorld!: SecretsWorld;
  private ambient!: Ambient;
  private bottles!: BottleStage;
  private dynamite!: DynamiteView;
  private post!: PostFX;
  private match!: Match;
  private pools!: { bandit: RigPool; boss: RigPool; townsfolk: RigPool; chicken: RigPool };

  private phase: "loading" | "calibration" | "playing" | "dying" | "over" = "loading";
  private paused = false;
  private time = 0;
  private lastDt = 1 / 60;
  private timeScale = 1;
  private deathT = 0;
  private sepia = 0;
  private readonly flash = new ScreenFlash();
  private readonly hurt = new HurtShown();
  private readoutKey = "";
  /** The hint line: the reload when it is needed, a word after a mistake, one-time tips. */
  private hints = new HintLine(new Set(), LEARNED_BY_DOING);
  private readonly hintShown = new HintShown();
  private readonly hammer = new Hammer();
  private golden = false;
  private tier: GameContext["quality"]["tier"] = "high";
  private noon = false;
  private reloadKey = false;
  private tombstone = false;
  /** Which way the view tips at death: away from the last shot that hit. */
  private hurtSide = 1;
  private readonly schedule = new Schedule(() => this.time);
  private coverReport: CoverReport | null = null;
  private readonly shotPoint = new Vector3();
  private shotKilled = false;
  private visualRandom = mulberry32(7);
  private previousToneMapping: ToneMapping | null = null;
  /** What the play framing must show, in the town camera's space (see framing.ts). */
  private sights: Sight[] = [];
  private framings: { check: Framing; play: Framing } | null = null;
  /** The window size the framings were fitted to. */
  private framed: { width: number; height: number } | null = null;
  private bufferHeight = 720;
  private shownFov = 0;
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.key === "r" || e.key === "R") && !e.repeat) this.reloadKey = true;
  };

  constructor(private readonly options: HighNoonOptions = {}) {
    this.calibration = this.calibrationProxy;
  }

  // --- Game ---------------------------------------------------------------------------

  async load(ctx: GameContext, onProgress: (fraction: number) => void): Promise<void> {
    this.ctx = ctx;
    this.hud = ctx.hud;
    this.noon = this.options.noon ?? isHighNoon(ctx.clock());
    this.golden = ctx.settings.unlocks.has("golden");
    const renderer = ctx.renderer;
    this.previousToneMapping = renderer.toneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.type = PCFShadowMap;

    // The sound pack synthesises (in a worker) while the art loads; both
    // report into one bar, and neither leaves work for the first frames.
    let artDone = 0;
    let soundDone = 0;
    const report = () => onProgress(Math.min(0.97, artDone * 0.7 + soundDone * 0.25));
    const sounds = loadSoundPack(ctx.audio, "western", (f) => {
      soundDone = f;
      report();
    }).catch((err) => console.warn("High Noon: the sound pack did not load", err));
    this.assets = await loadAssets(
      ctx,
      (f) => {
        artDone = f;
        report();
      },
      this.noon,
      this.options.assetBase ?? null,
    );
    const town = this.assets.town;
    this.stage = new Stage(renderer, town, this.assets.sky, this.assets.fog, this.noon);
    this.stage.setQuality(ctx.quality);
    this.camera = new PlayerCamera(town.eye, town.eyeQuaternion, town.fov);
    this.camera.reducedMotion = ctx.settings.reducedMotion;
    this.camera.still = true;
    this.sound = new Sound(ctx.audio, this.camera.camera);
    await breathe();
    this.queries = new TownQueries(town);
    // Only covers the player can actually see a man in (see coverCheck.ts).
    const moved = shiftCovers(town.covers, this.queries, town.eye);
    const covers = checkCovers(moved.covers, this.queries, town.eye);
    if (moved.shifted.length < Object.keys(COVER_SHIFTS).length) {
      console.info(`High Noon: some of the game's cover shifts no longer land on a floor and were not made (made: ${moved.shifted.join(", ") || "none"}).`);
    }
    if (covers.moved.length || covers.dropped.length) {
      console.info(`High Noon: covers moved into view: ${covers.moved.join(", ") || "none"}; left out, not visible from the eye: ${covers.dropped.join(", ") || "none"}.`);
    }
    this.coverReport = covers;
    // No post in front of the middle of a man; and every cover's edge, from
    // which he comes out without gliding through a wall.
    const clear = unblockCovers(covers.kept, this.queries, town.eye);
    if (clear.moved.length) console.info(`High Noon: covers stepped clear of a post: ${clear.moved.join(", ")}.`);
    await breathe();
    const ready = readySpots(clear.covers, this.queries, town.eye);
    await breathe();
    // Which way a man shot up high goes over, and whether there is room to
    // fall at all (on a deep balcony he goes down on its boards instead).
    const falls = fallPaths(ready, this.queries, town.eye);
    town.covers = ready.map((c) => {
      const f = falls.get(c.id);
      return f ? { ...c, ledge: f.ledge } : c;
    });
    await breathe();
    this.effects = new Effects(this.stage.fxRoot, ctx.quality);
    this.effects.setRandom(this.visualRandom);

    // The street's rim light, to the hour: the white glare of noon, or the
    // golden hour's warm sky and dust.
    const rim = streetRim(this.noon);
    const banditT = highNoonTemplate("bandit", this.assets.bandit, rim);
    const bossT = highNoonTemplate("boss", this.assets.boss, rim, this.assets.bandit.animations);
    const townsT = highNoonTemplate("townsfolk", this.assets.townsfolk, rim, this.assets.bandit.animations);
    const chickenT = highNoonTemplate("chicken", this.assets.chicken, rim);
    const parent = this.stage.dynamic;
    this.pools = {
      bandit: new RigPool(banditT, 12, parent),
      boss: new RigPool(bossT, 1, parent),
      townsfolk: new RigPool(townsT, 4, parent),
      chicken: new RigPool(chickenT, 1, parent),
    };
    await breathe();
    this.secretsWorld = new SecretsWorld(town, this.effects, this.sound, this.queries, parent);
    this.sights = this.framingSights();
    const toSun = this.stage.sunDirection.clone().negate();
    this.cast = new Cast(this.pools, parent, this.effects, this.sound, this.queries, town.eye, toSun, this.visualRandom, {
      popup: (at, text, tone) => this.popupAt(at, text, tone),
      bellSwing: () => this.secretsWorld.bellHit(1),
    });
    this.cast.falls = falls;
    this.ambient = new Ambient(town, parent, this.pools.chicken, this.effects, this.sound, this.visualRandom, ctx.quality);
    this.bottles = new BottleStage(town, parent, this.camera.camera, this.effects, this.sound, this.queries);
    this.calibrationProxy.target = this.bottles;
    this.calibrationProxy.onUse = () => {
      if (this.phase === "over" || this.phase === "dying") this.rearm();
    };
    // After a game (Play Again, Adjust Aim) the whole street is put back; in
    // the middle of a check that ran out of bottles, only the bottles are.
    this.calibrationProxy.onBegin = () => {
      if (this.phase === "calibration") this.bottles.reset();
      else if (this.phase !== "loading") this.rearm();
    };
    this.newMatch();
    this.dynamite = new DynamiteView(parent, () => this.match.sticks, this.effects, town.eye);
    this.shooter = new Shooter(this.camera.camera, this.queries, town, this.cast, {
      sticks: () => this.match.sticks,
      tumbleweeds: () => this.ambient.tumbleweeds(),
      chicken: () => this.ambient.chickenCenterOrNull(),
      bellCenter: () => this.secretsWorld.bellCenter(),
      vaneCenter: () => this.secretsWorld.vaneCenter(),
    }, ctx.settings);
    this.post = new PostFX(renderer, this.stage.scene, this.camera.camera, ctx.quality, { grade: GOLDEN_HOUR });
    this.post.set("noon", this.noon ? 1 : 0);
    this.tier = ctx.quality.tier;
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720, renderer.getPixelRatio());
    await breathe();
    await warmUp(renderer, this.stage.scene, this.camera.camera, () => this.post.render(0));
    this.tuneEcho();
    await sounds;
    window.addEventListener("keydown", this.onKey);
    this.sound.loop("wind", "wind", { volume: 0.35 });
    this.phase = "calibration";
    onProgress(1);
  }

  /**
   * Tell the audio engine how wide and deep this street really is, so its
   * slap-back echoes come off the town's actual facades.
   */
  private tuneEcho(): void {
    const engine = this.ctx.audio as { setSpace?: (space: Partial<StreetSpace>) => void };
    if (typeof engine.setSpace !== "function") return;
    const eye = this.assets.town.eye;
    const hit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
    // The side walls are measured a dozen metres down the street, where the facades begin.
    const from = eye.clone().add(new Vector3(0, 0, -12));
    const reach = (o: Vector3, x: number, z: number, fallback: number) => this.queries.cast(o, new Vector3(x, 0, z), 200, hit)?.distance ?? fallback;
    engine.setSpace({ left: reach(from, -1, 0, 6), right: reach(from, 1, 0, 7), behind: reach(eye, 0, 1, 11), depth: reach(eye, 0, -1, 62) });
  }

  private newMatch(): void {
    const town = this.assets.town;
    this.match = new Match({
      random: this.ctx.random,
      covers: town.covers,
      listener: this,
      eye: { x: town.eye.x, y: town.eye.y, z: town.eye.z },
      yaw: this.camera.yaw,
      difficulty: this.ctx.settings.difficulty,
    });
    this.match.health.immortal = this.options.immortal === true;
  }

  /**
   * Back to the state after load, for another game on this instance: a fresh
   * match, the street swept (bodies, holes, the secrets' mischief), the
   * bottles standing again, the picture and the sound unmuffled.
   */
  private rearm(): void {
    this.quietFuses();
    this.cast.reset();
    this.ambient.reset();
    this.effects.clearAll();
    this.secretsWorld.reset();
    // The windows shot out last game are glazed again.
    for (const pane of this.assets.town.glass.values()) pane.visible = true;
    this.newMatch();
    this.bottles.reset();
    this.schedule.clear();
    this.camera.still = true;
    this.camera.setDeath(0, 1);
    if (this.framings) this.camera.setFraming(this.framings.check, 0);
    // Apply it now: the aim check is about to project the bottles through it.
    this.camera.update(0);
    this.timeScale = 1;
    this.sepia = 0;
    this.deathT = 0;
    this.tombstone = false;
    this.hurt.value = 0;
    this.flash.reset();
    this.post.set("sepia", 0);
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
    // Play Again straight into play, without an aim check in between.
    if (this.phase !== "calibration") this.rearm();
    // A fresh match either way: the difficulty is read here, so a change
    // made since the last round (or during the aim check) takes effect now.
    else this.newMatch();
    this.bottles.done();
    this.camera.still = false;
    this.camera.setDeath(0, 1);
    // The warm-up over, the view closes in on the street as the gang rides in.
    if (this.framings) this.camera.setFraming(this.framings.play, this.ctx.settings.reducedMotion ? 0 : FRAMING_EASE);
    this.phase = "playing";
    this.time = 0;
    this.timeScale = 1;
    this.sepia = 0;
    this.deathT = 0;
    this.tombstone = false;
    this.hurt.retell();
    this.readoutKey = "";
    this.sound.filter("slowmo", 0);
    this.sound.filter("hurt", 0);
    const wave = Math.max(1, Math.floor(this.options.startWave ?? 1));
    this.hud.score(0);
    this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, false);
    this.hud.health(0);
    this.match.start({ wave, duel: this.noon && wave === 1 });
    this.ambient.running = true;
    // The tips this player has seen, as the page keeps them now.
    this.hints = new HintLine(this.ctx.settings.tipsSeen, LEARNED_BY_DOING);
    this.hints.setQuiet(false);
    // How to reload, at the start of every game until they have done it.
    this.offerTip("western.reload");
    // Read each round, as the page's HUD is: unlocked since this game loaded, it is gold from now.
    this.golden = this.ctx.settings.unlocks.has("golden");
    if (this.golden) announceGolden(this.hud, this.sound, this.schedule, "golden_unlock", "Golden Revolver");
    this.pushReadouts(true);
  }

  update(dt: number, _now: number, aim: Aim): void {
    if (this.phase === "loading" || this.paused) return;
    this.lastDt = dt;
    // Read every frame: changed in the pause menu's Settings, they hold from Resume.
    this.effects.reducedFlashing = this.ctx.settings.reducedFlashing;
    this.camera.reducedMotion = this.ctx.settings.reducedMotion;
    // The host may change the tier mid-game (its dynamic resolution gave up).
    if (this.ctx.quality.tier !== this.tier) {
      this.tier = this.ctx.quality.tier;
      this.stage.setQuality(this.ctx.quality);
      this.post.setQuality(this.ctx.quality);
    }
    const scale = this.timeScale;
    const wdt = dt * scale;
    this.time += wdt;
    this.schedule.run();

    if (this.phase === "calibration") {
      if (aim.fired && !aim.offscreen) this.calibrationShot(aim.x, aim.y);
      this.updateWorld(wdt, dt, false);
      return;
    }

    if (this.phase === "playing") {
      if (this.reloadKey) {
        this.reloadKey = false;
        this.match.requestReload();
      }
      if (aim.fired && !aim.offscreen) this.fire(aim.x, aim.y);
    } else {
      this.reloadKey = false;
    }
    this.match.update(wdt, aim.offscreen);
    this.cockHammer(dt, aim);
    this.updateWorld(wdt, dt, true);
    this.updateHurt(dt);
    if (this.phase === "playing") this.pushReadouts(false);
    if (this.phase === "dying" || this.phase === "over") this.updateDeath(dt);
    this.hints.update(dt);
    this.syncHint();
  }

  /**
   * With the hand, the thumb coming back up after a shot cocks the hammer:
   * a soft click, lighter than a bandit's, from the player's own gun.
   */
  private cockHammer(dt: number, aim: Aim): void {
    const r = this.match.revolver;
    const live = this.phase === "playing" && (this.ctx.input ?? "hand") === "hand";
    if (this.hammer.update(dt, { armed: aim.armed, fired: aim.fired, live, reloading: r.reloading, rounds: r.rounds })) {
      this.sound.play("revolver_cock", { volume: 0.3, rate: 1.25 });
    }
  }

  private updateWorld(wdt: number, realDt: number, playing: boolean): void {
    this.cast.update(wdt, this.time);
    this.dynamite.update(wdt);
    this.secretsWorld.update(wdt);
    this.ambient.update(wdt, playing || this.phase === "calibration");
    this.bottles.update(wdt);
    this.effects.update(wdt);
    this.camera.update(realDt);
    const fov = this.camera.camera.fov;
    if (fov !== this.shownFov) {
      // Particles are sized in metres through the lens: they follow the zoom.
      this.shownFov = fov;
      this.effects.setScale(this.bufferHeight, fov);
    }
    this.post.set("flash", this.flash.update(realDt));
    this.post.set("time", this.time);
  }

  render(): void {
    if (this.phase === "loading") return;
    this.post.render(this.lastDt);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.post) return;
    this.camera.setAspect(width / Math.max(1, height));
    this.post.setSize(width, height);
    this.bufferHeight = height * pixelRatio;
    this.frame(width, height);
    this.effects.setScale(this.bufferHeight, this.camera.camera.fov);
    this.shownFov = this.camera.camera.fov;
  }

  /**
   * The two framings for this window's shape: the town's own for the aim
   * check, and the tightest one that shows the whole fight for play. A
   * resize jumps straight to the one in force.
   */
  private frame(width: number, height: number): void {
    // The host resizes on a change of pixel ratio too (dynamic resolution):
    // the same window, the same framing, and the view easing in is left be.
    if (this.framed && this.framed.width === width && this.framed.height === height) return;
    this.framed = { width, height };
    const aspect = width / Math.max(1, height);
    const townFov = this.assets.town.fov;
    const check = checkFraming(townFov, aspect);
    const play = fitFraming(this.sights, aspect, {
      minFov: 22,
      maxFov: Math.max(townFov, check.fov),
      // Up to a few degrees above the art's own pitch: the street's horizon
      // settles a little below the middle, and no more sky than that.
      minPitch: (-1 * Math.PI) / 180,
      maxPitch: (6 * Math.PI) / 180,
      preferPitch: (4 * Math.PI) / 180,
      slack: 1,
      marginX: 0.02,
      marginY: 0.02,
      keepOut: chromeKeepOut(width, height, (this.ctx.input ?? "hand") === "hand"),
    });
    this.framings = { check, play };
    const inPlay = this.phase === "playing" || this.phase === "dying" || this.phase === "over";
    this.camera.setFraming(inPlay ? play : check, 0);
  }

  /**
   * Every place the fight happens, as points the play framing must show: the
   * head and chest of a man at each cover (clear of the chrome, arms and lean
   * included), his knees at street level, and the secrets (on screen, if not
   * necessarily clear).
   */
  private framingSights(): Sight[] {
    const town = this.assets.town;
    const eye = town.eye;
    const toCamera = town.eyeQuaternion.clone().invert();
    const out: Sight[] = [];
    const v = new Vector3();
    const add = (x: number, y: number, z: number, clear: boolean, margin?: number) => {
      v.set(x, y, z).sub(eye).applyQuaternion(toCamera);
      out.push(margin === undefined ? { x: v.x, y: v.y, z: v.z, clear } : { x: v.x, y: v.y, z: v.z, clear, margin });
    };
    for (const c of town.covers) {
      const e = c.exposed;
      const dx = eye.x - e.x;
      const dz = eye.z - e.z;
      const len = Math.hypot(dx, dz) || 1;
      // Across his shoulders, as the player sees him.
      const sx = -dz / len;
      const sz = dx / len;
      for (const s of [-1, 1]) {
        add(e.x + sx * 0.3 * s, e.y + 1.95, e.z + sz * 0.3 * s, true);
        add(e.x + sx * 0.45 * s, e.y + 1.3, e.z + sz * 0.45 * s, true);
      }
      if (c.level === 0) add(e.x, e.y + 0.5, e.z, false);
    }
    const s = town.secrets;
    const secrets = [
      this.secretsWorld.bellCenter(),
      this.secretsWorld.vaneCenter(),
      s.waterTower?.getWorldPosition(new Vector3()) ?? null,
      s.poster?.getWorldPosition(new Vector3()) ?? null,
    ];
    // A secret only has to be in the picture: its centre may sit near an edge.
    for (const p of secrets) if (p) add(p.x, p.y, p.z, false, 0.005);
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
    if (this.phase === "loading" && !this.stage) return;
    this.sound?.stopAll();
    this.sound?.filter("hurt", 0);
    this.sound?.filter("slowmo", 0);
    this.post?.dispose();
    for (const p of Object.values(this.pools ?? {})) p.dispose();
    this.effects?.dispose();
    this.queries?.dispose();
    this.stage?.dispose();
    if (this.previousToneMapping !== null) this.ctx.renderer.toneMapping = this.previousToneMapping;
  }

  // --- shooting ---------------------------------------------------------------------------

  /** During the aim check the platform judges the shot; the world only answers with gun and smoke. */
  private calibrationShot(x: number, y: number): void {
    this.sound.play("revolver_shot", { volume: 0.9 });
    this.puff(x, y);
  }

  private puff(x: number, y: number): void {
    const cam = this.camera.camera;
    tmp.set(x * 2 - 1, -(y * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
    tmp2.copy(cam.position).addScaledVector(tmp, 1.3);
    tmp2.y -= 0.04;
    this.effects.playerPuff(tmp2, this.golden);
  }

  private fire(x: number, y: number): void {
    const result = this.match.trigger();
    if (result === "dry") {
      this.sound.play("revolver_dry");
      // A state, not a lesson: every time the cylinder is found empty.
      this.hints.setNeed(reloadHint(this.ctx.input));
      this.syncHint();
      return;
    }
    if (result !== "fired") return;
    this.sound.play("revolver_shot", { volume: 1, rate: 0.97 + this.visualRandom() * 0.06 });
    this.camera.kick(this.visualRandom);
    this.puff(x, y);
    if (this.golden) {
      tmp.set(x * 2 - 1, -(y * 2 - 1), 0.5).unproject(this.camera.camera).sub(this.camera.camera.position).normalize();
      tmp2.copy(this.camera.camera.position).addScaledVector(tmp, 0.9);
      this.effects.flashLight(tmp2, GOLD_LIGHT, 18, 5, 0.08);
    }
    this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, false);
    const res = this.shooter.shoot(x, y);
    this.shotPoint.copy(res.point);
    this.shotKilled = false;
    for (const pane of res.panes) this.shatter(pane);
    this.match.resolveShot(res.target);
    const t = res.target;
    switch (t.kind) {
      case "bandit":
        this.hud.hitMarker(x, y, this.shotKilled ? "kill" : res.part === "head" ? "headshot" : "hit");
        break;
      case "dynamite":
        this.hud.hitMarker(x, y, "kill");
        break;
      case "townsfolk":
        this.cast.townsShot(t.person, res.point);
        break;
      case "tumbleweed":
        this.ambient.shootTumbleweed(res.tumbleweed);
        break;
      case "chicken":
        this.ambient.startleChicken();
        if (res.hitTown) this.impact(res.surface, res.point, res.normal, true);
        break;
      case "secret":
        this.secretHit(t.secret, res.point, res.normal, res.note);
        break;
      case "scenery":
        this.impact(res.surface, res.point, res.normal, true);
        break;
      default:
        break;
    }
  }

  private impact(surface: Surface, at: Vector3, normal: Vector3, hole: boolean): void {
    const floor = this.queries.groundAt(at.x, at.z, at.y + 0.02);
    this.effects.impact(surface, at, normal, floor, hole && surface !== "water" && surface !== "cloth" && surface !== "dirt");
    this.sound.at(HIT_SOUND[surface], at, 1, 0.95 + this.visualRandom() * 0.1);
    if ((surface === "metal" || surface === "stone") && this.visualRandom() < 0.4) this.sound.at("ricochet", at, 0.8, 1, 0.04);
    if (surface === "wood" && this.visualRandom() < 0.3) this.sound.at("wood_splinter", at, 0.6);
  }

  private shatter(pane: Mesh): void {
    if (!pane.visible) return;
    pane.visible = false;
    pane.updateMatrixWorld();
    const params = (pane.geometry as { parameters?: { width?: number; height?: number } }).parameters;
    const w = params?.width ?? 1;
    const h = params?.height ?? 1;
    const center = pane.getWorldPosition(new Vector3());
    const normal = new Vector3(0, 0, 1).transformDirection(pane.matrixWorld);
    if (normal.dot(tmp.copy(this.camera.camera.position).sub(center)) < 0) normal.negate();
    const right = new Vector3(1, 0, 0).transformDirection(pane.matrixWorld);
    // Shards fall mostly inward (the bullet's way) and some out onto the boardwalk.
    normal.negate();
    const floor = this.queries.groundAt(center.x - normal.x * 0.6, center.z - normal.z * 0.6, center.y);
    this.effects.pane(center, normal, right, w, h, floor);
    this.effects.glass(this.shotPoint, normal.negate(), GLASS_COLOR, 8, floor);
    this.sound.at("glass_break", center, 1);
  }

  private secretHit(id: SecretId, at: Vector3, normal: Vector3, note: number): void {
    switch (id) {
      case "bell":
        this.secretsWorld.bellHit(1);
        this.effects.impact("metal", at, normal, at.y - 2, false);
        break;
      case "vane":
        this.secretsWorld.vaneHit();
        this.effects.impact("metal", at, normal, at.y - 2, false);
        break;
      case "water_tower":
        this.secretsWorld.towerHit(at, normal);
        this.effects.impact("wood", at, normal, 0, false);
        break;
      case "piano":
        this.secretsWorld.pianoNote(note);
        break;
      case "poster":
        this.secretsWorld.posterHit();
        this.effects.impact("cloth", at, normal, 0, false);
        break;
      default:
        break;
    }
  }

  // --- HUD helpers --------------------------------------------------------------------------

  private project(at: Vector3): { x: number; y: number } | null {
    return viewportOf(this.camera.camera, at);
  }

  private popupAt(at: Vector3, text: string, tone: PopupTone = ""): void {
    popupAt(this.hud, this.camera.camera, at, text, tone);
  }

  /** A one-time tip's moment has come (see tips.ts): shown if this player has not had it. */
  private offerTip(id: TipId): void {
    if (this.phase !== "playing") return;
    this.hints.offer(id, tipText(id, this.ctx.input));
    this.syncHint();
  }

  /** Tell the HUD what the hint line shows, when it changes. */
  private syncHint(): void {
    this.hintShown.tell(this.hud, this.hints);
  }

  private pushReadouts(force: boolean): void {
    const m = this.match;
    const left = m.remaining;
    const mult = m.scorer.multiplier;
    const key = `${m.wave}|${left}|${mult}`;
    if (!force && key === this.readoutKey) return;
    this.readoutKey = key;
    const list: Readout[] = [
      { label: "Wave", value: String(m.wave) },
      { label: "Gang", value: String(left), meter: m.spec.bandits + (m.spec.boss ? 1 : 0) > 0 ? left / (m.spec.bandits + (m.spec.boss ? 1 : 0)) : 0 },
      streakReadout(mult),
    ];
    this.hud.readouts(list);
  }

  private updateHurt(dt: number): void {
    const h = this.hurt.ease(this.match.health.hurt, dt, this.effects.reducedFlashing);
    this.post.set("hurt", h);
    this.post.set("desaturate", Math.min(1, h * 0.6 + this.sepia));
    // (The heartbeat comes with the "hurt" filter: the audio engine races it with the damage.)
    this.hurt.tell(this.hud, this.sound);
  }

  private updateDeath(dt: number): void {
    this.deathT += dt;
    const t = this.deathT;
    this.timeScale = Math.max(0.22, 1 - t / 0.35);
    this.sepia = Math.min(1, t / 1.8);
    this.post.set("sepia", this.sepia);
    this.post.set("exposure", 1 - Math.min(0.12, t * 0.05));
    this.camera.setDeath(this.ctx.settings.reducedMotion ? 0 : Math.min(1, t / 2.4), this.hurtSide);
    if (t > 2.0 && !this.tombstone) {
      this.tombstone = true;
      // The results' own words: "Fell on Wave 4", and what did it, "A rifleman on the saloon roof."
      const f = this.match.felled;
      this.hud.banner(`Fell on Wave ${this.match.wave}`, f ? felledCause(f) : undefined);
    }
    if (t > 5.2 && this.phase === "dying") {
      this.phase = "over";
      // A stick still in the air goes out quietly: the world stops drawing
      // under the card, and its fizz would go on under it for ever, as would
      // a tumbleweed's roll and the water tower's trickle. The wind blows on.
      this.match.snuffSticks();
      this.quietFuses();
      this.ambient.hush();
      this.secretsWorld.hush();
      const results: Results = this.match.results();
      this.hud.gameOver({ ...results });
      this.sound.play("game_over");
    }
  }

  /** Every fuse's fizz stopped: the sticks', and any still in a thrower's hand. */
  private quietFuses(): void {
    for (const s of this.match.sticks) this.sound.stopLoop(`fuse.s${s.id}`);
    for (const b of this.match.bandits) this.sound.stopLoop(`fuse.b${b.id}`);
  }

  // --- MatchListener ------------------------------------------------------------------------

  banner(title: string, subtitle?: string): void {
    this.hud.banner(title, subtitle);
  }

  waveStart(_wave: number, _spec: WaveSpec): void {
    this.sound.play("wave_start");
    this.pushReadouts(true);
  }

  waveClear(_wave: number, b: WaveBonuses): void {
    this.sound.play("wave_clear");
    showBonuses(this.hud, this.schedule, b, [
      [b.untouchable, "Untouchable", "gold"],
      [b.cleanHands, "Clean Hands", ""],
    ]);
    // The wave is won: the line clears for the title card (a tip still showing finishes).
    this.hints.setNeed(null);
    this.hints.clearWord();
    this.syncHint();
  }

  intermission(_next: number, giant: boolean): void {
    this.schedule.later(0.6, () => this.secretsWorld.bellHit(0.8));
    this.schedule.later(1.2, () => this.ambient.spawnTumbleweed(giant));
    this.hurt.value = 0;
  }

  banditSpawn(b: Bandit): void {
    this.cast.spawn(b);
  }
  banditTell(b: Bandit): void {
    this.cast.tell(b);
  }
  banditEmerge(b: Bandit): void {
    this.cast.emerge(b);
  }
  banditAim(b: Bandit): void {
    this.cast.aim(b);
  }
  banditGlint(b: Bandit): void {
    this.cast.glint(b, this.match.tuning.glintLead);
    this.offerTip("western.glint");
  }
  banditFire(b: Bandit, hit: boolean, _damage: number): void {
    this.cast.fire(b, hit);
  }
  banditHide(b: Bandit): void {
    this.cast.hide(b);
  }
  banditRelocate(_b: Bandit, _from: Cover): void {}
  banditRun(b: Bandit): void {
    this.cast.run(b);
  }
  banditLight(b: Bandit): void {
    this.cast.light(b);
  }
  banditThrow(b: Bandit, stick: Dynamite): void {
    this.cast.released(b, stick.id);
    this.offerTip("western.dynamite");
  }
  banditPace(b: Bandit, pace: number): void {
    this.cast.pace(b, pace);
  }
  banditStandoff(b: Bandit): void {
    this.cast.standoff(b);
  }
  duelBell(b: Bandit): void {
    this.cast.duelBell(b);
    this.sound.play("quick_draw", { volume: 0.6 });
  }
  banditDead(_b: Bandit): void {}

  banditWound(b: Bandit, part: HitPart): void {
    this.cast.wound(b, part, this.shotPoint);
    const word = b.role === "boss" ? bossWoundWord(b.health) : null;
    if (word) this.popupAt(tmp2.set(b.pos.x, b.pos.y + 2.05, b.pos.z), word);
  }

  banditDeath(b: Bandit, part: HitPart | "blast", award: Award): void {
    const blast = part === "blast";
    this.cast.death(b, part, blast ? null : this.shotPoint);
    if (!blast) this.shotKilled = true;
    tmp2.set(b.pos.x, b.pos.y + 2.05, b.pos.z);
    const special = award.labels.includes("Headshot") || award.labels.includes("Quick Draw") || award.labels.includes("Black Jack");
    this.popupAt(tmp2, awardText(award), special ? "gold" : "");
    if (award.labels.includes("Quick Draw")) this.sound.play("quick_draw", { volume: 0.9, delay: 0.05 });
    if (b.beforeTheBell) {
      this.hints.say(UNSPORTING, 2);
      this.syncHint();
    }
    this.pushReadouts(false);
  }

  bodyCleared(b: Bandit): void {
    this.cast.clear(b);
  }

  dynamiteDropped(stick: Dynamite, b: Bandit): void {
    this.sound.stopLoop(`fuse.b${b.id}`);
    this.sound.loopAt(`fuse.s${stick.id}`, "dynamite_fuse", b.pos, 0.8);
    const v = this.cast.view(b);
    v?.rig.hold(null);
  }

  dynamiteShot(stick: Dynamite, award: Award): void {
    tmp2.set(stick.position.x, stick.position.y + 0.4, stick.position.z);
    this.popupAt(tmp2, awardText(award), "gold");
  }

  dynamiteExplode(stick: Dynamite, _inAir: boolean): void {
    this.sound.stopLoop(`fuse.s${stick.id}`);
    tmp.set(stick.position.x, stick.position.y, stick.position.z);
    const floor = this.queries.groundAt(tmp.x, tmp.z, tmp.y + 0.1);
    this.effects.explosion(tmp, floor);
    this.sound.at("dynamite_explode", tmp, 1);
    const d = tmp.distanceTo(this.camera.camera.position);
    this.camera.rumble(Math.min(1.4, 6 / (2 + d)));
    if (d < 12) this.flash.kick(0.35 * (1 - d / 12), this.effects.reducedFlashing);
    if (tmp.y - floor < 0.6) {
      tmp2.set(0, 1, 0);
      tmp.y = floor + 0.01;
      this.effects.decals.add(tmp, tmp2, 1.8, this.visualRandom() * 6.28, SCORCH);
    }
  }

  playerHit(damage: number, direction: number, hurt: number, source: "bullet" | "dynamite"): void {
    this.hud.damage(direction, hurt);
    this.sound.play("player_hurt", { volume: Math.min(1, 0.6 + damage / 80), pan: Math.sin(direction) * 0.5 });
    this.camera.flinch(direction, Math.min(1.5, damage / 34));
    if (source === "dynamite") this.camera.rumble(1.2);
    this.hurtSide = direction >= 0 ? -1 : 1;
  }

  playerDeath(): void {
    this.phase = "dying";
    this.hud.playerDown?.();
    this.deathT = 0;
    this.sound.play("death_player");
    this.sound.filter("slowmo", 1);
    this.hints.setQuiet(true);
    this.syncHint();
    this.ambient.running = false;
  }

  townsfolkAppear(p: Townsperson): void {
    this.cast.townsAppear(p);
    this.offerTip("western.townsfolk");
  }
  townsfolkHide(_p: Townsperson): void {}
  townsfolkGone(p: Townsperson): void {
    this.cast.townsGone(p);
  }

  townsfolkShot(p: Townsperson, award: Award): void {
    // Said in words, not only in red and a sound: "−200 Townsperson" where
    // they stood, and a calm word on the line about who it was.
    tmp2.set(p.pos.x, p.pos.y + 2.05, p.pos.z);
    this.popupAt(tmp2, awardText(award), "danger");
    this.hints.say(innocentWord(p.role, this.match.scorer.townsfolkHit), 2);
    this.syncHint();
  }

  streakUp(multiplier: number): void {
    this.sound.play("streak_up", { rate: streakRate(multiplier) });
    this.pushReadouts(true);
  }

  score(value: number): void {
    this.hud.score(value);
  }

  reload(started: boolean): void {
    if (started) {
      this.sound.play("reload_spin");
      this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, true);
      this.hints.setNeed(null);
      // Reloaded by themselves: the start of the next game need not say how.
      if (this.phase === "playing") this.hints.learned("western.reload");
      this.syncHint();
    } else {
      this.sound.play("revolver_cock");
      this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, false);
    }
  }

  bellToll(_toll: number, doorsOpen: boolean): void {
    if (!doorsOpen) return;
    this.schedule.later(0.8, () => {
      this.secretsWorld.openDoors();
      const cover = this.secretsWorld.preacherCover();
      if (cover) this.schedule.later(0.9, () => this.match.spawnPreacher(cover));
    });
  }

  pianoNote(_count: number, tune: boolean): void {
    if (tune) this.secretsWorld.pianoTune();
  }

  chickenStartled(hits: number): void {
    const word = chickenWord(hits);
    const at = this.ambient.chickenCenterOrNull();
    if (word && at) this.popupAt(at, word);
  }

  tumbleweedShot(count: number, giantEarned: boolean): void {
    if (giantEarned) this.popupAt(this.shotPoint, "Wait for it…", "gold");
    else if (count > 1 && count < 5) this.popupAt(this.shotPoint, `Tumbleweed ×${count}`, "");
  }

  secretFound(id: SecretId, name: string, found: number, total: number): void {
    const announce = () => {
      if (this.phase !== "playing") return;
      this.hud.secret(name, found, total);
      this.sound.play("secret_found", { delay: 0.3 });
    };
    // The page's toast arrives at the top of the view, over the weather
    // vane: its show (the spin, then the creak round to point at you) plays
    // first, and the toast after it. (The rules announce the find before the
    // shot has set the vane spinning: its length is read a frame later.)
    if (id === "vane") this.schedule.later(0, () => this.schedule.later(this.secretsWorld.vaneShowLeft() + 0.2, announce));
    // The giant tumbleweed is found as the breather begins; it is announced
    // once it has rolled into view (see intermission()).
    else if (id === "tumbleweeds") this.schedule.later(1.8, announce);
    else announce();
  }

  // --- for the dev harness ----------------------------------------------------------------------

  /** Read-only views and a few switches for scripted play and screenshots. */
  get debug() {
    return {
      phase: () => this.phase,
      match: () => this.match,
      camera: () => this.camera.camera,
      real: () => this.assets?.real,
      covers: () => ({ used: this.assets.town.covers.map((c) => c.id), moved: this.coverReport?.moved, dropped: this.coverReport?.dropped }),
      /** The aim check's and play's framings for this window, and the lens now. */
      framing: () => ({ ...this.framings, fov: this.camera.camera.fov }),
      /**
       * Send one bandit out at a cover now, in the real machinery (tell,
       * emerge, aim, fire, hide), whatever the wave's director would choose:
       * for looking at every cover's clips in place. Returns his id.
       */
      stage: (id: string, role: "gunman" | "rifleman" | "dynamiter" | "boss" = "gunman", wait = 0.2) => {
        const c = this.assets.town.covers.find((x) => x.id === id);
        if (!c) return -1;
        const m = this.match as unknown as { bandits: Bandit[]; nextId: number; occupant: Map<string, unknown> };
        const b = new BanditClass(m.nextId++, role, c);
        b.health = role === "boss" ? 3 : 1;
        b.forced = true;
        m.occupant.set(c.id, b);
        m.bandits.push(b);
        this.cast.spawn(b);
        b.spawn(wait);
        return b.id;
      },
      /** Jump the view to a framing at once ("check" or "play"). */
      setFraming: (which: "check" | "play") => {
        if (this.framings) this.camera.setFraming(this.framings[which], 0);
      },
      /**
       * Stand a gang member at a cover (its exposed or hidden spot, facing the
       * eye as in play) holding a clip at time `t`, for checking every cover's
       * clips in place. Returns false for an unknown cover. `null` clears them.
       */
      atCover: (id: string | null, clip = "aim", t = 0, where: "exposed" | "hidden" = "exposed", kind: "bandit" | "boss" | "townsfolk" = "bandit", outfit?: string[]) => {
        const pool = this.pools[kind];
        if (id === null) {
          for (const p of [this.pools.bandit, this.pools.boss, this.pools.townsfolk]) for (const r of p.rigs) if (r.inUse && r.userDataGallery) p.give(r);
          return true;
        }
        const c = this.assets.town.covers.find((x) => x.id === id);
        const rig = c ? pool.take() : null;
        if (!c || !rig) return false;
        rig.userDataGallery = true;
        rig.dress(outfit ?? (kind === "townsfolk" ? ["var.coat.apron"] : kind === "boss" ? ["var.hat.stetson", "var.coat.duster"] : ["var.hat.stetson", "var.bandana.red", "var.vest"]));
        rig.hold(kind === "townsfolk" ? null : "gun.revolver");
        rig.root.visible = true;
        const p = where === "exposed" ? c.exposed : c.hidden;
        rig.root.position.set(p.x, p.y, p.z);
        const eye = this.assets.town.eye;
        rig.root.rotation.y = Math.atan2(eye.x - p.x, eye.z - p.z);
        rig.play(clip, 0, false);
        rig.update(0);
        rig.mixer.setTime(t);
        // Lit as in play: is the sun on him here?
        const chest = new Vector3(p.x, p.y + 1.3, p.z);
        rig.lighting.key.value = this.queries.sunReaches(chest, this.stage.sunDirection.clone().negate()) ? 1 : 0.12;
        return true;
      },
      setImmortal: (on: boolean) => {
        this.match.health.immortal = on;
      },
      /** Viewport positions of what can be shot right now. */
      targets: () => this.debugTargets(),
      /**
       * Line rigs up in front of the camera, each holding a clip at time `t`
       * (for looking at the animation up close). Pass an empty list to clear.
       */
      gallery: (clips: string[], t: number, kind: "bandit" | "boss" | "townsfolk" = "bandit", outfit?: string[]) => {
        const pool = this.pools[kind];
        for (const p of [this.pools.bandit, this.pools.boss, this.pools.townsfolk]) {
          for (const r of p.rigs) if (r.inUse && r.userDataGallery) p.give(r);
        }
        const loops = ["idle", "hidden", "aim", "run", "peek", "panic", "head_shake", "wave", "peck", "walk"];
        const n = clips.length;
        clips.forEach((clip, i) => {
          const rig = pool.take();
          if (!rig) return;
          rig.userDataGallery = true;
          rig.dress(outfit ?? (kind === "townsfolk" ? ["var.coat.apron"] : ["var.hat.stetson", "var.bandana.red", "var.vest"]));
          rig.hold(kind === "townsfolk" ? null : "gun.revolver");
          rig.root.visible = true;
          rig.root.position.set((i - (n - 1) / 2) * 1.25, 0, -5.2);
          rig.root.rotation.y = 0.35 * Math.sign(-(i - (n - 1) / 2));
          rig.play(clip, 0, loops.includes(clip));
          rig.update(0);
          rig.mixer.setTime(t);
        });
      },
    };
  }

  /**
   * A point on a character a player could actually see and aim at: the chest
   * if it is clear of cover, else the belly, the neck or the head.
   */
  private visiblePoint(j: import("../../engine/world/character").Joints, out: Vector3): boolean {
    const cam = this.camera.camera.position;
    const hit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
    const dir = new Vector3();
    for (const k of [0.7, 0.45, 0.95, -1]) {
      if (k < 0) out.copy(j.head);
      else out.copy(j.hips).lerp(j.neck, k);
      const d = out.distanceTo(cam);
      dir.copy(out).sub(cam).normalize();
      const h = this.queries.cast(cam, dir, d + 1, hit);
      if (!h || h.distance > d - 0.25) return true;
    }
    return false;
  }

  private debugTargets() {
    const out: { kind: string; id: number; role?: string; state?: string; x: number; y: number; hx?: number; hy?: number; distance: number; clear?: boolean }[] = [];
    const cam = this.camera.camera.position;
    const at = new Vector3();
    for (const v of this.cast.bandits) {
      if (!v.b.shootable) continue;
      const j = v.rig.updateJoints();
      const clear = this.visiblePoint(j, at);
      const distance = at.distanceTo(cam);
      const body = this.project(at);
      const head = this.project(j.head);
      if (!body || !head) continue;
      out.push({ kind: "bandit", id: v.b.id, role: v.b.role, state: v.b.state, x: body.x, y: body.y, hx: head.x, hy: head.y, distance, clear });
    }
    for (const st of this.match.sticks) {
      if (!st.airborne) continue;
      at.set(st.position.x, st.position.y, st.position.z);
      const distance = at.distanceTo(cam);
      const p = this.project(at);
      if (p) out.push({ kind: "dynamite", id: st.id, x: p.x, y: p.y, distance });
    }
    for (const v of this.cast.townsfolk) {
      if (!v.p.shootable) continue;
      const j = v.rig.updateJoints();
      this.visiblePoint(j, at);
      const distance = at.distanceTo(cam);
      const p = this.project(at);
      if (p) out.push({ kind: "townsfolk", id: v.p.id, role: v.p.role, state: v.p.state, x: p.x, y: p.y, distance });
    }
    // Is the straight line from the eye to `at` clear of the town (within `slack` metres)?
    const clearTo = (at: Vector3, slack: number) => {
      const d = at.distanceTo(cam);
      const dir = new Vector3().copy(at).sub(cam).normalize();
      const h = this.queries.cast(cam, dir, d + 1, { point: new Vector3(), normal: new Vector3(), distance: 0, object: null });
      return !h || h.distance > d - slack;
    };
    const onScreen = (p: { x: number; y: number }) => p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98;
    const s = this.assets.town.secrets;
    const secretPoints: [string, Vector3 | null][] = [
      ["bell", this.secretsWorld.bellCenter()],
      ["vane", this.secretsWorld.vaneCenter()],
      ["water_tower", s.waterTower ? s.waterTower.getWorldPosition(new Vector3()) : null],
      // The piano's keyboard, on the near side, where the slanted view through the window reaches.
      ["piano", s.piano ? s.piano.getWorldPosition(new Vector3()).add(new Vector3(0.34, 0.8, 0.35)) : null],
      ["poster", s.poster ? s.poster.getWorldPosition(new Vector3()) : null],
    ];
    for (const [kind, point] of secretPoints) {
      if (!point) continue;
      const p = this.project(point);
      if (p) out.push({ kind: `secret.${kind}`, id: 0, x: p.x, y: p.y, distance: point.distanceTo(cam), clear: onScreen(p) });
    }
    this.ambient.tumbleweeds().forEach((w, i) => {
      if (!w.active) return;
      const p = this.project(w.center);
      if (p) out.push({ kind: "tumbleweed", id: i, x: p.x, y: p.y, distance: w.center.distanceTo(cam), clear: onScreen(p) && clearTo(w.center, 0.6) });
    });
    const c = this.ambient.chickenCenterOrNull();
    if (c) {
      const p = this.project(c);
      if (p) out.push({ kind: "chicken", id: 0, x: p.x, y: p.y, distance: c.distanceTo(cam), clear: onScreen(p) && clearTo(c, 0.4) });
    }
    return out;
  }
}

const GOLD_LIGHT = new Color(1, 0.8, 0.35);
const GLASS_COLOR = new Color("#b9d0d6");
const SCORCH = new Color(0.25, 0.22, 0.2);
