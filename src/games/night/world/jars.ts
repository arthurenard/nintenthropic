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
import type { Sound } from "../../../engine/world/sound";
import type { Effects } from "./effects";
import type { RayHit, RoadQueries } from "./queries";
import { surfaceOf, type RoadLayout } from "./road";

interface Jar {
  id: string;
  group: Group;
  glass: MeshStandardMaterial;
  flame: Vector3;
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

const JAR_HEIGHT = 0.18;
const GLASS = new Color("#9fb8b0");
const GLOW = new Color(1.0, 0.55, 0.22);

const tmp = new Vector3();
const ndc = new Vector3();
const look = new Vector3();
const at = new Vector3();
const probe: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };

/** A mason jar's profile, turned on a lathe: a heavy base, straight sides, the shoulder, the threaded neck. */
function jarGeometry(): LatheGeometry {
  const pts = [
    [0.0, 0.0],
    [0.04, 0.0],
    [0.045, 0.008],
    [0.046, 0.12],
    [0.042, 0.145],
    [0.032, 0.158],
    [0.032, 0.172],
    [0.034, 0.175],
    [0.034, 0.18],
    [0.0, 0.18],
  ].map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(pts, 20);
}

/** Far jars are drawn a little larger so they read as targets. */
function jarScale(eye: Vector3, base: Vector3): number {
  const d = Math.hypot(base.x - eye.x, base.z - eye.z);
  return Math.min(2.6, Math.max(1.2, d / 9));
}

/** Can the eye see the middle and the shoulder of a jar standing at `base`? */
export function jarSeen(queries: Pick<RoadQueries, "cast">, eye: Vector3, base: Vector3): boolean {
  const s = jarScale(eye, base);
  for (const h of [0.08, 0.14]) {
    at.set(base.x, base.y + h * s, base.z);
    const seen = at.distanceTo(eye);
    look.copy(at).sub(eye).normalize();
    const hit = queries.cast(eye, look, seen + 0.5, probe);
    if (hit && hit.distance < seen - 0.2) return false;
  }
  return true;
}

/**
 * The aim check, as part of the night: nine mason jars on the fence posts,
 * the pump, the barricade and the bus, each with a candle stub glowing
 * inside. The one to shoot glows brighter and its candle flares; a good
 * shot bursts it into glass and a puff of wax smoke, a poor one kicks up
 * grit beside it. The flashlight stays on through the check.
 */
export class JarStage implements CalibrationStage {
  private readonly jars: Jar[] = [];
  private readonly targetList: CalibrationTarget[] = [];
  private lit: string | null = null;
  private hits = 0;
  private time = 0;
  active = true;
  private ended = false;

  constructor(
    road: RoadLayout,
    parent: Object3D,
    private readonly camera: PerspectiveCamera,
    private readonly fx: Effects,
    private readonly sound: Sound,
    private readonly queries: RoadQueries,
    private readonly eye: Vector3,
  ) {
    const geo = jarGeometry();
    const candleGeo = new CylinderGeometry(0.022, 0.024, 0.05, 10);
    const candleMat = new MeshStandardMaterial({ color: "#e8dcc4", roughness: 0.8, emissive: new Color(0.35, 0.18, 0.06), name: "candle" });
    road.calib.forEach((node, i) => {
      const glass = new MeshStandardMaterial({
        color: GLASS,
        roughness: 0.12,
        metalness: 0.1,
        transparent: true,
        opacity: 0.62,
        emissive: GLOW.clone().multiplyScalar(0.25),
        envMapIntensity: 1.2,
        name: "jar",
      });
      const g = new Group();
      const body = new Mesh(geo, glass);
      body.castShadow = true;
      const candle = new Mesh(candleGeo, candleMat);
      candle.position.y = 0.03;
      g.add(candle, body);
      const base = node.getWorldPosition(new Vector3());
      const scale = jarScale(this.eye, base);
      g.scale.setScalar(scale);
      g.position.copy(base);
      g.rotation.y = i * 1.3;
      parent.add(g);
      const id = `jar.${i + 1}`;
      const jar: Jar = {
        id,
        group: g,
        glass,
        flame: base.clone().add(new Vector3(0, 0.07 * scale, 0)),
        base,
        center: base.clone().add(new Vector3(0, 0.09 * scale, 0)),
        height: JAR_HEIGHT * scale,
        alive: true,
        hidden: false,
        fade: 1,
        target: { id, x: 0.5, y: 0.5, radius: 0.035 },
      };
      if (!jarSeen(queries, this.eye, base)) {
        console.info(`Dead of Night: calib.${i + 1} is hidden from the eye; its jar is left out of the aim check.`);
        g.visible = false;
        jar.alive = false;
        jar.hidden = true;
      }
      this.jars.push(jar);
    });
  }

