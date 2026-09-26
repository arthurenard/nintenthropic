import {
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { CalibrationStage, CalibrationTarget } from "../../../engine/types";
import type { Effects } from "./effects";
import type { RayHit, TownQueries } from "./queries";
import type { Sound } from "./sound";
import { surfaceOf, type TownLayout } from "./town";

interface Bottle {
  id: string;
  group: Group;
  glass: MeshStandardMaterial;
  color: Color;
  liquid: Color;
  readonly base: Vector3;
  readonly center: Vector3;
  height: number;
  alive: boolean;
  /** Not visible from the eye: never offered as a target. */
  hidden: boolean;
  /** Fading out at the end of the check, 1 → 0. */
  fade: number;
  target: CalibrationTarget;
}

const PALETTE: [string, string][] = [
  ["#2f6b3a", "#7a4a1a"], // green glass, whiskey
  ["#8a4b16", "#6a3a12"], // amber
  ["#b8c9c4", "#c9a86a"], // clear, rye
  ["#4a2a14", "#3a1f0e"], // brown
  ["#3f7c6c", "#8f6a2a"], // teal
];

const tmp = new Vector3();
const tmp2 = new Vector3();
const ndc = new Vector3();

/** A whiskey bottle's profile, turned on a lathe. */
function bottleGeometry(): LatheGeometry {
  const pts = [
    [0.0, 0.0],
    [0.036, 0.0],
    [0.041, 0.01],
    [0.042, 0.17],
    [0.036, 0.2],
    [0.018, 0.235],
    [0.013, 0.25],
    [0.013, 0.29],
    [0.016, 0.295],
    [0.016, 0.305],
    [0.0, 0.305],
  ].map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(pts, 18);
}

const BOTTLE_HEIGHT = 0.305;

/** Far bottles are drawn a little larger so they read as targets. */
function bottleScale(eye: Vector3, base: Vector3): number {
  const d = Math.hypot(base.x - eye.x, base.z - eye.z);
  return Math.min(1.7, Math.max(1, d / 11));
}

const probe: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
const look = new Vector3();
const at = new Vector3();

/** Can the eye see the middle and the shoulder of a bottle standing at `base`? */
export function bottleSeen(queries: Pick<TownQueries, "cast">, eye: Vector3, base: Vector3): boolean {
  const s = bottleScale(eye, base);
  for (const h of [0.15, 0.22]) {
    at.set(base.x, base.y + h * s, base.z);
    const seen = at.distanceTo(eye);
    look.copy(at).sub(eye).normalize();
    const hit = queries.cast(eye, look, seen + 0.5, probe);
    if (hit && hit.distance < seen - 0.25) return false;
  }
  return true;
}

/**
 * Stricter, for a spot the game picks: the whole bottle and a hand's width
 * either side of it are in view, so it is not peeping round a post.
 */
function inPlainView(queries: Pick<TownQueries, "cast">, eye: Vector3, base: Vector3): boolean {
  const s = bottleScale(eye, base);
  const sx = -(base.z - eye.z);
  const sz = base.x - eye.x;
  const len = Math.hypot(sx, sz) || 1;
  for (const [h, side] of [[0.04, 0], [0.15, 0], [0.28, 0], [0.12, -0.12], [0.12, 0.12]] as const) {
    at.set(base.x + (sx / len) * side * s, base.y + h * s, base.z + (sz / len) * side * s);
    const seen = at.distanceTo(eye);
    look.copy(at).sub(eye).normalize();
    const hit = queries.cast(eye, look, seen + 0.5, probe);
    if (hit && hit.distance < seen - 0.08) return false;
  }
  return true;
}

/**
 * Somewhere near where the art wanted a bottle (seen from the eye, within a
 * few degrees of it) that one can stand on: a flat, level top wide enough for
 * its base, with room above it, that the eye can see. Searched in rings
 * outward from the wanted direction, so the nearest one wins. Null if none.
 */
export function findStand(queries: Pick<TownQueries, "cast" | "groundAt">, eye: Vector3, wanted: Vector3, reachDeg = 5): Vector3 | null {
  const dir = wanted.clone().sub(eye).normalize();
  const yaw = Math.atan2(dir.x, -dir.z);
  const pitch = Math.asin(dir.y);
  const step = (0.1 * Math.PI) / 180;
  const reach = (reachDeg * Math.PI) / 180;
  const ray = new Vector3();
  const up = new Vector3(0, 1, 0);
  const hit: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
  const far = wanted.distanceTo(eye) + 30;
  for (let r = 0; r <= reach; r += step) {
    const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / step);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const y = yaw + r * Math.cos(a);
      const p = pitch + r * Math.sin(a);
      ray.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
      const h = queries.cast(eye, ray, far, hit);
      if (!h || h.distance < 4 || h.normal.y < 0.9) continue;
      const base = h.point.clone();
      // Level under the whole base, not the lip of an edge.
      let level = true;
      for (const [dx, dz] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]] as const) {
        if (Math.abs(queries.groundAt(base.x + dx, base.z + dz, base.y + 0.2) - base.y) > 0.03) level = false;
      }
      if (!level) continue;
      // Room for the bottle above it, and in plain view.
      at.set(base.x, base.y + 0.01, base.z);
      if (queries.cast(at, up, BOTTLE_HEIGHT * bottleScale(eye, base) + 0.05, probe)) continue;
      if (!inPlainView(queries, eye, base)) continue;
      return base;
    }
  }
  return null;
}

