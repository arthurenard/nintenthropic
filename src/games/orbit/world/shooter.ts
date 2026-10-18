/**
 * What a shot hits. The laser fires from the emitter outside, but it goes
 * where the player points: a ray from the eye through the crosshair, tested
 * against the debris (with an honest angular allowance - a finger is not a
 * mouse), the Derelict's tank and body, the drone (no allowance at all:
 * help never makes you shoot a friend), the secrets, and the sky - the
 * Moon, the storm and the city lights far below.
 */
import { Mesh, PerspectiveCamera, Raycaster, Vector2, Vector3, type Object3D } from "three";
import { assistAngle, assistFactor, secretFactor } from "../../../engine/rules/assist";
import { effectiveRadius, probePoint, type RayProbe } from "../../../engine/rules/raymath";
import type { Settings } from "../../../engine/types";
import type { Fragment } from "../rules/debris";
import { shootable, tankShows } from "../rules/debris";
import type { ShotTarget } from "../rules/match";
import type { SecretShot } from "../rules/secrets";
import type { DebrisView } from "./debrisView";
import type { SecretCandidate } from "./secretsWorld";

/**
 * How generous the aim is, as a fraction of the smaller side of the view:
 * a shot this close to a fragment counts, whatever its distance (the aim
 * check guarantees 95% of shots within 3.5%). The tank's is tighter, so the
 * Derelict is earned; the secrets' tighter still.
 *
 * These are the table at its base; the player's Aim Assist scales the debris
 * and the tank on every shot (engine/rules/assist.ts): wider on, exact off.
 * The secrets and the sky are never widened, and the drone is never helped.
 */
export const ASSIST = { debris: 0.026, tank: 0.018, secret: 0.012, sky: 0.02 } as const;

export interface ShotResult {
  target: ShotTarget;
  /** Where the beam ends. */
  point: Vector3;
  /** What it met, for the world's answer. */
  hit: "debris" | "tank" | "body" | "drone" | "secret" | "planet" | "station" | "nothing";
  /** The fragment, if one. */
  fragment: Fragment | null;
  distance: number;
}

export interface SkyTargets {
  /** The Moon's direction and angular radius, when it is up. */
  moon: { dir: Vector3; radius: number } | null;
  /** Where the ray meets the planet (in the planet's frame, unit), and whether that is by the storm or the HI in the dark. */
  planet(dir: Vector3): { storm: boolean; hi: boolean } | null;
}

const ndc = new Vector2();
const probe: RayProbe = { t: 0, miss: 0 };