  /** The jars' glass, for the night's fog. */
  get materials(): MeshStandardMaterial[] {
    return this.jars.map((j) => j.glass);
  }

  private find(id: string): Jar | undefined {
    return this.jars.find((j) => j.id === id);
  }

  targets(): CalibrationTarget[] {
    this.targetList.length = 0;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const minSide = Math.min(1, cam.aspect);
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    for (const j of this.jars) {
      if (!j.alive) continue;
      ndc.copy(j.center).project(cam);
      if (ndc.z > 1) continue;
      j.target.x = (ndc.x + 1) / 2;
      j.target.y = (1 - ndc.y) / 2;
      const dist = tmp.copy(j.center).sub(cam.position).length();
      const half = j.height / 2 / (dist * 2 * tanHalf * minSide);
      j.target.radius = Math.max(0.035, half);
      if (j.target.x < 0 || j.target.x > 1 || j.target.y < 0 || j.target.y > 1) continue;
      this.targetList.push(j.target);
    }
    return this.targetList;
  }

  light(id: string | null): void {
    this.lit = id;
  }

  hit(id: string): void {
    const j = this.find(id);
    if (!j || !j.alive) return;
    j.alive = false;
    j.group.visible = false;
    if (this.lit === id) this.lit = null;
    tmp.copy(j.center).sub(this.eye).normalize().negate();
    const floor = this.queries.groundAt(j.base.x, j.base.z, j.base.y + 0.05);
    this.fx.jar(j.center, tmp, floor);
    this.sound.at("night_jar_break", j.center, 1);
    // Each good hit a step up a minor pentatonic: the warm-up plays a little tune, in a darker key than the west's.
    const steps = [0, 3, 5, 7, 10, 12, 15, 17, 19];
    this.sound.play("calib_hit", { volume: 0.8, rate: Math.pow(2, ((steps[Math.min(steps.length - 1, this.hits)] as number) - 2) / 12) });
    this.hits++;
  }

  miss(id: string, x: number, y: number): void {
    const j = this.find(id);
    const cam = this.camera;
    ndc.set(x * 2 - 1, -(y * 2 - 1), 0.5).unproject(cam);
    tmp.copy(ndc).sub(cam.position).normalize();
    const hit = this.queries.cast(cam.position, tmp, 150, { point: new Vector3(), normal: new Vector3(), distance: 0, object: null });
    if (hit && (!j || hit.point.distanceTo(j.center) < 3)) {
      this.fx.impact(hit.object ? surfaceOf(hit.object) : "dirt", hit.point, hit.normal, hit.point.y - 0.5);
      this.sound.at("night_hit_ground", hit.point, 0.8);
      return;
    }
    if (!j) return;
    tmp.set(x < j.target.x ? -1 : 1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(0.12);
    at.copy(j.base).add(tmp);
    this.fx.puff(at, new Vector3(0, 1, 0), 0.4);
    this.sound.at("night_hit_ground", at, 0.8);
  }

  done(): void {
    if (this.ended) return;
    this.ended = true;
    this.lit = null;
    for (const j of this.jars) if (j.alive) j.fade = 0.999;
    this.sound.play("calib_done");
  }

  reset(): void {
    this.active = true;
    this.ended = false;
    this.hits = 0;
    for (const j of this.jars) {
      if (j.hidden) continue;
      j.alive = true;
      j.fade = 1;
      j.group.visible = true;
      j.group.scale.setScalar(j.height / JAR_HEIGHT);
      j.glass.opacity = 0.62;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const j of this.jars) {
      if (!j.alive) continue;
      const on = j.id === this.lit;
      // The candles flicker; the lit jar's flares and its glass glows.
      const flick = 0.8 + 0.2 * Math.sin(this.time * 17 + j.base.x * 3) * Math.sin(this.time * 5.3 + j.base.z);
      j.glass.emissive.copy(GLOW).multiplyScalar((on ? 0.9 + 0.3 * Math.sin(this.time * 6) : 0.22) * flick);
      if (j.fade >= 1) {
        const s = j.height / JAR_HEIGHT;
        this.fx.candle(j.flame, (on ? 1.7 : 0.9) * s * flick);
        if (on && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) {
          tmp.copy(j.center);
          tmp.y += j.height * 0.3;
          this.fx.glint(tmp, Math.max(0.1, tmp.distanceTo(this.camera.position) * 0.028));
        }
        continue;
      }
      // Leaving: sink and fade, quickly and quietly.
      j.fade = Math.max(0, j.fade - dt * 2.5);
      j.group.scale.setScalar((j.height / JAR_HEIGHT) * (0.6 + 0.4 * j.fade));
      j.glass.opacity = 0.62 * j.fade;
      if (j.fade <= 0) {
        j.alive = false;
        j.group.visible = false;
      }
    }
  }
}
