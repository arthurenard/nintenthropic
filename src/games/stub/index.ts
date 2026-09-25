/**
 * A stand-in game: a small shooting range built from primitives, so the whole
 * app - landing, aim check, play, pause, results - works end to end before
 * High Noon lands, and so the platform can be tested without it.
 *
 * It exercises every part of the HUD a real game uses: the score and
 * readouts, wave banners, the six-round cylinder with reloading by pointing
 * off the screen, damage from a direction and the red edge that recovers,
 * hit markers, popups, hints and a secret. Steel plates rise from behind the
 * crates; shoot each before it turns red and fires back.
 */
import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  type Object3D,
  type Scene,
} from "three";
import type { Aim, Game, GameContext, GameStats, InputKind } from "../../engine/types";
import { loadSoundPack } from "../../audio/index";
import { BottleStage } from "./stage";
import { bellPost, buildWorld } from "./world";

const CAPACITY = 6;
/** How to reload, in the words of the player's own input. */
const RELOAD_HINT: Record<InputKind, string> = {
  hand: "Point off the screen to reload.",
  mouse: "Right-click or press R to reload.",
  touch: "Tap with two fingers to reload.",
};
const WHITE = new Color("#f2efe9");
const RED = new Color("#ff453a");
const RELOAD = 0.9;
const WAVES = 5;
/** A plate's hit costs this much of the player's health. */
const DAMAGE = 0.34;
/** Seconds without a hit before health comes back, and how fast. */
const REGEN_DELAY = 3.5;
const REGEN_RATE = 0.4;

interface Plate {
  mesh: Group;
  face: Mesh;
  /** Where it rises from and to. */
  x: number;
  z: number;
  born: number;
  /** Seconds it stays up before it fires back. */
  patience: number;
  state: "rising" | "up" | "down";
  t: number;
}

export interface StubOptions {
  id?: string;
  title?: string;
}

class Range implements Game {
  readonly id: string;
  readonly title: string;
  calibration!: BottleStage;

  private ctx!: GameContext;
  private scene!: Scene;
  private readonly camera = new PerspectiveCamera(50, 16 / 9, 0.1, 600);
  private readonly ray = new Raycaster();
  private plates: Plate[] = [];
  private bell!: Mesh;
  private started = false;
  private over = false;
  private time = 0;
  private wave = 0;
  private toSpawn = 0;
  private nextSpawn = 0;
  private breather = 0;
  private score = 0;
  private ammo = CAPACITY;
  private reloading = 0;
  private wasOffscreen = false;
  private hurt = 0;
  private lastHit = -Infinity;
  private shots = 0;
  private hits = 0;
  private streak = 0;
  private bestStreak = 0;
  private secrets = 0;
  private kick = 0;
  private hinted = { empty: false, reload: false };
  private stopWind: (() => void) | null = null;

  constructor(options: StubOptions) {
    this.id = options.id ?? "range";
    this.title = options.title ?? "Range";
  }

  async load(ctx: GameContext, onProgress: (fraction: number) => void): Promise<void> {
    this.ctx = ctx;
    const { scene } = buildWorld();
    this.scene = scene;
    this.camera.position.set(0, 1.7, 0);
    this.camera.lookAt(0, 1.55, -10);
    const bell = bellPost();
    this.bell = bell.bell;
    scene.add(bell.group);
    this.calibration = new BottleStage(scene, this.camera, ctx.settings.reducedMotion, ctx.audio);
    ctx.renderer.toneMapping = ACESFilmicToneMapping;
    ctx.renderer.toneMappingExposure = 1.05;
    // Nothing to download: synthesise the sounds and compile the materials,
    // so the first frame is smooth and the first shot is heard.
    await loadSoundPack(ctx.audio, "western", (fraction) => onProgress(0.8 * fraction));
    await ctx.renderer.compileAsync(scene, this.camera);
    onProgress(1);
    this.stopWind = ctx.audio.loop("wind", { volume: 0.6 });
  }

  start(): void {
    this.started = true;
    this.calibration.done();
    this.ctx.hud.score(0);
    this.ctx.hud.ammo(this.ammo, CAPACITY, false);
    this.ctx.hud.health(0);
    this.nextWave();
  }

  private nextWave(): void {
    this.wave++;
    this.toSpawn = 2 + this.wave * 2;
    this.nextSpawn = this.time + 1.6;
    this.ctx.hud.banner(`Wave ${this.wave}`, this.wave === 1 ? "Hit the plates before they fire." : undefined);
    this.ctx.audio.play("wave_start");
    this.readouts();
  }