export class Shooter {
  private readonly raycaster = new Raycaster();
  readonly result: ShotResult = { target: { kind: "none" }, point: new Vector3(), hit: "nothing", fragment: null, distance: 0 };
  private readonly solids: Mesh[] = [];

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly debris: DebrisView,
    station: Object3D,
    /** The player's settings, read on every shot: Aim Assist can change mid-round. */
    private readonly settings: Pick<Settings, "aimAssist">,
  ) {
    station.traverse((o) => {
      if ((o as Mesh).isMesh) this.solids.push(o as Mesh);
    });
  }

  /** Cast a shot through viewport position (x, y) in fractions. */
  shoot(
    x: number,
    y: number,
    t: number,
    fragments: readonly Fragment[],
    drone: { center: Vector3; radius: number } | null,
    secrets: readonly SecretCandidate[],
    sky: SkyTargets,
  ): ShotResult {
    const res = this.result;
    ndc.set(x * 2 - 1, -(y * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    // Aim Assist, live: the debris and the tank wider, or exact. A secret's allowance is never boosted.
    const boost = assistFactor(this.settings.aimAssist);
    const secretBy = secretFactor(this.settings.aimAssist);
    const aDebris = assistAngle(this.camera, ASSIST.debris * boost);
    const aTank = assistAngle(this.camera, ASSIST.tank * boost);
    const aSecret = assistAngle(this.camera, ASSIST.secret * secretBy);

    // 1. Debris and the Derelict: the best-aimed within its allowance.
    let best: { f: Fragment; kind: "debris" | "tank" | "body"; t: number; score: number; center: Vector3 } | null = null;
    for (const f of fragments) {
      if (!f.flying) continue;
      const b = this.debris.bounds(f.id);
      if (!b) continue;
      if (f.kind === "derelict") {
        const tank = this.debris.tankAt(f.id, new Vector3());
        if (tank && tankShows(f, t, o)) {
          probePoint(o, d, tank, probe);
          const r = effectiveRadius(0.55 * (b.radius / 2.1), probe.t, aTank);
          if (probe.t > 0 && probe.miss <= r) {
            const score = probe.miss / r - 0.5;
            if (!best || score < best.score) best = { f, kind: "tank", t: probe.t, score, center: tank };
            continue;
          }
        }
        probePoint(o, d, b.center, probe);
        if (probe.t > 0 && probe.miss <= b.radius * 0.8) {
          const score = probe.miss / b.radius + 0.4;
          if (!best || score < best.score) best = { f, kind: "body", t: probe.t, score, center: b.center.clone() };
        }
        continue;
      }
      // A shard edge-on is a sliver: only its own thickness, no allowance.
      const edgeOn = f.kind === "shard" && !shootable(f, t, o);
      probePoint(o, d, b.center, probe);
      if (probe.t <= 0) continue;
      const r = edgeOn ? b.radius * 0.08 : effectiveRadius(b.radius, probe.t, aDebris);
      if (probe.miss > r) continue;
      // Nearer the middle of the zone wins; a real hit beats a near one.
      const score = probe.miss / r + (probe.miss <= b.radius ? -1 : 0);
      if (!best || score < best.score) best = { f, kind: "debris", t: probe.t, score, center: b.center.clone() };
    }

    // 2. The drone: only a real hit.
    let droneT = Infinity;
    if (drone) {
      probePoint(o, d, drone.center, probe);
      if (probe.t > 0 && probe.miss <= drone.radius) droneT = probe.t;
    }
    // The drone in front of the debris takes the shot.
    if (droneT < Infinity && (!best || droneT < best.t)) {
      res.target = { kind: "drone" };
      res.point.copy(drone!.center);
      res.hit = "drone";
      res.fragment = null;
      res.distance = droneT;
      return res;
    }
    if (best) {
      res.fragment = best.f;
      res.distance = best.t;
      res.point.copy(best.center);
      res.hit = best.kind;
      res.target = best.kind === "debris" ? { kind: "debris", id: best.f.id, distance: best.t } : best.kind === "tank" ? { kind: "tank", id: best.f.id, distance: best.t } : { kind: "body", id: best.f.id, distance: best.t };
      return res;
    }

    // 3. The secrets.
    res.fragment = null;
    for (const s of secrets) {
      probePoint(o, d, s.center, probe);
      if (probe.t <= 0) continue;
      const r = effectiveRadius(s.radius, probe.t, aSecret);
      let shot: SecretShot | null = null;
      if (probe.miss <= r) shot = s.id === "astronaut" ? { secret: "astronaut", at: true } : { secret: s.id };
      else if (s.near > 0 && probe.miss <= s.near) shot = s.id === "astronaut" ? { secret: "astronaut", at: false } : s.id === "capsule" ? { secret: "capsule" } : null;
      if (!shot) continue;
      res.target = { kind: "secret", shot };
      res.point.copy(o).addScaledVector(d, probe.t);
      res.hit = "secret";
      res.distance = probe.t;
      return res;
    }

    // 4. The sky: the Moon (only in open sky: still under the limb, the
    // planet is in front of it), the storm, the "HI".
    const ground = sky.planet(d);
    if (!ground && sky.moon && d.angleTo(sky.moon.dir) <= sky.moon.radius * 1.3 + assistAngle(this.camera, ASSIST.sky * secretBy)) {
      res.target = { kind: "secret", shot: { secret: "moon" } };
      res.point.copy(o).addScaledVector(d, 300);
      res.hit = "secret";
      res.distance = 300;
      return res;
    }
    if (ground && (ground.storm || ground.hi)) {
      res.target = { kind: "secret", shot: { secret: ground.storm ? "storm" : "message" } };
      res.point.copy(o).addScaledVector(d, 300);
      res.hit = "planet";
      res.distance = 300;
      return res;
    }

    // 5. Nothing: the beam ends on the station if it meets it, or runs out into the dark.
    res.target = { kind: "none" };
    this.raycaster.far = 200;
    const hits = this.raycaster.intersectObjects(this.solids, false);
    const h = hits[0];
    if (h) {
      res.point.copy(h.point);
      res.hit = "station";
      res.distance = h.distance;
    } else {
      res.point.copy(o).addScaledVector(d, 260);
      res.hit = "nothing";
      res.distance = 260;
    }
    return res;
  }
}
