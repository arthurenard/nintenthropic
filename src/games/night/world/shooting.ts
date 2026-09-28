import { Box3, Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from "three";
import { effectiveRadius, probePoint, probeSegment, type RayProbe } from "../../../engine/rules/raymath";
import type { Dead } from "../rules/dead";
import type { ShotTarget } from "../rules/match";
import type { SignLetter } from "../rules/secrets";
import type { Survivor } from "../rules/survivors";
import type { HitPart } from "../rules/types";
import type { Cast } from "./cast";
import type { RayHit, RoadQueries } from "./queries";
import { surfaceOf, type RoadLayout, type Surface } from "./road";

/**
 * How generous the aim is, as a fraction of the smaller side of the view:
 * a shot this close to a target counts, whatever its distance. A finger is
 * not a mouse (the aim check guarantees 95% of shots within 3.5%), so the
 * torso's zone is wide; the head's is tight, so a headshot is still earned;
 * survivors get no help at all - assistance never makes you shoot one.
 */
export const ASSIST = {
  torso: 0.024,
  head: 0.009,
  /** A crawler is small and low: a little more help finding it. */
  crawler: 0.03,
  secret: 0.012,
  moon: 0.01,
} as const;

export interface ShotResult {
  target: ShotTarget;
  point: Vector3;
  normal: Vector3;
  surface: Surface;
  part: HitPart | null;
  distance: number;
  /** The bullet stopped in the road's scenery (not in one of the dead, a survivor or a secret). */
  scenery: boolean;
}

/** What else a bullet can find, from the world round the cast. */
export interface ShootableWorld {
  survivors(): readonly { s: Survivor; joints: () => import("../../../engine/world/character").Joints }[];
  /** Where the cat is now (a shot near it startles it), or null. */
  cat(): Vector3 | null;
  /** The projector's lamp on the hill, only while the fog is thin enough to see it. */
  driveInVisible(): boolean;
  /** The scarecrow, while it is still there. */
  scarecrowHere(): boolean;
}

const ndc = new Vector2();
const probe: RayProbe = { t: 0, miss: 0 };
const closest = new Vector3();
const tmp = new Vector3();
const hitBox = new Vector3();

interface Candidate {
  kind: "dead" | "survivor" | "secret";
  t: number;
  score: number;
  physical: boolean;
  dead: Dead | null;
  survivor: Survivor | null;
  secret: ShotTarget | null;
  part: HitPart;
}

const PRIORITY: Record<Candidate["kind"], number> = { dead: 0, survivor: 1, secret: 2 };

/** The cat's body, metres from its middle, and how near a shot must pass to startle it. */
const CAT_BODY = 0.2;
const CAT_NEAR = 0.45;

function blank(): Candidate {
  return { kind: "dead", t: 0, score: 0, physical: false, dead: null, survivor: null, secret: null, part: "body" };
}

/**
 * A shot through the crosshair: against the road (the engine's grid), the
 * dead (a head sphere, a torso capsule, the limbs, from their joints), a
 * survivor, and the night's secrets. A real hit on anything wins, nearest
 * first; otherwise the best near miss the aim assist allows; otherwise the
 * road. The corn and the glass never stop a bullet.
 */
export class Shooter {
  private readonly raycaster = new Raycaster();
  private readonly roadHit: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
  private readonly candidates: Candidate[] = [];
  private readonly letterBoxes = new Map<SignLetter, Box3>();
  private readonly box = new Box3();
  readonly result: ShotResult = {
    target: { kind: "none" },
    point: new Vector3(),
    normal: new Vector3(),
    surface: "asphalt",
    part: null,
    distance: 0,
    scenery: false,
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly queries: RoadQueries,
    private readonly road: RoadLayout,
    private readonly cast: Cast,
    private readonly world: ShootableWorld,
  ) {
    for (let i = 0; i < 24; i++) this.candidates.push(blank());
    road.root.updateMatrixWorld(true);
    for (const [letter, node] of road.secrets.sign) this.letterBoxes.set(letter, new Box3().setFromObject(node).expandByScalar(0.06));
  }

  /** One fraction of the smaller view side, as a tangent of angle. */
  private tanFor(fraction: number): number {
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    return fraction * 2 * tanHalf * Math.min(1, this.camera.aspect);
  }

  shoot(x: number, y: number): ShotResult {
    const res = this.result;
    ndc.set(x * 2 - 1, -(y * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    const road = this.queries.cast(o, d, 400, this.roadHit);
    const roadT = road ? road.distance : Number.POSITIVE_INFINITY;

    let n = 0;
    const add = (): Candidate => {
      let c = this.candidates[n];
      if (!c) {
        c = blank();
        this.candidates.push(c);
      }
      n++;
      c.dead = null;
      c.survivor = null;
      c.secret = null;
      c.part = "body";
      return c;
    };

    const aTorso = Math.atan(this.tanFor(ASSIST.torso));
    const aHead = Math.atan(this.tanFor(ASSIST.head));
    const aCrawler = Math.atan(this.tanFor(ASSIST.crawler));
    for (const v of this.cast.dead) {
      const dead = v.d;
      if (!dead.shootable) continue;
      const j = v.rig.updateJoints();
      probePoint(o, d, j.head, probe);
      if (probe.t <= 0) continue;
      const crawler = dead.kind === "crawler";
      const torsoR = dead.kind === "bloater" ? 0.34 : dead.kind === "mechanic" ? 0.27 : 0.2;
      const headR = dead.kind === "mechanic" ? 0.16 : 0.13;
      const tH = probe.t;
      const missH = probe.miss;
      const rH = effectiveRadius(headR, tH, aHead);
      probeSegment(o, d, j.hips, j.neck, probe);
      const tT = probe.t;
      const missT = probe.miss;
      const rT = effectiveRadius(torsoR, tT, crawler ? aCrawler : aTorso);
      let limbT = 0;
      let limbScore = Number.POSITIVE_INFINITY;
      const limb = (a: Vector3, b: Vector3, r: number) => {
        probeSegment(o, d, a, b, probe);
        const s = probe.miss / r;
        if (s < limbScore) {
          limbScore = s;
          limbT = probe.t;
        }
      };
      limb(j.shoulderL, j.elbowL, 0.065);
      limb(j.elbowL, j.handL, 0.055);
      limb(j.shoulderR, j.elbowR, 0.065);
      limb(j.elbowR, j.handR, 0.055);
      if (!crawler) {
        limb(j.thighL, j.kneeL, 0.09);
        limb(j.kneeL, j.footL, 0.07);
        limb(j.thighR, j.kneeR, 0.09);
        limb(j.kneeR, j.footR, 0.07);
      }
      // A shot passing above the neck is a headshot or a miss, never a body shot (a crawler's neck is low and forward: no such rule).
      closest.copy(d).multiplyScalar(tH).add(o);
      const aboveNeck = !crawler && closest.y > j.neck.y + 0.03;
      const scoreH = missH / rH;
      const scoreT = missT / rT;
      let part: HitPart | null = null;
      let score = 0;
      let t = 0;
      let physical = false;
      if (aboveNeck) {
        if (scoreH <= 1) {
          part = "head";
          score = scoreH;
          t = tH;
          physical = missH <= headR;
        }
      } else if (limbScore <= 1 && limbScore < scoreT && missT > torsoR) {
        part = "limb";
        score = limbScore * 0.5;
        t = limbT;
        physical = true;
      } else if (scoreT <= 1 || scoreH <= 1) {
        if (scoreH <= 1 && scoreH < scoreT) {
          part = "head";
          score = scoreH;
          t = tH;
          physical = missH <= headR;
        } else {
          part = "body";
          score = scoreT;
          t = tT;
          physical = missT <= torsoR;
        }
      }
      if (!part) continue;
      const c = add();
      c.kind = "dead";
      c.dead = dead;
      c.part = part;
      c.t = t;
      c.score = score;
      c.physical = physical;
    }

    for (const sv of this.world.survivors()) {
      if (!sv.s.shootable) continue;
      const j = sv.joints();
      probePoint(o, d, j.head, probe);
      let hit = probe.t > 0 && probe.miss <= 0.14;
      let t = probe.t;
      if (!hit) {
        probeSegment(o, d, j.hips, j.neck, probe);
        hit = probe.t > 0 && probe.miss <= 0.22;
        t = probe.t;
      }
      if (!hit) continue;
      const c = add();
      c.kind = "survivor";
      c.survivor = sv.s;
      c.t = t;
      c.score = 0;
      c.physical = true;
    }

    // The secrets.
    const aSecret = Math.atan(this.tanFor(ASSIST.secret));
    const secretAt = (shot: ShotTarget, center: Vector3, radius: number, assist = aSecret) => {
      probePoint(o, d, center, probe);
      if (probe.t <= 0) return;
      const r = effectiveRadius(radius, probe.t, assist);
      if (probe.miss > r) return;
      const c = add();
      c.kind = "secret";
      c.secret = shot;
      // Its near side: the bullet meets the radio's (or the lamp's) own face, which the road's ray finds too.
      c.t = Math.max(0, probe.t - radius);
      c.score = probe.miss / r;
      c.physical = probe.miss <= radius;
    };
    const ray = this.raycaster.ray;
    for (const [letter, box] of this.letterBoxes) {
      const node = this.road.secrets.sign.get(letter);
      if (!node) continue;
      const hitAt = ray.intersectBox(box, hitBox);
      if (hitAt) {
        const c = add();
        c.kind = "secret";
        c.secret = { kind: "secret", shot: { secret: "sign", letter } };
        c.t = hitAt.distanceTo(o);
        c.score = 0;
        c.physical = true;
      }
    }
    const s = this.road.secrets;
    const center = (node: Object3D | null) => (node ? this.box.setFromObject(node).getCenter(tmp) : null);
    const moon = center(s.moonDisc);
    if (moon) secretAt({ kind: "secret", shot: { secret: "moon" } }, moon.clone(), this.box.getSize(new Vector3()).x * 0.5, Math.atan(this.tanFor(ASSIST.moon)));
    if (this.world.scarecrowHere() && s.scarecrow) {
      this.box.setFromObject(s.scarecrow);
      const at = ray.intersectBox(this.box, hitBox);
      if (at) {
        const c = add();
        c.kind = "secret";
        c.secret = { kind: "secret", shot: { secret: "scarecrow" } };
        c.t = at.distanceTo(o);
        c.score = 0;
        c.physical = true;
      }
    }
    const booth = center(s.boothLight);
    if (booth) secretAt({ kind: "secret", shot: { secret: "booth" } }, booth.clone(), 0.22);
    if (this.world.driveInVisible()) {
      const lamp = center(s.driveInLamp);
      if (lamp) secretAt({ kind: "secret", shot: { secret: "drivein" } }, lamp.clone(), 0.5);
    }
    const radio = center(s.radio);
    if (radio) secretAt({ kind: "secret", shot: { secret: "radio" } }, radio.clone(), 0.2);
    const duck = center(s.duck);
    if (duck) secretAt({ kind: "secret", shot: { secret: "duck" } }, duck.clone(), 0.12);
    // The cat, wherever it sits: a shot at it or just past it startles it (it
    // survives everything). Weighed with the others, so the phone booth's
    // light under its perch does not take a shot meant for the cat.
    const cat = this.world.cat();
    if (cat) {
      probePoint(o, d, cat, probe);
      if (probe.t > 0 && probe.miss <= CAT_NEAR) {
        const c = add();
        c.kind = "secret";
        c.secret = { kind: "secret", shot: { secret: "cat" } };
        c.t = probe.t;
        c.score = probe.miss / CAT_NEAR;
        c.physical = probe.miss <= CAT_BODY;
      }
    }

    // Choose: a real hit on anything wins (nearest first); otherwise the best
    // near miss by priority; otherwise the road.
    let best: Candidate | null = null;
    for (let i = 0; i < n; i++) {
      const c = this.candidates[i] as Candidate;
      if (!c.physical || c.t > roadT + 0.1) continue;
      if (!best || c.t < best.t) best = c;
    }
    if (!best) {
      for (let i = 0; i < n; i++) {
        const c = this.candidates[i] as Candidate;
        if (c.physical || c.kind === "survivor" || c.t > roadT + 0.5) continue;
        if (!best || PRIORITY[c.kind] < PRIORITY[best.kind] || (PRIORITY[c.kind] === PRIORITY[best.kind] && c.score < best.score)) best = c;
      }
    }
    res.part = null;
    res.scenery = false;
    if (best) {
      res.point.copy(d).multiplyScalar(best.t).add(o);
      res.normal.copy(d).negate();
      res.distance = best.t;
      res.surface = "cloth";
      if (best.kind === "dead") {
        res.target = { kind: "dead", dead: best.dead as Dead, part: best.part };
        res.part = best.part;
      } else if (best.kind === "survivor") {
        res.target = { kind: "survivor", survivor: best.survivor as Survivor };
      } else {
        res.target = best.secret as ShotTarget;
        res.surface = "metal";
        if (road && Math.abs(road.distance - best.t) < 1.5) {
          res.point.copy(road.point);
          res.normal.copy(road.normal);
        }
      }
      return res;
    }
    if (road) {
      res.point.copy(road.point);
      res.normal.copy(road.normal);
      res.distance = road.distance;
      res.scenery = true;
      res.surface = road.object ? surfaceOf(road.object) : "dirt";
      // "Shoot near it": a bullet in the crates, the drum or the roof beside the cat sends it on too.
      res.target = cat && road.point.distanceTo(cat) < 1.3 ? { kind: "secret", shot: { secret: "cat" } } : { kind: "scenery" };
      return res;
    }
    res.target = { kind: "none" };
    res.point.copy(d).multiplyScalar(60).add(o);
    res.normal.copy(d).negate();
    res.distance = 60;
    return res;
  }
}