  private readouts(): void {
    this.ctx.hud.readouts([
      { label: "Wave", value: `${this.wave} of ${WAVES}` },
      { label: "Streak", value: this.streak > 1 ? `×${Math.min(4, this.streak)}` : "–" },
    ]);
  }

  private spawn(): void {
    const random = this.ctx.random;
    const x = (random() * 2 - 1) * 10;
    const z = -10 - random() * 18;
    const group = new Group();
    const pole = new Mesh(new CylinderGeometry(0.04, 0.04, 1.3, 8), new MeshStandardMaterial({ color: "#4a4a4a" }));
    pole.position.y = 0.65;
    const face = new Mesh(
      new CircleGeometry(0.42, 36),
      new MeshStandardMaterial({ color: "#f2efe9", metalness: 0.4, roughness: 0.45, side: DoubleSide }),
    );
    face.position.y = 1.55;
    group.add(pole, face);
    group.position.set(x, -1.8, z);
    group.lookAt(0, -1.8, 0);
    this.scene.add(group);
    const patience = Math.max(1.3, 2.6 - this.wave * 0.25);
    this.plates.push({ mesh: group, face, x, z, born: this.time, patience, state: "rising", t: 0 });
  }

  update(dt: number, now: number, aim: Aim): void {
    this.time += dt;
    this.calibration.update(dt, now);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.camera.rotation.x = (this.ctx.settings.reducedMotion ? 0 : this.kick * 0.02) - 0.015;
    if (!this.started || this.over) return;

    // Reloading: pointing off the screen, as the arcade guns did.
    if (aim.offscreen && !this.wasOffscreen && this.ammo < CAPACITY && this.reloading <= 0) {
      this.reloading = RELOAD;
      this.ctx.hud.ammo(this.ammo, CAPACITY, true);
      this.ctx.audio.play("reload_spin");
      this.ctx.hud.hint(null);
    }
    this.wasOffscreen = aim.offscreen;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.ammo = CAPACITY;
        this.ctx.hud.ammo(this.ammo, CAPACITY, false);
      }
    }

    if (aim.fired && !aim.offscreen) this.shoot(aim);

    // Waves and plates.
    if (this.breather > 0) {
      this.breather -= dt;
      if (this.breather <= 0) this.nextWave();
    } else if (this.toSpawn > 0 && this.time >= this.nextSpawn) {
      this.spawn();
      this.toSpawn--;
      this.nextSpawn = this.time + Math.max(0.7, 1.6 - this.wave * 0.15);
    }
    for (const plate of [...this.plates]) this.animate(plate, dt);
    if (!this.toSpawn && !this.plates.length && this.breather <= 0) {
      if (this.wave >= WAVES) this.finish(true);
      else {
        this.breather = 3;
        this.ctx.hud.popup(0.5, 0.42, "Wave Clear", "gold");
        this.ctx.audio.play("wave_clear");
      }
    }

    // Health comes back after a while without being hit.
    if (this.hurt > 0 && this.time - this.lastHit > REGEN_DELAY) {
      this.hurt = Math.max(0, this.hurt - REGEN_RATE * dt);
      this.ctx.hud.health(this.hurt);
      this.ctx.audio.setFilter("hurt", this.hurt);
    }
  }

  private animate(plate: Plate, dt: number): void {
    plate.t += dt;
    const material = plate.face.material as MeshStandardMaterial;
    if (plate.state === "rising") {
      plate.mesh.position.y = -1.8 + Math.min(1, plate.t / 0.35) * 1.8;
      if (plate.t >= 0.35) {
        plate.state = "up";
        plate.t = 0;
      }
    } else if (plate.state === "up") {
      // White to amber to red as it gets ready to fire.
      const warning = Math.min(1, plate.t / plate.patience);
      material.color.copy(WHITE).lerp(RED, warning * warning);
      if (plate.t >= plate.patience) {
        this.hitPlayer(plate);
        this.lower(plate);
      }
    } else {
      plate.mesh.position.y -= dt * 6;
      if (plate.mesh.position.y < -2) {
        this.scene.remove(plate.mesh);
        dispose(plate.mesh);
        this.plates = this.plates.filter((p) => p !== plate);
      }
    }
  }

  private lower(plate: Plate): void {
    plate.state = "down";
    plate.t = 0;
  }

  private hitPlayer(plate: Plate): void {
    // 0 straight ahead, positive to the right, as the HUD's arcs expect.
    const direction = Math.atan2(plate.x, -plate.z);
    this.hurt = Math.min(1, this.hurt + DAMAGE);
    this.lastHit = this.time;
    this.streak = 0;
    this.readouts();
    this.ctx.audio.play("bandit_shot", { pan: Math.sin(direction), distance: Math.hypot(plate.x, plate.z) });
    this.ctx.hud.damage(direction, this.hurt);
    this.ctx.audio.play("player_hurt");
    this.ctx.audio.setFilter("hurt", this.hurt);
    if (this.hurt >= 0.999) this.finish(false);
  }

  private shoot(aim: Aim): void {
    if (this.reloading > 0) return;
    if (this.ammo <= 0) {
      this.ctx.audio.play("revolver_dry");
      if (!this.hinted.empty) {
        this.hinted.empty = true;
        this.ctx.hud.hint(RELOAD_HINT[this.ctx.input ?? "hand"]);
      }
      return;
    }
    this.ammo--;
    this.shots++;
    this.kick = 1;
    this.ctx.hud.ammo(this.ammo, CAPACITY, false);
    this.ctx.audio.play("revolver_shot", { pan: (aim.x * 2 - 1) * 0.3 });
    this.ray.setFromCamera(new Vector2(aim.x * 2 - 1, 1 - aim.y * 2), this.camera);
    const live = this.plates.filter((p) => p.state !== "down");
    const hit = this.ray.intersectObjects<Object3D>([...live.map((p) => p.face), this.bell], false)[0];
    if (!hit) {
      this.streak = 0;
      this.readouts();
      return;
    }
    if (hit.object === this.bell) {
      this.ctx.audio.play("bell_toll");
      if (!this.secrets) {
        this.secrets = 1;
        this.ctx.hud.secret("The Bell", 1, 1);
        this.ctx.audio.play("secret_found", { delay: 0.4 });
      }
      return;
    }
    const plate = live.find((p) => p.face === hit.object)!;
    const local = plate.face.worldToLocal(hit.point.clone());
    const bullseye = Math.hypot(local.x, local.y) < 0.14;
    const quick = plate.state === "rising" || plate.t < 0.5;
    this.hits++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const multiplier = Math.min(4, Math.max(1, this.streak));
    let points = 100 + (bullseye ? 50 : 0) + (quick ? 100 : 0);
    points *= multiplier;
    this.score += points;
    this.ctx.hud.score(this.score);
    this.ctx.hud.hitMarker(aim.x, aim.y, bullseye ? "headshot" : "kill");
    const label = quick ? "Quick Draw" : bullseye ? "Bullseye" : "";
    this.ctx.hud.popup(aim.x, aim.y - 0.05, `+${points.toLocaleString("en-US")}${label ? ` ${label}` : ""}`, bullseye || quick ? "gold" : "");
    this.ctx.audio.play("hit_metal", { pan: aim.x * 2 - 1, distance: Math.hypot(plate.x, plate.z) });
    if (quick) this.ctx.audio.play("quick_draw", { delay: 0.08 });
    else if (this.streak > 1 && this.streak <= 4) this.ctx.audio.play("streak_up", { delay: 0.08 });
    this.lower(plate);
    this.readouts();
  }

  private finish(won: boolean): void {
    if (this.over) return;
    this.over = true;
    const accuracy = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    const stats: GameStats = {
      outcome: won ? "Survived" : `Fell on Wave ${this.wave}`,
      won,
      score: this.score,
      stats: [
        { label: "Waves", value: String(won ? this.wave : this.wave - 1) },
        { label: "Hits", value: String(this.hits) },
        { label: "Accuracy", value: `${accuracy}%` },
        { label: "Best Streak", value: String(this.bestStreak) },
      ],
      secretsFound: this.secrets,
      secretsTotal: 1,
    };
    this.ctx.hud.hint(null);
    this.ctx.audio.setFilter("hurt", 0);
    this.ctx.audio.play("game_over");
    this.stopWind?.();
    this.ctx.hud.gameOver(stats);
  }

  render(): void {
    this.ctx.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    // Keep the horizontal view from getting too narrow in a tall window.
    this.camera.fov = width / height < 1.2 ? 58 : 50;
    this.camera.updateProjectionMatrix();
    if (!this.started) this.calibration.layout(width, height);
  }

  pause(): void {}

  resume(): void {}

  dispose(): void {
    this.stopWind?.();
    this.ctx?.audio.setFilter("hurt", 0);
    this.scene?.traverse((object) => dispose(object));
    this.scene.clear();
  }
}

function dispose(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}

export async function createStubGame(options: StubOptions = {}): Promise<Game> {
  return new Range(options);
}
