import { Color, PCFShadowMap, SRGBColorSpace, Vector3, type Mesh, type ToneMapping } from "three";
import type {
  Aim,
  CalibrationStage,
  CalibrationTarget,
  Game,
  GameContext,
  HudSink,
  Readout,
} from "../../engine/types";
import type { Bandit } from "./rules/bandit";
import type { Dynamite } from "./rules/dynamite";
import { Match, type MatchListener, type Results } from "./rules/match";
import { mulberry32 } from "./rules/rng";
import type { Award, WaveBonuses } from "./rules/scoring";
import { isHighNoon, type SecretId } from "./rules/secrets";
import type { Townsperson } from "./rules/townsfolk";
import type { Cover, HitPart } from "./rules/types";
import type { WaveSpec } from "./rules/waves";
import { Ambient } from "./world/ambient";
import { loadAssets, type HighNoonAssets } from "./world/assets";
import { BottleStage } from "./world/bottles";
import { Cast } from "./world/cast";
import { RigPool, templateFrom } from "./world/character";
import { DynamiteView } from "./world/dynamiteView";
import { Effects } from "./world/effects";
import { PlayerCamera } from "./world/playerCamera";
import { PostFX } from "./world/post";
import { TownQueries } from "./world/queries";
import { SecretsWorld } from "./world/secretsWorld";
import { Shooter } from "./world/shooting";
import { Sound } from "./world/sound";
import { Stage } from "./world/stage";
import type { Surface } from "./world/town";

export interface HighNoonOptions {
  /** Start on this wave (the dev harness's ?wave=). */
  startWave?: number;
  /** Hits hurt but never kill (screenshots, performance runs). */
  immortal?: boolean;
  /** Force High Noon for real on or off, whatever the clock says. */
  noon?: boolean;
}

const RELOAD_HINT = "Point off the screen to reload.";
const HIT_SOUND: Record<Surface, string> = {
  wood: "hit_wood",
  dirt: "hit_dirt",
  glass: "hit_glass",
  metal: "hit_metal",
  stone: "hit_dirt",
  cloth: "hit_dirt",
  water: "hit_water",
};

interface Scheduled {
  at: number;
  run: () => void;
}

const tmp = new Vector3();
const tmp2 = new Vector3();

/** Before load() the aim check has nothing to show; afterwards this forwards to the bottles. */
class CalibrationProxy implements CalibrationStage {
  target: BottleStage | null = null;
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
 * High Noon: the Game the app hosts. It owns the world (stage, cast, effects,
 * secrets, ambience, bottles) and the rules (Match), turns the player's aim
 * into shots, and answers the rules' events with pictures, sounds and HUD.
 */
export class HighNoon implements Game, MatchListener {
  readonly id = "western";
  readonly title = "High Noon";
  readonly calibration: CalibrationStage;
  private readonly calibrationProxy = new CalibrationProxy();

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
  private flash = 0;
  private hurtShown = -1;
  private hurtDisplay = 0;
  private hurtFilter = -1;
  private readoutKey = "";
  private hintUntil = -1;
  private hintText: string | null = null;
  private golden = false;
  private noon = false;
  private reloadKey = false;
  private tombstone = false;
  /** Which way the view tips at death: away from the last shot that hit. */
  private hurtSide = 1;
  private readonly schedule: Scheduled[] = [];
  private readonly shotPoint = new Vector3();
  private shotX = 0.5;
  private shotY = 0.5;
  private shotKilled = false;
  private visualRandom = mulberry32(7);
  private previousToneMapping: ToneMapping | null = null;
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

    this.assets = await loadAssets(ctx, (f) => onProgress(f * 0.9), this.noon);
    const town = this.assets.town;
    this.stage = new Stage(renderer, town, this.assets.sky, this.assets.fog, this.noon);
    this.stage.setQuality(ctx.quality);
    this.camera = new PlayerCamera(town.eye, town.eyeQuaternion, town.fov);
    this.camera.reducedMotion = ctx.settings.reducedMotion;
    this.camera.still = true;
    this.sound = new Sound(ctx.audio, this.camera.camera);
    this.queries = new TownQueries(town);
    this.effects = new Effects(this.stage.fxRoot, ctx.quality);
    this.effects.setRandom(this.visualRandom);
    onProgress(0.92);

