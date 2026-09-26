/**
 * The stand-in's aim check: nine bottles on posts, placed so that in the
 * player's view they cover the corners, the edges and the middle. The lit one
 * glows; a good shot breaks it into flying shards, a miss kicks up a puff of
 * dust where the shot landed.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from "three";
import type { AudioBus, CalibrationStage, CalibrationTarget } from "../../engine/types";
import { post } from "./world";

/** Where the bottles sit in the view, in viewport fractions, and how far away. */
const LAYOUT: [number, number, number][] = [
  [0.14, 0.22, 8],
  [0.5, 0.2, 9],
  [0.86, 0.22, 8],
  [0.12, 0.5, 10],
  [0.5, 0.47, 12],
  [0.88, 0.5, 10],
  [0.16, 0.72, 4.5],
  [0.5, 0.73, 4.5],
  [0.84, 0.72, 4.5],
];
const BOTTLE_RADIUS = 0.1;
/** A bottle's profile, turned on a lathe: base, body, shoulder, neck, lip. */
const PROFILE = [
  [0, 0],
  [0.09, 0],
  [0.1, 0.02],
  [0.1, 0.26],
  [0.085, 0.32],
  [0.04, 0.38],
  [0.032, 0.5],
  [0.038, 0.52],
  [0.03, 0.54],
  [0, 0.54],
].map(([x, y]) => new Vector2(x, y));

