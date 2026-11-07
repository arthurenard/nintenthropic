import { describe, expect, it } from "vitest";
import { Group, Texture } from "three";
import { CHARACTERS } from "../characters";
import type { KartView } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { MEADOW_LOOP } from "../track/tracks";
import { blinkAt, Lids } from "./drivers/face";
import { BUILDERS } from "./drivers";
import { look } from "./drivers/parts";
import { KartActor, type ActorContext, type KartPose } from "./kart";
import { kartExtras } from "./kartExtras";
import { rgb } from "./kartBuilder";

const geo = TrackGeometry.build(MEADOW_LOOP);
const ctx: ActorContext = { track: geo, shadowTexture: new Texture(), lightTexture: new Texture(), night: false, spinInModel: true, laps: 3 };

/** A kart `back` metres along the road from s = 60 (negative: behind), going `speed`. */
function view(id: number, back: number, speed: number, over: Partial<KartView> = {}): KartView {
  const t = geo.at(60 + back);
  return {
    id, x: t.x, y: t.y, z: t.z, heading: Math.atan2(t.tx, t.tz), speed, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0,
    offroad: false, surface: "road", trick: 0, rescue: 0, item: null, itemUses: 0, rolling: false, place: 1, lap: 1, lapProgress: 0, wrongWay: false, finished: null,
    ...over,
  };
}

function actor(id: number, poses: KartPose[]): KartActor {
  return new KartActor(id, () => ({ root: new Group(), pose: (p: KartPose) => void poses.push({ ...p }), dispose() {} }), { id, colour: "#ff0000" }, ctx);
}

describe("the brake lights", () => {
  const run = (speedAt: (t: number) => number): number[] => {
    const poses: KartPose[] = [];
    const k = actor(0, poses);
    for (let i = 0; i < 90; i++) k.update(view(0, 0, speedAt(i / 60)), 1 / 60, ctx, i / 60);
    k.dispose();
    return poses.map((p) => p.brake ?? 0);
  };

  it("stay dark at a steady speed and while speeding up", () => {
    expect(Math.max(...run(() => 20))).toBeLessThan(0.05);
    expect(Math.max(...run((t) => 8 + t * 6))).toBeLessThan(0.05);
  });

  it("light when the speed falls hard, and go out when it steadies", () => {
    const b = run((t) => (t < 0.6 ? 26 - t * 22 : 12.8));
    expect(Math.max(...b)).toBeGreaterThan(0.6);
    expect(b[b.length - 1]!).toBeLessThan(0.1);
  });

  it("ignore a cut in the speed (a respawn or a correction) and a noisy series", () => {
    expect(Math.max(...run((t) => (t < 0.5 ? 30 : 8)))).toBeLessThan(0.05);
    expect(Math.max(...run((t) => 20 + Math.sin(t * 40) * 0.4))).toBeLessThan(0.05);
  });

  it("do not light for a kart already crawling", () => {
    expect(Math.max(...run((t) => Math.max(0, 1.2 - t * 3)))).toBeLessThan(0.05);
  });
});