    const banditT = templateFrom("bandit", this.assets.bandit);
    const bossT = templateFrom("boss", this.assets.boss, this.assets.bandit.animations);
    const townsT = templateFrom("townsfolk", this.assets.townsfolk, this.assets.bandit.animations);
    const chickenT = templateFrom("chicken", this.assets.chicken);
    const parent = this.stage.dynamic;
    this.pools = {
      bandit: new RigPool(banditT, 12, parent),
      boss: new RigPool(bossT, 1, parent),
      townsfolk: new RigPool(townsT, 4, parent),
      chicken: new RigPool(chickenT, 1, parent),
    };
    this.secretsWorld = new SecretsWorld(town, this.effects, this.sound, this.queries, parent);
    const toSun = this.stage.sunDirection.clone().negate();
    this.cast = new Cast(this.pools, parent, this.effects, this.sound, this.queries, town.eye, toSun, this.visualRandom, {
      popup: (at, text, tone) => this.popupAt(at, text, tone),
      bellSwing: () => this.secretsWorld.bellHit(1),
    });
    this.ambient = new Ambient(town, parent, this.pools.chicken, this.effects, this.sound, this.visualRandom, ctx.quality);
    this.bottles = new BottleStage(town, parent, this.camera.camera, this.effects, this.sound, this.queries);
    this.calibrationProxy.target = this.bottles;
    this.newMatch();
    this.dynamite = new DynamiteView(parent, this.match.sticks, this.effects, town.eye);
    this.shooter = new Shooter(this.camera.camera, this.queries, town, this.cast, {
      sticks: this.match.sticks,
      tumbleweeds: () => this.ambient.tumbleweeds(),
      chicken: () => this.ambient.chickenCenterOrNull(),
      bellCenter: () => this.secretsWorld.bellCenter(),
      vaneCenter: () => this.secretsWorld.vaneCenter(),
    });
    this.post = new PostFX(renderer, this.stage.scene, this.camera.camera, ctx.quality);
    this.post.set("noon", this.noon ? 1 : 0);
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720, renderer.getPixelRatio());
    await this.warmUp();
    window.addEventListener("keydown", this.onKey);
    this.sound.loop("wind", "wind", { volume: 0.35 });
    this.phase = "calibration";
    onProgress(1);
  }

  private newMatch(): void {
    const town = this.assets.town;
    this.match = new Match({
      random: this.ctx.random,
      covers: town.covers,
      listener: this,
      eye: { x: town.eye.x, y: town.eye.y, z: town.eye.z },
      yaw: this.camera.yaw,
    });
    this.match.health.immortal = this.options.immortal === true;
  }

  /**
   * Compile every shader before play: the rigs, the effects, the post chain.
   * A shader first compiled mid-gunfight is a dropped frame at the worst time.
   */
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
      if ("compileAsync" in r) await r.compileAsync(scene, this.camera.camera);
      else (r as { compile: (s: unknown, c: unknown) => void }).compile(scene, this.camera.camera);
    } catch {
      // Compilation is an optimisation; the first frames will do it otherwise.
    }
    for (const s of shown) s.o.visible = s.visible;
  }

  start(): void {
    if (this.phase === "loading") return;
    if (this.phase !== "calibration") {
      // Play Again on the same instance: a fresh match in the same town.
      this.cast.reset();
      this.ambient.reset();
      this.newMatch();
      this.bottles.reset();
    }
    this.bottles.done();
    this.bottles.active = false;
    this.camera.still = false;
    this.camera.setDeath(0, 1);
    this.phase = "playing";
    this.time = 0;
    this.timeScale = 1;
    this.sepia = 0;
    this.deathT = 0;
    this.tombstone = false;
    this.hurtShown = -1;
    this.readoutKey = "";
    this.sound.filter("slowmo", 0);
    this.sound.filter("hurt", 0);
    const wave = Math.max(1, Math.floor(this.options.startWave ?? 1));
    this.hud.score(0);
    this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, false);
    this.hud.health(0);
    this.match.start({ wave, duel: this.noon && wave === 1 });
    this.ambient.running = true;
    this.showHint(RELOAD_HINT, 5);
    if (this.golden) {
      const hud = this.hud as HudSink & { revolverFinish?: (finish: "steel" | "gold") => void };
      hud.revolverFinish?.("gold");
      this.sound.play("golden_unlock", { volume: 0.8, delay: 0.4 });
      this.later(1.0, () => this.hud.popup(0.5, 0.62, "Golden Revolver", "gold"));
    }
    this.pushReadouts(true);
  }

  update(dt: number, _now: number, aim: Aim): void {
    if (this.phase === "loading" || this.paused) return;
    this.lastDt = dt;
    const scale = this.timeScale;
    const wdt = dt * scale;
    this.time += wdt;
    this.runSchedule();

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
    this.updateWorld(wdt, dt, true);
    this.updateHurt(dt);
    if (this.phase === "playing") this.pushReadouts(false);
    if (this.phase === "dying" || this.phase === "over") this.updateDeath(dt);
    if (this.hintUntil > 0 && this.time > this.hintUntil) this.clearHint();
  }

  private updateWorld(wdt: number, realDt: number, playing: boolean): void {
    this.cast.update(wdt, this.time);
    this.dynamite.update(wdt);
    this.secretsWorld.update(wdt);
    this.ambient.update(wdt, playing || this.phase === "calibration");
    this.bottles.update(wdt);
    this.effects.update(wdt);
    this.camera.update(realDt);
    this.flash *= Math.exp(-realDt / 0.12);
    this.post.set("flash", this.flash);
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
    this.effects.setScale(height * pixelRatio, this.camera.camera.fov);
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
    tmp2.y -= 0.12;
    this.effects.playerPuff(tmp2, this.golden);
  }

  private fire(x: number, y: number): void {
    const result = this.match.trigger();
    if (result === "dry") {
      this.sound.play("revolver_dry");
      this.showHint(RELOAD_HINT, 0);
      return;
    }
    if (result !== "fired") return;
    this.sound.play("revolver_shot", { volume: 1, rate: 0.97 + this.visualRandom() * 0.06 });
    this.camera.kick(this.visualRandom);
    this.puff(x, y);
    if (this.golden) {
      tmp.set(x * 2 - 1, -(y * 2 - 1), 0.5).unproject(this.camera.camera).sub(this.camera.camera.position).normalize();
      tmp2.copy(this.camera.camera.position).addScaledVector(tmp, 0.9);
      this.effects.lights.flash(tmp2, GOLD_LIGHT, 18, 5, 0.08);
    }
    this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, false);
    const res = this.shooter.shoot(x, y);
    this.shotPoint.copy(res.point);
    this.shotX = x;
    this.shotY = y;
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

  private showHint(text: string, seconds: number): void {
    if (this.hintText !== text) this.hud.hint(text);
    this.hintText = text;
    this.hintUntil = seconds > 0 ? this.time + seconds : -1;
  }

  private clearHint(): void {
    if (this.hintText !== null) this.hud.hint(null);
    this.hintText = null;
    this.hintUntil = -1;
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
      { label: "Streak", value: `×${mult}`, meter: (mult - 1) / 3, tone: mult >= 4 ? "warning" : "" },
    ];
    this.hud.readouts(list);
  }

  private updateHurt(dt: number): void {
    const hurt = this.match.health.hurt;
    // The picture reacts at once to a hit and recovers with the regeneration.
    this.hurtDisplay = hurt > this.hurtDisplay ? hurt : this.hurtDisplay + (hurt - this.hurtDisplay) * Math.min(1, dt * 4);
    const h = this.hurtDisplay;
    this.post.set("hurt", h);
    this.post.set("desaturate", Math.min(1, h * 0.6 + this.sepia));
    if (Math.abs(h - this.hurtShown) > 0.01) {
      this.hurtShown = h;
      this.hud.health(h);
    }
    if (Math.abs(h - this.hurtFilter) > 0.02) {
      this.hurtFilter = h;
      this.sound.filter("hurt", h);
    }
    if (h > 0.35 && this.phase === "playing") this.sound.loop("heartbeat", "heartbeat", { volume: Math.min(1, h + 0.2) });
    else if (h < 0.2 || this.phase !== "playing") this.sound.stopLoop("heartbeat");
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
      this.hud.banner("Here lies a fast hand.", `Fell on Wave ${this.match.wave}.`);
    }
    if (t > 5.2 && this.phase === "dying") {
      this.phase = "over";
      const results: Results = this.match.results();
      this.hud.gameOver({ ...results });
      this.sound.play("game_over");
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
    const lines: [string, "" | "gold"][] = [];
    if (b.accuracyPoints > 0) lines.push([`+${b.accuracyPoints} Accuracy ${Math.round(b.accuracy * 100)}%`, ""]);
    if (b.untouchable > 0) lines.push([`+${b.untouchable} Untouchable`, "gold"]);
    if (b.cleanHands > 0) lines.push([`+${b.cleanHands} Clean Hands`, ""]);
    lines.forEach(([text, tone], i) => this.later(0.35 + i * 0.45, () => this.hud.popup(0.5, 0.56 + i * 0.05, text, tone)));
    this.clearHint();
  }

  intermission(_next: number, giant: boolean): void {
    this.later(0.6, () => this.secretsWorld.bellHit(0.8));
    this.later(1.2, () => this.ambient.spawnTumbleweed(giant));
    this.hurtDisplay = 0;
    this.sound.stopLoop("heartbeat");
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
    this.cast.glint(b);
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
  }

  banditDeath(b: Bandit, part: HitPart | "blast", award: Award): void {
    const blast = part === "blast";
    this.cast.death(b, part, blast ? null : this.shotPoint);
    if (!blast) this.shotKilled = true;
    tmp2.set(b.pos.x, b.pos.y + 2.05, b.pos.z);
    const special = award.labels.includes("Headshot") || award.labels.includes("Quick Draw") || award.labels.includes("Black Jack");
    this.popupAt(tmp2, this.awardText(award), special ? "gold" : "");
    if (award.labels.includes("Quick Draw")) this.sound.play("quick_draw", { volume: 0.9, delay: 0.05 });
    this.pushReadouts(false);
  }

  bodyCleared(b: Bandit): void {
    this.cast.clear(b);
  }

  dynamiteDropped(stick: Dynamite, b: Bandit): void {
    this.sound.stopLoop(`fuse.b${b.id}`);
    this.sound.loopAt(`fuse.s${stick.id}`, "dynamite_fuse", b.pos, 0.8);
    const v = this.cast.view(b);
    v?.rig.arm("none");
  }

  dynamiteShot(stick: Dynamite, award: Award): void {
    tmp2.set(stick.position.x, stick.position.y + 0.4, stick.position.z);
    this.popupAt(tmp2, this.awardText(award), "gold");
  }

  dynamiteExplode(stick: Dynamite, _inAir: boolean): void {
    this.sound.stopLoop(`fuse.s${stick.id}`);
    tmp.set(stick.position.x, stick.position.y, stick.position.z);
    const floor = this.queries.groundAt(tmp.x, tmp.z, tmp.y + 0.1);
    this.effects.explosion(tmp, floor);
    this.sound.at("dynamite_explode", tmp, 1);
    const d = tmp.distanceTo(this.camera.camera.position);
    this.camera.rumble(Math.min(1.4, 6 / (2 + d)));
    if (d < 12) this.flash = Math.max(this.flash, 0.35 * (1 - d / 12));
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
    this.deathT = 0;
    this.sound.play("death_player");
    this.sound.stopLoop("heartbeat");
    this.sound.filter("slowmo", 1);
    this.clearHint();
    this.ambient.running = false;
  }

  townsfolkAppear(p: Townsperson): void {
    this.cast.townsAppear(p);
  }
  townsfolkHide(_p: Townsperson): void {}
  townsfolkGone(p: Townsperson): void {
    this.cast.townsGone(p);
  }

  townsfolkShot(p: Townsperson, award: Award): void {
    tmp2.set(p.pos.x, p.pos.y + 2.05, p.pos.z);
    this.popupAt(tmp2, this.awardText(award), "danger");
    this.showHint("Mind the townsfolk.", 2.5);
  }

  streakUp(multiplier: number): void {
    this.sound.play("streak_up", { rate: 0.9 + multiplier * 0.08 });
    this.pushReadouts(true);
  }

  score(value: number): void {
    this.hud.score(value);
  }

  reload(started: boolean): void {
    if (started) {
      this.sound.play("reload_spin");
      this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, true);
      if (this.hintText === RELOAD_HINT) this.clearHint();
    } else {
      this.sound.play("revolver_cock");
      this.hud.ammo(this.match.revolver.rounds, this.match.revolver.capacity, false);
    }
  }

  bellToll(_toll: number, doorsOpen: boolean): void {
    if (!doorsOpen) return;
    this.later(0.8, () => {
      this.secretsWorld.openDoors();
      const cover = this.secretsWorld.preacherCover();
      if (cover) this.later(0.9, () => this.match.spawnPreacher(cover));
    });
  }

  pianoNote(_count: number, tune: boolean): void {
    if (tune) this.secretsWorld.pianoTune();
  }

  chickenStartled(_hits: number): void {}

  tumbleweedShot(count: number, giantEarned: boolean): void {
    if (giantEarned) this.popupAt(this.shotPoint, "Wait for it…", "gold");
    else if (count > 1 && count < 5) this.popupAt(this.shotPoint, `Tumbleweed ×${count}`, "");
  }

  secretFound(_id: SecretId, name: string, found: number, total: number): void {
    this.hud.secret(name, found, total);
    this.sound.play("secret_found", { delay: 0.3 });
  }

  // --- for the dev harness ----------------------------------------------------------------------

  /** Read-only views and a few switches for scripted play and screenshots. */
  get debug() {
    return {
      phase: () => this.phase,
      match: () => this.match,
      camera: () => this.camera.camera,
      real: () => this.assets?.real,
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
          rig.arm(kind === "townsfolk" ? "none" : "revolver");
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
  private visiblePoint(j: import("./world/character").Joints, out: Vector3): boolean {
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
    const s = this.assets.town.secrets;
    const secretPoints: [string, Vector3 | null][] = [
      ["bell", this.secretsWorld.bellCenter()],
      ["vane", this.secretsWorld.vaneCenter()],
      ["water_tower", s.waterTower ? s.waterTower.getWorldPosition(new Vector3()) : null],
      ["piano", s.piano ? s.piano.getWorldPosition(new Vector3()).add(new Vector3(0.3, 0.8, 0)) : null],
      ["poster", s.poster ? s.poster.getWorldPosition(new Vector3()) : null],
    ];
    for (const [kind, at] of secretPoints) {
      if (!at) continue;
      const p = this.project(at);
      if (p) out.push({ kind: `secret.${kind}`, id: 0, x: p.x, y: p.y, distance: at.distanceTo(this.camera.camera.position) });
    }
    this.ambient.tumbleweeds().forEach((w, i) => {
      if (!w.active) return;
      const p = this.project(w.center);
      if (p) out.push({ kind: "tumbleweed", id: i, x: p.x, y: p.y, distance: w.center.distanceTo(this.camera.camera.position) });
    });
    const c = this.ambient.chickenCenterOrNull();
    if (c) {
      const p = this.project(c);
      if (p) out.push({ kind: "chicken", id: 0, x: p.x, y: p.y, distance: c.distanceTo(this.camera.camera.position) });
    }
    return out;
  }
}

const GOLD_LIGHT = new Color(1, 0.8, 0.35);
const GLASS_COLOR = new Color("#b9d0d6");
const SCORCH = new Color(0.25, 0.22, 0.2);
