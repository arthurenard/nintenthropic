import { Box3, Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from "three";
import { assistAngle, assistFactor, choose, secretFactor } from "../../../engine/rules/assist";
import { weighBody, weighInnocent, type BodyHit, type BodyShape } from "../../../engine/rules/bodyShot";
import { effectiveRadius, probePoint, type RayProbe } from "../../../engine/rules/raymath";
import type { Settings } from "../../../engine/types";
import type { Dead } from "../rules/dead";
import type { ShotTarget } from "../rules/match";
import type { SignLetter } from "../rules/secrets";
import type { Survivor } from "../rules/survivors";
import type { DeadKind, HitPart } from "../rules/types";
import type { Cast } from "./cast";
import type { RayHit, RoadQueries } from "./queries";
import { surfaceOf, type RoadLayout, type Surface } from "./road";

/**
 * How generous the aim is, as a fraction of the smaller side of the view:
 * a shot this close to a target counts, whatever its distance. A finger is
 * not a mouse (the aim check guarantees 95% of shots within 3.5%), so the
 * torso's zone is wide; the head's is tight, so a headshot is still earned;
 * survivors get no help at all - assistance never makes you shoot one.
 *
 * These are the table at its base; the player's Aim Assist scales it on every
 * shot (engine/rules/assist.ts): wider on, exact off. Secrets are never widened.
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
const tmp = new Vector3();
const hitBox = new Vector3();
const body: BodyHit = { part: "body", t: 0, score: 0, physical: false };
const innocent = { hit: false, t: 0 };

/**
 * Each kind of the dead's head and torso, metres, for a shot
 * (engine/rules/bodyShot.ts weighs it): the bloater's body and the
 * Mechanic's are bigger, and a crawler is down on the road, its neck low and
 * forward, with no legs under it to hit.
 */
const SHAPES: Readonly<Record<DeadKind, BodyShape>> = {
  walker: { head: 0.13, torso: 0.2, upright: true },
  runner: { head: 0.13, torso: 0.2, upright: true },
  crawler: { head: 0.13, torso: 0.2, upright: false },
  bloater: { head: 0.13, torso: 0.34, upright: true },
  mechanic: { head: 0.16, torso: 0.27, upright: true },
};

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
    /** The player's settings, read on every shot: Aim Assist can change mid-round. */
    private readonly settings: Pick<Settings, "aimAssist">,
  ) {
    for (let i = 0; i < 24; i++) this.candidates.push(blank());
    road.root.updateMatrixWorld(true);
    for (const [letter, node] of road.secrets.sign) this.letterBoxes.set(letter, new Box3().setFromObject(node).expandByScalar(0.06));
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

    // Aim Assist, live: the tables wider, or exact (a tolerance of none).
    const boost = assistFactor(this.settings.aimAssist);
    const aTorso = assistAngle(this.camera, ASSIST.torso * boost);
    const aHead = assistAngle(this.camera, ASSIST.head * boost);
    const aCrawler = assistAngle(this.camera, ASSIST.crawler * boost);
    // The nearest survivor the shot passes close beside (not through): no help beyond it.
    let guardAt = Number.POSITIVE_INFINITY;
    for (const v of this.cast.dead) {
      const dead = v.d;
      if (!dead.shootable) continue;
      const hit = weighBody(o, d, v.rig.updateJoints(), SHAPES[dead.kind], aHead, dead.kind === "crawler" ? aCrawler : aTorso, body);
      if (!hit) continue;
      const c = add();
      c.kind = "dead";
      c.dead = dead;
      c.part = hit.part;
      c.t = hit.t;
      c.score = hit.score;
      c.physical = hit.physical;
    }

    for (const sv of this.world.survivors()) {
      if (!sv.s.shootable) continue;
      // Close beside one, as near as a torso would be helped, is no hit, and no help beyond them either.
      const shot = weighInnocent(o, d, sv.joints(), aTorso, innocent);
      if (!shot.hit) {
        guardAt = Math.min(guardAt, shot.t);
        continue;
      }
      const c = add();
      c.kind = "survivor";
      c.survivor = sv.s;
      c.t = shot.t;
      c.score = 0;
      c.physical = true;
    }

    // The secrets: their own allowance is never boosted, so assist does not trigger one the player was not aiming at.
    const secretBy = secretFactor(this.settings.aimAssist);
    const aSecret = assistAngle(this.camera, ASSIST.secret * secretBy);
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
    if (moon) secretAt({ kind: "secret", shot: { secret: "moon" } }, moon.clone(), this.box.getSize(new Vector3()).x * 0.5, assistAngle(this.camera, ASSIST.moon * secretBy));
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
    // near miss by priority, never a survivor's and never past one the shot
    // passed close beside; otherwise the road.
    const best = choose(this.candidates, n, roadT, (c) => PRIORITY[c.kind], (c) => c.kind === "survivor", guardAt);
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
      // "Shoot near it": a bullet into the post, the sign or the car it sits
      // on (a shot at a cat on a roof meets the roof's edge first) sends it on too.
      let nearCat = false;
      if (cat) {
        probePoint(o, d, cat, probe);
        nearCat = road.point.distanceTo(cat) < 1.3 || (probe.miss < CAT_NEAR && probe.t - road.distance < 3);
      }
      res.target = nearCat ? { kind: "secret", shot: { secret: "cat" } } : { kind: "scenery" };
      return res;
    }
    res.target = { kind: "none" };
    res.point.copy(d).multiplyScalar(60).add(o);
    res.normal.copy(d).negate();
    res.distance = 60;
    return res;
  }
}