/**
 * The aim check, as part of the game: "warm up on the bottles before the gang
 * rides in". A bottle stands at each of the town's `calib.*` spots; the one
 * to shoot glints in the sun; a good shot breaks it — glass, a splash of
 * whiskey — and a poor one kicks up dust beside it.
 */
export class BottleStage implements CalibrationStage {
  private readonly bottles: Bottle[] = [];
  private readonly targetList: CalibrationTarget[] = [];
  private lit: string | null = null;
  private hits = 0;
  private glintTimer = 0;
  private time = 0;
  active = true;
  /** This check has been ended (done) and not begun again. */
  private ended = false;

  constructor(
    private readonly town: TownLayout,
    parent: Object3D,
    private readonly camera: PerspectiveCamera,
    private readonly fx: Effects,
    private readonly sound: Sound,
    private readonly queries: TownQueries,
  ) {
    const geo = bottleGeometry();
    const cork = new CylinderGeometry(0.013, 0.012, 0.025, 8);
    const label = new CylinderGeometry(0.0425, 0.0425, 0.07, 18, 1, true);
    const liquidGeo = new CylinderGeometry(0.036, 0.036, 0.15, 14);
    const corkMat = new MeshStandardMaterial({ color: "#8a6a44", roughness: 0.9 });
    const labelMat = new MeshStandardMaterial({ color: "#e8dcc0", roughness: 0.8 });
    town.calib.forEach((node, i) => {
      const [glassHex, liquidHex] = PALETTE[i % PALETTE.length] as [string, string];
      const color = new Color(glassHex);
      const glass = new MeshStandardMaterial({
        color,
        roughness: 0.08,
        metalness: 0.15,
        transparent: true,
        opacity: 0.72,
        envMapIntensity: 1.6,
        name: "bottle",
      });
      const liquid = new Color(liquidHex);
      const g = new Group();
      const body = new Mesh(geo, glass);
      body.castShadow = true;
      const juice = new Mesh(liquidGeo, new MeshStandardMaterial({ color: liquid, roughness: 0.3 }));
      juice.position.y = 0.085;
      const c = new Mesh(cork, corkMat);
      c.position.y = 0.31;
      const l = new Mesh(label, labelMat);
      l.position.y = 0.1;
      g.add(juice, body, c, l);
      let base = node.getWorldPosition(new Vector3());
      // A spot the eye cannot see (behind a sign's cap, or a stack of crates
      // set down in front of it since) gets the nearest ledge the eye can.
      if (!bottleSeen(queries, town.eye, base)) {
        const stand = findStand(queries, town.eye, base);
        console.info(
          stand
            ? `High Noon: calib.${i + 1} is hidden from the eye; its bottle stands on the nearest ledge in view instead.`
            : `High Noon: calib.${i + 1} is hidden from the eye and has no ledge in view near it; its bottle is left out of the aim check.`,
        );
        if (stand) base = stand;
      }
      const scale = bottleScale(town.eye, base);
      g.scale.setScalar(scale);
      g.position.copy(base);
      g.rotation.y = i * 1.7;
      parent.add(g);
      const id = `bottle.${i + 1}`;
      const b: Bottle = {
        id,
        group: g,
        glass,
        color,
        liquid,
        base,
        center: base.clone().add(new Vector3(0, 0.15 * scale, 0)),
        height: 0.305 * scale,
        alive: true,
        hidden: false,
        fade: 1,
        target: { id, x: 0.5, y: 0.5, radius: 0.035 },
      };
      // A bottle the player cannot see is no target: it is left out.
      if (!bottleSeen(queries, town.eye, base)) {
        g.visible = false;
        b.alive = false;
        b.hidden = true;
      }
      this.bottles.push(b);
    });
  }

  private find(id: string): Bottle | undefined {
    return this.bottles.find((b) => b.id === id);
  }

