import { Box3, Mesh, Object3D, Raycaster, Vector2, Vector3, type Intersection, type PerspectiveCamera } from "three";
import type { Bandit } from "../rules/bandit";
import type { Dynamite } from "../rules/dynamite";
import type { ShotTarget } from "../rules/match";
import { effectiveRadius, probePoint, probeSegment, type RayProbe } from "../rules/raymath";
import type { SecretId } from "../rules/secrets";
import type { Townsperson } from "../rules/townsfolk";
import type { HitPart } from "../rules/types";
import type { Cast } from "./cast";
import { contractName } from "./names";
import type { TownQueries, RayHit } from "./queries";
import { surfaceOf, type Surface, type TownLayout } from "./town";

/**
 * How generous the aim is, as a fraction of the smaller side of the view: a
 * shot this close to a target counts, whatever its distance. A finger is not a
 * mouse (the aim check guarantees 95% of shots within 3.5%), so the torso's
 * zone is wide; the head's is tight, so a headshot is still earned; innocents
 * get no help at all — assistance never makes you shoot someone.
 */
export const ASSIST = {
  torso: 0.026,
  head: 0.009,
  dynamite: 0.022,
  tumbleweed: 0.016,
  chicken: 0.024,
  secret: 0.012,
} as const;

export interface ShotResult {
  target: ShotTarget;
  point: Vector3;
  normal: Vector3;
  surface: Surface;
  /** The town mesh the bullet stopped in, if it did. */
  object: Object3D | null;
  /** Glass the bullet went through. */
  panes: Mesh[];
  hitTown: boolean;
  /** 1..8 when the piano is hit. */
  note: number;
  /** Which tumbleweed, when one is hit. */
  tumbleweed: number;
  part: HitPart | null;
  distance: number;
}

export interface ShootableWorld {
  sticks: readonly Dynamite[];
  tumbleweeds(): readonly { active: boolean; center: Vector3; radius: number }[];
  chicken(): Vector3 | null;
  bellCenter(): Vector3 | null;
  vaneCenter(): Vector3 | null;
}

const ndc = new Vector2();
const probe: RayProbe = { t: 0, miss: 0 };
const closest = new Vector3();
const tmp = new Vector3();

interface Candidate {
  kind: "bandit" | "townsfolk" | "dynamite" | "chicken" | "tumbleweed" | "secret";
  t: number;
  score: number;
  physical: boolean;
  bandit: Bandit | null;
  person: Townsperson | null;
  stick: Dynamite | null;
  index: number;
  secret: SecretId | null;
  part: HitPart;
}

const PRIORITY: Record<Candidate["kind"], number> = {
  dynamite: 0,
  bandit: 1,
  townsfolk: 1,
  chicken: 2,
  tumbleweed: 2,
  secret: 3,
};

export class Shooter {
  private readonly raycaster = new Raycaster();
  private readonly townHit: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
  private readonly candidates: Candidate[] = [];
  private readonly glassHits: Intersection[] = [];
  private readonly panes: Mesh[];
  private readonly pianoBox = new Box3();
  readonly result: ShotResult = {
    target: { kind: "none" },
    point: new Vector3(),
    normal: new Vector3(),
    surface: "dirt",
    object: null,
    panes: [],
    hitTown: false,
    note: 1,
    tumbleweed: -1,
    part: null,
    distance: 0,
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly queries: TownQueries,
    private readonly town: TownLayout,
    private readonly cast: Cast,
    private readonly world: ShootableWorld,
  ) {
    this.panes = [...town.glass.values()];
    if (town.secrets.piano) this.pianoBox.setFromObject(town.secrets.piano);
    for (let i = 0; i < 32; i++) this.candidates.push(blank());
  }

  /** Where one fraction of the smaller view side is, as a tangent of angle. */
  private tanFor(fraction: number): number {
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    return fraction * 2 * tanHalf * Math.min(1, this.camera.aspect);
  }