/** A soft round glow, drawn once: bright in the middle, gone at the edge. */
function glowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255, 240, 200, 1)");
  gradient.addColorStop(0.35, "rgba(255, 220, 150, 0.45)");
  gradient.addColorStop(1, "rgba(255, 200, 120, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}
const glass = (tint: string) =>
  new MeshStandardMaterial({ color: tint, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 });

interface Bottle {
  id: string;
  group: Group;
  body: Mesh;
  glow: Sprite;
  lit: boolean;
  broken: boolean;
  place: [number, number, number];
}

interface Particle {
  mesh: Mesh;
  velocity: Vector3;
  spin: Vector3;
  life: number;
  age: number;
  grow: number;
}

export class BottleStage implements CalibrationStage {
  readonly root = new Group();
  private readonly bottles: Bottle[] = [];
  private readonly particles: Particle[] = [];
  private width = 1;
  private height = 1;
  private readonly ray = new Raycaster();
  private clearing = 0;
  /** Good shots in a row, for the rising ting. */
  private run = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly reducedMotion: boolean,
    private readonly audio: AudioBus,
  ) {
    const halo = glowTexture();
    LAYOUT.forEach((place, index) => {
      const group = new Group();
      const tint = ["#3f8f4a", "#8a5a2b", "#4b7fa8"][index % 3]!;
      const body = new Mesh(new LatheGeometry(PROFILE, 24), glass(tint));
      const glow = new Sprite(
        new SpriteMaterial({ map: halo, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
      );
      glow.scale.setScalar(0.9);
      glow.position.set(0, 0.28, -0.06);
      group.add(glow, body);
      this.bottles.push({ id: `bottle.${index + 1}`, group, body, glow, lit: false, broken: false, place });
      this.root.add(group);
    });
    scene.add(this.root);
  }

  /** Puts each bottle, on its post, where its place in the view says. */
  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.updateMatrixWorld();
    for (const bottle of this.bottles) {
      const [x, y, depth] = bottle.place;
      const ndc = new Vector2(x * 2 - 1, 1 - y * 2);
      this.ray.setFromCamera(ndc, this.camera);
      const point = this.ray.ray.origin.clone().addScaledVector(this.ray.ray.direction, depth / Math.max(0.2, -this.ray.ray.direction.z));
      // The bottle's middle sits on the aim point; its post runs to the ground.
      bottle.group.position.set(point.x, point.y - 0.28, point.z);
      bottle.group.children.filter((child) => child.userData.post).forEach((child) => bottle.group.remove(child));
      const height = Math.max(0.05, point.y - 0.28);
      const stand = post(height);
      stand.position.y = -height / 2;
      stand.userData.post = true;
      bottle.group.add(stand);
    }
  }

  targets(): CalibrationTarget[] {
    const side = Math.min(this.width, this.height);
    return this.bottles
      .filter((bottle) => !bottle.broken || bottle.lit)
      .map((bottle) => {
        const centre = bottle.group.localToWorld(new Vector3(0, 0.28, 0));
        const edge = bottle.group.localToWorld(new Vector3(BOTTLE_RADIUS * 1.6, 0.28, 0));
        const a = centre.clone().project(this.camera);
        const b = edge.clone().project(this.camera);
        const radius = (Math.abs(b.x - a.x) / 2) * this.width;
        return { id: bottle.id, x: (a.x + 1) / 2, y: (1 - a.y) / 2, radius: radius / side };
      });
  }

  light(id: string | null): void {
    for (const bottle of this.bottles) {
      bottle.lit = bottle.id === id;
      // A broken bottle comes back when it is wanted again.
      if (bottle.lit && bottle.broken) {
        bottle.broken = false;
        bottle.group.visible = true;
      }
    }
  }

  hit(id: string): void {
    const bottle = this.bottles.find((b) => b.id === id);
    if (!bottle) return;
    bottle.broken = true;
    bottle.lit = false;
    bottle.group.visible = false;
    const centre = bottle.group.localToWorld(new Vector3(0, 0.28, 0));
    this.audio.play("bottle_break", { pan: Math.max(-1, Math.min(1, centre.x / 6)), distance: centre.length() });
    // Each good shot in a row rings a whole tone higher, up to an octave.
    this.run = Math.min(this.run + 1, 7);
    this.audio.play("calib_hit", { rate: 2 ** ((2 * (this.run - 1)) / 12) });
    const material = bottle.body.material as MeshStandardMaterial;
    const shards = this.reducedMotion ? 6 : 16;
    for (let i = 0; i < shards; i++) {
      const shard = new Mesh(new ConeGeometry(0.03 + Math.random() * 0.03, 0.08, 3), material.clone());
      shard.position.copy(centre);
      this.scene.add(shard);
      const speed = this.reducedMotion ? 0.6 : 2.5;
      this.particles.push({
        mesh: shard,
        velocity: new Vector3((Math.random() - 0.5) * speed * 2, Math.random() * speed * 1.4 + 0.5, (Math.random() - 0.3) * speed),
        spin: new Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
        life: 0.9,
        age: 0,
        grow: 0,
      });
    }
    // A bottle broken during the check stands again a moment later, so a
    // check that goes round the targets twice still has them.
    window.setTimeout(() => {
      if (bottle.broken && !this.clearing) {
        bottle.broken = false;
        bottle.group.visible = true;
      }
    }, 900);
  }

  miss(_id: string, x: number, y: number): void {
    // A puff of dust where the shot went, on the ground or the backstop.
    this.ray.setFromCamera(new Vector2(x * 2 - 1, 1 - y * 2), this.camera);
    const direction = this.ray.ray.direction;
    const distance = direction.y < -0.02 ? Math.min(40, this.camera.position.y / -direction.y) : 25;
    const point = this.ray.ray.origin.clone().addScaledVector(direction, distance);
    this.run = 0;
    this.audio.play("hit_dirt", { pan: Math.max(-1, Math.min(1, point.x / 8)), distance });
    const puff = new Mesh(
      new CircleGeometry(0.35, 24),
      new MeshBasicMaterial({ color: new Color("#d8b48a"), transparent: true, opacity: 0.8, depthWrite: false }),
    );
    puff.position.copy(point);
    puff.lookAt(this.camera.position);
    this.scene.add(puff);
    this.particles.push({ mesh: puff, velocity: new Vector3(0, 0.5, 0), spin: new Vector3(), life: 0.7, age: 0, grow: 1.6 });
  }

  /** The check is over: the bottles sink away, to the check's closing flourish. */
  done(): void {
    if (this.clearing) return;
    this.audio.play("calib_done");
    this.clear();
  }

  /** Clears the stage without a word: for a game begun without an aim check (the mouse). */
  clear(): void {
    if (this.clearing) return;
    this.clearing = 1;
    for (const bottle of this.bottles) bottle.lit = false;
  }

  update(dt: number, now: number): void {
    for (const bottle of this.bottles) {
      const glow = bottle.glow.material;
      const target = bottle.lit ? 0.75 + (this.reducedMotion ? 0 : 0.2 * Math.sin(now / 180)) : 0;
      glow.opacity += (target - glow.opacity) * Math.min(1, dt * 10);
    }
    if (this.clearing > 0) {
      // The check is over: the bottles sink away for the game.
      this.clearing = Math.min(2, this.clearing + dt);
      const t = this.clearing - 1;
      this.root.position.y = -t * 3;
      if (t >= 1) this.root.visible = false;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]!;
      particle.age += dt;
      particle.velocity.y -= particle.grow ? 0 : 9.8 * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.rotation.x += particle.spin.x * dt;
      particle.mesh.rotation.y += particle.spin.y * dt;
      if (particle.grow) particle.mesh.scale.setScalar(1 + particle.grow * (particle.age / particle.life));
      const material = particle.mesh.material as MeshBasicMaterial;
      material.opacity = Math.max(0, 1 - particle.age / particle.life) * (particle.grow ? 0.8 : 0.88);
      if (particle.age >= particle.life) {
        this.scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}
