/**
 * The Test Range: the smallest whole game the platform can host, for the
 * end-to-end tests and the platform's own screenshots (dev and test builds
 * only; the arcade shows it with ?range=1). It is also a worked example of
 * the contract in a few hundred lines: an aim check on its own targets, a
 * timed round with a clock and readouts, a weapon in each of the HUD's
 * styles (?weapon=cylinder|magazine|heat), and a scope - the eye, Shift or
 * the right button - with its own reticle in place of the page's crosshair.
 */
import {
  CircleGeometry,
  Color,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import type { Aim, CalibrationStage, CalibrationTarget, Game, GameContext } from "../../engine/types";
import { PostFX } from "../../engine/world/post";

export type RangeWeapon = "cylinder" | "magazine" | "heat";

export interface RangeOptions {
  weapon?: RangeWeapon;
}

/** Where the targets stand, in viewport fractions: corners, edges and centre. */
const SPOTS: readonly [number, number][] = [
  [0.2, 0.26],
  [0.5, 0.22],
  [0.8, 0.26],
  [0.16, 0.5],
  [0.5, 0.5],
  [0.84, 0.5],
  [0.22, 0.72],
  [0.5, 0.74],
  [0.78, 0.72],
];
const DEPTH = 9;
const ROUND = 60;
const FOV = 50;
const SCOPED_FOV = 16;

interface Target {
  id: string;
  spot: readonly [number, number];
  group: Group;
  face: MeshBasicMaterial;
  up: boolean;
  /** Seconds until it stands up again, once shot in play. */
  down: number;
  target: CalibrationTarget;
}

/** A scope's picture over the world: black round a circle, a fine cross in it, where the aim is. */
const RETICLE = /* glsl */ `
uniform vec2 size;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * size;
  float r = min(size.x, size.y) * 0.34;
  float d = length(p);
  float outside = smoothstep(r - 1.5, r + 1.5, d);
  float cross = (1.0 - smoothstep(0.6, 1.4, abs(p.x))) + (1.0 - smoothstep(0.6, 1.4, abs(p.y)));
  cross *= 1.0 - smoothstep(r * 0.92, r * 0.94, d);
  cross *= step(r * 0.06, d);
  float alpha = max(outside, min(1.0, cross) * 0.85);
  gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`;

export class TestRange implements Game {
  readonly id = "range";
  readonly title = "Test Range";
  readonly calibration: CalibrationStage;
  private ctx!: GameContext;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 16 / 10, 0.1, 100);
  /** The unscoped lens, which the aim is read through while the scope looks where it points. */
  private readonly wide = new PerspectiveCamera(FOV, 16 / 10, 0.1, 100);
  private readonly look = new Vector3();
  private readonly overlay = new Scene();
  private readonly overlayCamera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
  private reticle!: ShaderMaterial;
  private post!: PostFX;
  private readonly targets: Target[] = [];
  private lit: string | null = null;
  private playing = false;
  private paused = false;
  private time = 0;
  private score = 0;
  private hits = 0;
  private scoped = false;
  private width = 1280;
  private height = 720;
  private readonly weapon: RangeWeapon;
  private rounds = 5;
  private action: "ready" | "cycling" | "open" = "ready";
  private cycling = 0;
  private reloading = 0;
  private heat = 0;
  private venting = 0;
  private reloadKey = false;
  private wasOffscreen = false;
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "r" && !event.repeat) this.reloadKey = true;
  };

  constructor(options: RangeOptions = {}) {
    this.weapon = options.weapon ?? "magazine";
    this.rounds = this.capacity;
    const stage: CalibrationStage = {
      begin: () => this.standAll(),
      targets: () => this.targets.filter((t) => t.up).map((t) => t.target),
      light: (id) => {
        this.lit = id;
        for (const t of this.targets) t.face.color.set(t.id === id ? "#ffffff" : "#e6e0d4");
      },
      hit: (id) => this.knock(id),
      miss: () => {},
      done: () => {
        this.lit = null;
        this.standAll();
      },
    };
    this.calibration = stage;
  }

  private get capacity(): number {
    return this.weapon === "cylinder" ? 6 : this.weapon === "magazine" ? 5 : 0;
  }

  async load(ctx: GameContext, onProgress: (fraction: number) => void): Promise<void> {
    this.ctx = ctx;
    ctx.renderer.outputColorSpace = SRGBColorSpace;
    const scene = this.scene;
    scene.background = new Color("#1d2430");
    scene.fog = new Fog("#1d2430", 12, 40);
    scene.add(new HemisphereLight("#dfe8f5", "#2a2520", 2.4));
    const floor = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: "#3a3f47", roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    scene.add(floor);
    const disc = new CircleGeometry(0.42, 48);
    const ring = new RingGeometry(0.27, 0.33, 48);
    const bull = new CircleGeometry(0.1, 32);
    const red = new MeshBasicMaterial({ color: "#d8412f" });
    SPOTS.forEach((spot, i) => {
      const group = new Group();
      const face = new MeshBasicMaterial({ color: "#e6e0d4" });
      group.add(new Mesh(disc, face));
      const r = new Mesh(ring, red);
      r.position.z = 0.002;
      const b = new Mesh(bull, red);
      b.position.z = 0.002;
      group.add(r, b);
      scene.add(group);
      this.targets.push({ id: `t${i}`, spot, group, face, up: true, down: 0, target: { id: `t${i}`, x: spot[0], y: spot[1], radius: 0.04 } });
    });
    this.reticle = new ShaderMaterial({
      uniforms: { size: { value: new Vector2(1280, 720) } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }",
      fragmentShader: RETICLE,
      transparent: true,
      depthTest: false,
    });
    const quad = new Mesh(new PlaneGeometry(1, 1), this.reticle);
    quad.frustumCulled = false;
    this.overlay.add(quad);
    this.post = new PostFX(ctx.renderer, scene, this.camera, ctx.quality, { bloom: false, hurt: false, sepia: false, flash: false });
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720, ctx.renderer.getPixelRatio());
    window.addEventListener("keydown", this.onKey);
    onProgress(1);
  }

  /** Every target back up, placed where its spot is in this view. */
  private standAll(): void {
    for (const t of this.targets) {
      t.up = true;
      t.down = 0;
      t.group.visible = true;
    }
    this.place();
  }

  private place(): void {
    this.wide.updateMatrixWorld();
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    const minSide = Math.min(1, this.wide.aspect);
    const at = new Vector3();
    for (const t of this.targets) {
      at.set(t.spot[0] * 2 - 1, 1 - t.spot[1] * 2, 0.5).unproject(this.wide).sub(this.wide.position).normalize();
      at.multiplyScalar(DEPTH / -at.z).add(this.wide.position);
      t.group.position.copy(at);
      t.target.radius = Math.max(0.035, 0.42 / (DEPTH * 2 * tanHalf * minSide));
    }
  }

  private knock(id: string): void {
    const t = this.targets.find((x) => x.id === id);
    if (!t || !t.up) return;
    t.up = false;
    t.group.visible = false;
    t.down = 1.2;
  }

  start(): void {
    this.playing = true;
    this.time = 0;
    this.score = 0;
    this.hits = 0;
    this.rounds = this.capacity;
    this.action = "ready";
    this.heat = 0;
    this.venting = 0;
    this.standAll();
    this.ctx.hud.score(0);
    this.showWeapon();
    this.showReadouts();
    this.ctx.hud.clock?.(ROUND);
    if (this.ctx.settings.unlocks.has("golden")) this.ctx.hud.weaponFinish?.("gold");
  }

  update(dt: number, _now: number, aim: Aim): void {
    if (this.paused) return;
    this.scope(aim);
    if (!this.playing) return;
    this.time += dt;
    const left = Math.max(0, ROUND - this.time);
    this.ctx.hud.clock?.(left, left <= 10 ? "warning" : "");
    for (const t of this.targets) {
      if (t.up) continue;
      t.down -= dt;
      if (t.down <= 0) {
        t.up = true;
        t.group.visible = true;
      }
    }
    this.gun(dt, aim);
    if (aim.fired && !aim.offscreen && this.canFire()) this.fire(aim);
    if (left <= 0) this.end();
  }

  /**
   * The scope: the lens closes in on where the aim points and follows it,
   * and the game's reticle, in the middle of the view, takes the page's
   * crosshair's place.
   */
  private scope(aim: Aim): void {
    const on = aim.scope && aim.tracking;
    if (on !== this.scoped) {
      this.scoped = on;
      this.ctx.hud.crosshair?.(on ? "none" : "default");
      this.camera.fov = on ? SCOPED_FOV : FOV;
      this.camera.updateProjectionMatrix();
      if (!on) this.camera.quaternion.copy(this.wide.quaternion);
    }
    if (on) {
      this.look.set(aim.x * 2 - 1, 1 - aim.y * 2, 0.5).unproject(this.wide);
      this.camera.lookAt(this.look);
    }
  }

  private gun(dt: number, aim: Aim): void {
    const reload = this.reloadKey || (aim.offscreen && !this.wasOffscreen);
    this.reloadKey = false;
    this.wasOffscreen = aim.offscreen;
    if (this.weapon === "heat") {
      if (this.venting > 0) {
        this.venting -= dt;
        this.heat = Math.max(0, this.heat - dt * 0.6);
        if (this.venting <= 0) this.venting = 0;
      } else {
        this.heat = Math.max(0, this.heat - dt * 0.35);
      }
      this.showWeapon();
      return;
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.rounds = this.capacity;
        this.action = "ready";
        this.showWeapon();
      }
      return;
    }
    if (reload && this.rounds < this.capacity) {
      this.reloading = 0.9;
      this.action = "open";
      this.ctx.hud.ammo(this.rounds, this.capacity, true, this.style());
      return;
    }
    if (this.cycling > 0) {
      this.cycling -= dt;
      if (this.cycling <= 0) {
        this.action = this.rounds > 0 ? "ready" : "open";
        this.showWeapon();
      }
    }
  }

  private canFire(): boolean {
    if (this.weapon === "heat") return this.venting <= 0;
    return this.reloading <= 0 && this.cycling <= 0 && this.rounds > 0;
  }

  private fire(aim: Aim): void {
    if (this.weapon === "heat") {
      this.heat = Math.min(1, this.heat + 0.2);
      if (this.heat >= 1) this.venting = 1.6;
    } else {
      this.rounds--;
      if (this.weapon === "magazine") {
        this.action = "cycling";
        this.cycling = 0.5;
      }
    }
    this.showWeapon();
    // A hit is a target whose disc the shot lands in: where the aim is, or
    // through the scope, in the middle of its picture.
    const minSide = Math.min(this.width, this.height);
    const zoom = this.scoped ? Math.tan((FOV * Math.PI) / 360) / Math.tan((SCOPED_FOV * Math.PI) / 360) : 1;
    const [ax, ay] = this.scoped ? [0.5, 0.5] : [aim.x, aim.y];
    for (const t of this.targets) {
      if (!t.up) continue;
      const p = t.group.position.clone().project(this.camera);
      const x = (p.x + 1) / 2;
      const y = (1 - p.y) / 2;
      if (Math.hypot((ax - x) * this.width, (ay - y) * this.height) / minSide <= t.target.radius * zoom) {
        this.knock(t.id);
        this.hits++;
        this.score += 100;
        this.ctx.hud.score(this.score);
        this.ctx.hud.hitMarker(ax, ay, "hit");
        this.showReadouts();
        return;
      }
    }
  }

  private style() {
    return this.weapon === "magazine" ? { kind: "magazine" as const, action: this.action } : { kind: "cylinder" as const };
  }

  private showWeapon(): void {
    if (this.weapon === "heat") this.ctx.hud.heat?.(this.heat, this.venting > 0);
    else this.ctx.hud.ammo(this.rounds, this.capacity, this.reloading > 0, this.style());
  }

  private showReadouts(): void {
    this.ctx.hud.readouts([{ label: "Targets", value: String(this.hits), meter: Math.min(1, this.hits / 20) }]);
  }

  private end(): void {
    this.playing = false;
    this.ctx.hud.clock?.(null);
    this.ctx.hud.gameOver({
      outcome: "Time",
      won: true,
      score: this.score,
      stats: [
        { label: "Targets", value: String(this.hits) },
        { label: "Seconds", value: String(ROUND) },
      ],
      secretsFound: 0,
      secretsTotal: 0,
    });
  }

  render(): void {
    const r = this.ctx.renderer;
    this.post.render(1 / 60);
    if (this.scoped) {
      r.autoClear = false;
      r.render(this.overlay, this.overlayCamera);
      r.autoClear = true;
    }
  }

  resize(width: number, height: number, _pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.wide.aspect = this.camera.aspect;
    this.wide.updateProjectionMatrix();
    this.post?.setSize(width, height);
    this.reticle?.uniforms.size!.value.set(width, height);
    this.place();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.post?.dispose();
  }

  /** For the tests: whether the scope's picture is up, and what the gun is doing. */
  get debug() {
    return { scoped: () => this.scoped, rounds: () => this.rounds, heat: () => this.heat, lit: () => this.lit };
  }
}