  /** Cast a shot through viewport position (x, y) in fractions. */
  shoot(x: number, y: number): ShotResult {
    const res = this.result;
    ndc.set(x * 2 - 1, -(y * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;

    // 1. The town: where the bullet would stop.
    const town = this.queries.cast(o, d, 250, this.townHit);
    const townT = town ? town.distance : Number.POSITIVE_INFINITY;

    // 2. Everything that moves.
    let n = 0;
    const add = (): Candidate => {
      const c = this.candidates[n] ?? blank();
      if (n >= this.candidates.length) this.candidates.push(c);
      n++;
      c.bandit = null;
      c.person = null;
      c.stick = null;
      c.secret = null;
      c.index = -1;
      c.part = "body";
      return c;
    };
    const aTorso = Math.atan(this.tanFor(ASSIST.torso));
    const aHead = Math.atan(this.tanFor(ASSIST.head));

    for (const v of this.cast.bandits) {
      const b = v.b;
      if (!b.shootable) continue;
      const j = v.rig.updateJoints();
      probePoint(o, d, j.head, probe);
      if (probe.t <= 0) continue;
      const tH = probe.t;
      const missH = probe.miss;
      const rH = effectiveRadius(0.13, tH, aHead);
      probeSegment(o, d, j.hips, j.neck, probe);
      const tT = probe.t;
      const missT = probe.miss;
      const rT = effectiveRadius(0.2, tT, aTorso);
      // Limbs: physical only, a clean hit on an arm or a leg.
      let limbT = 0;
      let limbScore = Number.POSITIVE_INFINITY;
      const limb = (a: Vector3, bb: Vector3, r: number) => {
        probeSegment(o, d, a, bb, probe);
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
      limb(j.thighL, j.kneeL, 0.09);
      limb(j.kneeL, j.footL, 0.07);
      limb(j.thighR, j.kneeR, 0.09);
      limb(j.kneeR, j.footR, 0.07);
      // A shot passing above the neck is a headshot or a miss, never a body shot.
      closest.copy(d).multiplyScalar(tH).add(o);
      const aboveNeck = closest.y > j.neck.y + 0.03;
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
          physical = missH <= 0.13;
        }
      } else if (limbScore <= 1 && limbScore < scoreT && missT > 0.2) {
        part = "limb";
        score = limbScore * 0.5;
        t = limbT;
        physical = true;
      } else if (scoreT <= 1 || scoreH <= 1) {
        if (scoreH <= 1 && scoreH < scoreT) {
          part = "head";
          score = scoreH;
          t = tH;
          physical = missH <= 0.13;
        } else {
          part = "body";
          score = scoreT;
          t = tT;
          physical = missT <= 0.2;
        }
      }
      if (!part) continue;
      const c = add();
      c.kind = "bandit";
      c.bandit = b;
      c.part = part;
      c.t = t;
      c.score = score;
      c.physical = physical;
    }

    for (const v of this.cast.townsfolk) {
      const p = v.p;
      if (!p.shootable) continue;
      const j = v.rig.updateJoints();
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
      c.kind = "townsfolk";
      c.person = p;
      c.t = t;
      c.score = 0;
      c.physical = true;
    }

    const aDyn = Math.atan(this.tanFor(ASSIST.dynamite));
    for (const s of this.world.sticks) {
      if (!s.airborne) continue;
      tmp.set(s.position.x, s.position.y, s.position.z);
      probePoint(o, d, tmp, probe);
      if (probe.t <= 0) continue;
      const r = effectiveRadius(0.18, probe.t, aDyn);
      if (probe.miss > r) continue;
      const c = add();
      c.kind = "dynamite";
      c.stick = s;
      c.t = probe.t;
      c.score = probe.miss / r;
      c.physical = probe.miss <= 0.18;
    }

    const aWeed = Math.atan(this.tanFor(ASSIST.tumbleweed));
    const weeds = this.world.tumbleweeds();
    for (let i = 0; i < weeds.length; i++) {
      const w = weeds[i];
      if (!w || !w.active) continue;
      probePoint(o, d, w.center, probe);
      if (probe.t <= 0) continue;
      const r = effectiveRadius(w.radius, probe.t, aWeed);
      if (probe.miss > r) continue;
      const c = add();
      c.kind = "tumbleweed";
      c.index = i;
      c.t = probe.t;
      c.score = probe.miss / r;
      c.physical = probe.miss <= w.radius;
    }

    const chicken = this.world.chicken();
    if (chicken) {
      probePoint(o, d, chicken, probe);
      const r = effectiveRadius(0.25, probe.t, Math.atan(this.tanFor(ASSIST.chicken)));
      if (probe.t > 0 && probe.miss <= r) {
        const c = add();
        c.kind = "chicken";
        c.t = probe.t;
        c.score = probe.miss / r;
        c.physical = probe.miss <= 0.25;
      }
    }

    const aSecret = Math.atan(this.tanFor(ASSIST.secret));
    for (const [id, center, radius] of [
      ["bell", this.world.bellCenter(), 0.55],
      ["vane", this.world.vaneCenter(), 0.6],
    ] as [SecretId, Vector3 | null, number][]) {
      if (!center) continue;
      probePoint(o, d, center, probe);
      const r = effectiveRadius(radius, probe.t, aSecret);
      if (probe.t > 0 && probe.miss <= r) {
        const c = add();
        c.kind = "secret";
        c.secret = id;
        c.t = probe.t;
        c.score = probe.miss / r;
        c.physical = false;
      }
    }

    // 3. Choose: a real hit on anything wins (nearest first); otherwise the
    // best near miss by priority; otherwise the town.
    let best: Candidate | null = null;
    for (let i = 0; i < n; i++) {
      const c = this.candidates[i] as Candidate;
      if (!c.physical || c.t > townT + 0.1) continue;
      if (!best || c.t < best.t) best = c;
    }
    if (!best) {
      for (let i = 0; i < n; i++) {
        const c = this.candidates[i] as Candidate;
        if (c.physical || c.kind === "townsfolk" || c.t > townT + 0.5) continue;
        if (!best || PRIORITY[c.kind] < PRIORITY[best.kind] || (PRIORITY[c.kind] === PRIORITY[best.kind] && c.score < best.score)) best = c;
      }
    }

    res.panes.length = 0;
    res.note = 1;
    res.tumbleweed = -1;
    res.part = null;
    res.object = null;
    res.hitTown = false;
    const finalT = best ? best.t : townT;

    // Glass the bullet passed through on the way.
    if (this.panes.length) {
      this.glassHits.length = 0;
      this.raycaster.far = Number.isFinite(finalT) ? finalT : 250;
      this.raycaster.intersectObjects(this.panes, false, this.glassHits);
      for (const h of this.glassHits) if (h.object.visible && !res.panes.includes(h.object as Mesh)) res.panes.push(h.object as Mesh);
      this.raycaster.far = Number.POSITIVE_INFINITY;
    }

    if (best) {
      res.point.copy(d).multiplyScalar(best.t).add(o);
      res.normal.copy(d).negate();
      res.distance = best.t;
      res.surface = "cloth";
      switch (best.kind) {
        case "bandit":
          res.target = { kind: "bandit", bandit: best.bandit as Bandit, part: best.part };
          res.part = best.part;
          break;
        case "townsfolk":
          res.target = { kind: "townsfolk", person: best.person as Townsperson };
          break;
        case "dynamite":
          res.target = { kind: "dynamite", stick: best.stick as Dynamite };
          break;
        case "tumbleweed":
          res.target = { kind: "tumbleweed" };
          res.tumbleweed = best.index;
          break;
        case "chicken":
          res.target = { kind: "chicken" };
          break;
        case "secret":
          res.target = { kind: "secret", secret: best.secret as SecretId };
          res.surface = "metal";
          // Put the impact on the object if the ray actually reached the town there.
          if (town && Math.abs(town.distance - best.t) < 2) {
            res.point.copy(town.point);
            res.normal.copy(town.normal);
          }
          break;
      }
      return res;
    }

    if (town) {
      res.point.copy(town.point);
      res.normal.copy(town.normal);
      res.distance = town.distance;
      res.object = town.object;
      res.hitTown = true;
      res.surface = town.object ? surfaceOf(town.object) : "dirt";
      const secret = town.object ? secretOf(town.object) : null;
      if (secret) {
        res.target = { kind: "secret", secret };
        if (secret === "piano") res.note = this.noteAt(town.point);
        return res;
      }
      // "Shoot near it": a bullet in the dirt beside the chicken startles it.
      if (chicken && town.point.distanceTo(chicken) < 1.0) {
        res.target = { kind: "chicken" };
        return res;
      }
      res.target = { kind: "scenery" };
      return res;
    }

    res.target = { kind: "none" };
    res.point.copy(d).multiplyScalar(60).add(o);
    res.normal.copy(d).negate();
    res.distance = 60;
    return res;
  }

  /** Low notes to the left, high to the right, along the keyboard. */
  private noteAt(p: Vector3): number {
    const b = this.pianoBox;
    if (b.isEmpty()) return 1;
    const sx = b.max.x - b.min.x;
    const sz = b.max.z - b.min.z;
    const u = sx > sz ? (p.x - b.min.x) / sx : 1 - (p.z - b.min.z) / sz;
    return Math.min(8, Math.max(1, 1 + Math.floor(u * 8)));
  }
}

function blank(): Candidate {
  return { kind: "bandit", t: 0, score: 0, physical: false, bandit: null, person: null, stick: null, index: -1, secret: null, part: "body" };
}

const SECRET_NODES: Record<string, SecretId> = {
  "secret.bell": "bell",
  "secret.vane": "vane",
  "secret.water_tower": "water_tower",
  "secret.piano": "piano",
  "secret.poster": "poster",
};

export function secretOf(o: Object3D): SecretId | null {
  for (let n: Object3D | null = o; n; n = n.parent) {
    const id = SECRET_NODES[contractName(n)];
    if (id) return id;
  }
  return null;
}