  /** Where each standing bottle is on screen, and how big its centre zone is. */
  targets(): CalibrationTarget[] {
    this.targetList.length = 0;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const minSide = Math.min(1, cam.aspect);
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    for (const b of this.bottles) {
      if (!b.alive) continue;
      ndc.copy(b.center).project(cam);
      if (ndc.z > 1) continue;
      b.target.x = (ndc.x + 1) / 2;
      b.target.y = (1 - ndc.y) / 2;
      // Half the bottle's height, as a fraction of the smaller view side;
      // never below the 3.5% the aim score is measured against.
      const dist = tmp.copy(b.center).sub(cam.position).length();
      const half = b.height / 2 / (dist * 2 * tanHalf * minSide);
      b.target.radius = Math.max(0.035, half);
      if (b.target.x < 0 || b.target.x > 1 || b.target.y < 0 || b.target.y > 1) continue;
      this.targetList.push(b.target);
    }
    return this.targetList;
  }

  light(id: string | null): void {
    this.lit = id;
    this.glintTimer = 0;
    for (const b of this.bottles) {
      const on = b.id === id;
      b.glass.emissive.copy(b.color).multiplyScalar(on ? 0.35 : 0);
    }
  }

  hit(id: string): void {
    const b = this.find(id);
    if (!b || !b.alive) return;
    b.alive = false;
    b.group.visible = false;
    if (this.lit === id) this.lit = null;
    tmp.copy(b.center).sub(this.town.eye).normalize().negate();
    const floor = this.queries.groundAt(b.base.x, b.base.z, b.base.y + 0.05);
    this.fx.glass(b.center, tmp, b.color, 22, floor);
    this.fx.liquid(b.center, b.liquid);
    this.sound.at("bottle_break", b.center, 1);
    // Each good hit a step up the pentatonic scale: the warm-up plays a little tune.
    const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    this.sound.play("calib_hit", { volume: 0.8, rate: Math.pow(2, (steps[Math.min(steps.length - 1, this.hits)] as number) / 12) });
    this.hits++;
  }

  miss(id: string, x: number, y: number): void {
    const b = this.find(id);
    // Dust where the shot went, if it hit the town near the bottle; else beside it.
    const cam = this.camera;
    ndc.set(x * 2 - 1, -(y * 2 - 1), 0.5).unproject(cam);
    tmp.copy(ndc).sub(cam.position).normalize();
    const hit = this.queries.cast(cam.position, tmp, 120, { point: new Vector3(), normal: new Vector3(), distance: 0, object: null });
    if (hit && (!b || hit.point.distanceTo(b.center) < 3)) {
      this.fx.impact(hit.object ? surfaceOf(hit.object) : "dirt", hit.point, hit.normal, hit.point.y - 0.5);
      this.sound.at("hit_dirt", hit.point, 0.8);
      return;
    }
    if (!b) return;
    // Beside the bottle, on the side the shot went.
    tmp2.set(x < b.target.x ? -1 : 1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(0.12);
    tmp.copy(b.base).add(tmp2);
    this.fx.dust(tmp, new Vector3(0, 1, 0), 0.5);
    this.sound.at("hit_dirt", tmp, 0.8);
  }

  done(): void {
    // The host ends the check, and play starting ends it again: the bottles
    // fade and the chime sounds once per check, not once per call.
    if (this.ended) return;
    this.ended = true;
    this.lit = null;
    for (const b of this.bottles) {
      b.glass.emissive.setScalar(0);
      if (b.alive) b.fade = 0.999;
    }
    this.sound.play("calib_done");
  }

  /** Stand every bottle back up (a new aim check). */
  reset(): void {
    this.active = true;
    this.ended = false;
    this.hits = 0;
    for (const b of this.bottles) {
      if (b.hidden) continue;
      b.alive = true;
      b.fade = 1;
      b.group.visible = true;
      b.group.scale.setScalar(b.height / 0.305);
      b.glass.opacity = 0.72;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.bottles) {
      if (!b.alive || b.fade >= 1) continue;
      // Leaving: sink and fade, quickly and quietly.
      b.fade = Math.max(0, b.fade - dt * 2.5);
      const s = (b.height / 0.305) * (0.6 + 0.4 * b.fade);
      b.group.scale.setScalar(s);
      b.glass.opacity = 0.72 * b.fade;
      if (b.fade <= 0) {
        b.alive = false;
        b.group.visible = false;
      }
    }
    if (this.lit) {
      const b = this.find(this.lit);
      if (b && b.alive) {
        b.glass.emissive.copy(b.color).multiplyScalar(0.25 + 0.15 * Math.sin(this.time * 5));
        this.glintTimer -= dt;
        if (this.glintTimer <= 0) {
          this.glintTimer = 0.55;
          tmp.copy(b.center);
          tmp.y += b.height * 0.28;
          const d = tmp.distanceTo(this.camera.position);
          this.fx.glint(tmp, Math.max(0.1, d * 0.03));
        }
      }
    }
  }

  get finished(): boolean {
    return this.bottles.every((b) => !b.alive);
  }
}