describe("the glance back", () => {
  it("only sees the karts of its own scene", () => {
    const other: ActorContext = { ...ctx };
    const poses: KartPose[] = [];
    const a = actor(0, poses);
    const b = new KartActor(1, () => ({ root: new Group(), pose() {}, dispose() {} }), { id: 1, colour: "#00f" }, other);
    for (let i = 0; i < 240; i++) {
      a.update(view(0, 0, 20), 1 / 60, ctx, i / 60);
      b.update(view(1, -6, 20), 1 / 60, other, i / 60);
    }
    expect(Math.max(...poses.map((p) => Math.abs(p.lookBack ?? 0)))).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("a driver with a kart close behind looks round over that side's shoulder, now and then, and the one behind never does", () => {
    const lead: KartPose[] = [];
    const tail: KartPose[] = [];
    const a = actor(0, lead);
    const b = actor(1, tail);
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      a.update(view(0, 0, 24), 1 / 60, ctx, t);
      b.update(view(1, -6, 24), 1 / 60, ctx, t);
    }
    const looks = lead.map((p) => p.lookBack ?? 0);
    expect(Math.max(...looks.map(Math.abs))).toBeGreaterThan(0.8);
    // Mostly facing the road: it is a glance, not a stare.
    expect(looks.filter((x) => Math.abs(x) < 0.1).length).toBeGreaterThan(looks.length * 0.5);
    expect(Math.max(...tail.map((p) => Math.abs(p.lookBack ?? 0)))).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("does not look back at a kart far behind, or when alone", () => {
    const lead: KartPose[] = [];
    const a = actor(0, lead);
    const b = actor(1, []);
    for (let i = 0; i < 300; i++) {
      a.update(view(0, 0, 24), 1 / 60, ctx, i / 60);
      b.update(view(1, -40, 24), 1 / 60, ctx, i / 60);
    }
    expect(Math.max(...lead.map((p) => Math.abs(p.lookBack ?? 0)))).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("a kart at rest on the grid is at rest: its driver breathes and looks about", () => {
    const poses: KartPose[] = [];
    const a = actor(0, poses);
    for (let i = 0; i < 120; i++) a.update(view(0, 0, 0), 1 / 60, ctx, i / 60);
    expect(poses[poses.length - 1]!.rest).toBeGreaterThan(0.9);
    a.dispose();
  });
});

describe("the eyelids", () => {
  it("blink as a pure function of the clock and the seed, apart per seed", () => {
    expect(blinkAt(12.34, 5)).toBe(blinkAt(12.34, 5));
    let a = 0;
    let b = 0;
    let both = 0;
    for (let i = 0; i < 3000; i++) {
      const x = blinkAt(i * 0.01, 1) > 0.5;
      const y = blinkAt(i * 0.01, 2) > 0.5;
      a += x ? 1 : 0;
      b += y ? 1 : 0;
      both += x && y ? 1 : 0;
    }
    expect(a).toBeGreaterThan(20);
    expect(b).toBeGreaterThan(20);
    expect(both).toBeLessThan(Math.min(a, b) * 0.5);
  });

  const species = CHARACTERS.map((c) => c.species);

  it("every driver has eyes to close, with a lid built for them", () => {
    for (const s of species) {
      const build = BUILDERS[s](look("#ff453a"));
      const lids = new Lids(s, build.head, new Group() as never, 3);
      expect(lids.mesh.geometry.getAttribute("position").count, s).toBeGreaterThan(20);
    }
  });

  it("blink now and then, quickly, and stay shut for a happy driver", () => {
    const build = BUILDERS.fox(look("#ff453a"));
    const lids = new Lids("fox", build.head, new Group() as never, 1);
    let shut = 0;
    let blinks = 0;
    let was = false;
    const frames = 60 * 20;
    for (let i = 0; i < frames; i++) {
      lids.update(i / 60, 0, 0);
      if (lids.mesh.visible) shut++;
      if (lids.mesh.visible && !was) blinks++;
      was = lids.mesh.visible;
    }
    // Over twenty seconds: some blinks, and the eyes are open nearly all the while.
    expect(blinks).toBeGreaterThanOrEqual(3);
    expect(blinks).toBeLessThanOrEqual(14);
    expect(shut / frames).toBeLessThan(0.15);
    lids.update(30, 1, 0);
    expect(lids.mesh.visible).toBe(true);
    expect(lids.mesh.scale.y).toBe(1);
    lids.update(31, 0, 0, 1);
    expect(lids.mesh.scale.y).toBe(1);
  });
});

describe("each driver's coachwork", () => {
  it("every species has some, in its own place, and the golden kart adds a crown", () => {
    const sizes = new Set<number>();
    for (const c of CHARACTERS) {
      const g = kartExtras(c.species, rgb("#0a84ff"), false);
      expect(g, c.id).not.toBeNull();
      const n = g!.getAttribute("position").count;
      sizes.add(n);
      expect(g!.boundingBox!.max.y, c.id).toBeLessThan(2.1);
      expect(g!.boundingBox!.min.y, c.id).toBeGreaterThan(0.3);
      const gold = kartExtras(c.species, rgb("#0a84ff"), true)!;
      expect(gold.getAttribute("position").count, c.id).toBeGreaterThan(n);
    }
    // Nine drivers, nine different silhouettes.
    expect(sizes.size).toBe(CHARACTERS.length);
  });
});
