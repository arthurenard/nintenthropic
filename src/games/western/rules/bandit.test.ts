import { describe, expect, it } from "vitest";
import { Bandit, type BanditEvents, type BanditWorld } from "./bandit";
import { mulberry32 } from "../../../engine/rules/rng";
import { testCovers } from "./testkit";
import {
  DUEL_DRAW,
  DUEL_PACES,
  DUEL_PACE_TIME,
  DUEL_STANDOFF,
  EMERGE_TIME,
  FIRE_RECOVER,
  GLINT_LEAD,
  HIDDEN_WAIT,
  HIDE_TIME,
  LIGHT_TIME,
  THROW_RELEASE,
  WALK_OUT_SPEED,
  DIFFICULTY,
  type DifficultyTuning,
} from "./tuning";
import type { Cover } from "./types";
import { waveSpec, type WaveSpec } from "./waves";

/** A world with the doors wide open: every slot granted, every shot allowed. */
class FakeWorld implements BanditWorld {
  time = 0;
  spec: WaveSpec;
  random = mulberry32(7);
  log: { t: number; e: string }[] = [];
  slots = 1;
  fired = 0;
  thrown = 0;
  events: BanditEvents;
  relocate: Cover | null = null;
  run: Cover | null = null;
  canThrowFlag = true;
  constructor(
    wave: number,
    readonly tuning: DifficultyTuning = DIFFICULTY.standard,
  ) {
    this.spec = { ...waveSpec(wave), tellChance: 1, secondShot: 0 };
    const note = (e: string) => () => this.log.push({ t: this.time, e });
    this.events = {
      banditTell: note("tell"),
      banditEmerge: note("emerge"),
      banditAim: note("aim"),
      banditGlint: note("glint"),
      banditHide: note("hide"),
      banditRelocate: note("relocate"),
      banditRun: note("run"),
      banditLight: note("light"),
      banditPace: note("pace"),
      banditStandoff: note("standoff"),
      duelBell: note("bell"),
      banditDead: note("dead"),
    };
  }
  acquireSlot(b: Bandit) {
    if (this.slots <= 0) return false;
    this.slots--;
    b.slot = true;
    return true;
  }
  releaseSlot(b: Bandit) {
    b.slot = false;
    this.slots++;
  }
  canFire() {
    return true;
  }
  fire() {
    this.fired++;
    this.log.push({ t: this.time, e: "fire" });
  }
  canThrow() {
    return this.canThrowFlag;
  }
  throwDynamite() {
    this.thrown++;
    this.log.push({ t: this.time, e: "throw" });
  }
  relocateTarget() {
    return this.relocate;
  }
  runTarget() {
    return this.run;
  }
  runnersRunning() {
    return 0;
  }
  coveringFire() {}
}

const DT = 1 / 120;

function stepFor(b: Bandit, w: FakeWorld, seconds: number) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    w.time += DT;
    b.step(DT, w);
  }
}

function at(w: FakeWorld, e: string): number {
  const found = w.log.find((x) => x.e === e);
  if (!found) throw new Error(`no ${e} in ${w.log.map((x) => x.e).join(",")}`);
  return found.t;
}

const covers = testCovers();
const byId = (id: string) => covers.find((c) => c.id === id) as Cover;

describe("coming out from the cover's ready spot", () => {
  // A corner: he waits 2 m round it, comes out from its edge.
  const corner: Cover = {
    ...byId("store_corner"),
    hidden: { x: -10.4, y: 0, z: -17 },
    ready: { x: -8.8, y: 0, z: -17 },
    exposed: { x: -8.4, y: 0, z: -17 },
  };

  it("moves between the ready spot and the exposed one, never gliding from where he waited", () => {
    const w = new FakeWorld(1);
    const b = new Bandit(1, "gunman", corner);
    b.spawn(0.1);
    const xs: number[] = [];
    for (let i = 0; i < 600 && b.state !== "aiming"; i++) {
      w.time += DT;
      b.step(DT, w);
      if (b.state === "emerging") xs.push(b.pos.x);
    }
    expect(xs.length).toBeGreaterThan(3);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-8.8 - 1e-9);
    expect(b.pos.x).toBeCloseTo(-8.4);
    // Going back he stops at the edge, and only then is he back where he waits.
    const back: number[] = [];
    for (let i = 0; i < 1200 && b.state !== "hidden"; i++) {
      w.time += DT;
      b.step(DT, w);
      if (b.state === "hiding") back.push(b.pos.x);
    }
    expect(Math.min(...back)).toBeGreaterThanOrEqual(-8.8 - 1e-9);
    expect(b.pos.x).toBeCloseTo(-10.4);
  });

  it("walks, not glides, across a gallery: a long way out takes longer", () => {
    const gallery: Cover = { ...corner, emerge: "step_out", ready: { x: -10.2, y: 0, z: -17 }, exposed: { x: -8.4, y: 0, z: -17 } };
    const w = new FakeWorld(1);
    const b = new Bandit(3, "gunman", gallery);
    b.spawn(0.05);
    for (let i = 0; i < 600 && b.state !== "emerging"; i++) {
      w.time += DT;
      b.step(DT, w);
    }
    expect(b.dur).toBeCloseTo(1.8 / WALK_OUT_SPEED);
    expect(b.dur).toBeGreaterThan(EMERGE_TIME.step_out);
  });

  it("hit halfway out (an iron plate, Black Jack), he staggers and goes back from there, not from all the way out", () => {
    for (const leaving of [false, true]) {
      const w = new FakeWorld(6);
      const b = new Bandit(4, "gunman", corner);
      b.spawn(0.05);
      // Halfway out, or halfway back in.
      for (let i = 0; i < 1200; i++) {
        w.time += DT;
        b.step(DT, w);
        if (!leaving && b.state === "emerging" && b.exposure >= 0.5) break;
        if (leaving && b.state === "hiding" && b.exposure <= 0.5) break;
      }
      expect(b.exposure).toBeGreaterThan(0.3);
      expect(b.exposure).toBeLessThan(0.7);
      const hitAt = b.pos.x;
      b.stagger();
      let furthest = hitAt;
      for (let i = 0; i < 1200 && b.state !== "hidden"; i++) {
        w.time += DT;
        b.step(DT, w);
        furthest = Math.max(furthest, b.pos.x);
      }
      // Never further out than where the bullet found him (the exposed spot is at −8.4).
      expect(furthest).toBeCloseTo(hitAt, 6);
      expect(b.state).toBe("hidden");
    }
  });

  it("runs into a cover as far as its ready spot", () => {
    const w = new FakeWorld(3);
    w.run = corner;
    const b = new Bandit(2, "runner", byId("bank_corner"));
    b.spawn(0.05);
    stepFor(b, w, 0.1);
    expect(b.state).toBe("running");
    expect(b.path[4]).toEqual(corner.ready);
  });
});

describe("the bandit state machine", () => {
  it("hides, tells, emerges, aims with a glint, fires and hides again, on time", () => {
    const w = new FakeWorld(1);
    const b = new Bandit(1, "gunman", byId("saloon_door"));
    b.spawn(0.5);
    expect(b.visible).toBe(false);
    stepFor(b, w, 6);
    const tell = at(w, "tell");
    const emerge = at(w, "emerge");
    const glint = at(w, "glint");
    const fire = at(w, "fire");
    const hide = at(w, "hide");
    expect(tell).toBeCloseTo(0.5, 1);
    expect(emerge - tell).toBeGreaterThanOrEqual(0.45 - DT);
    expect(emerge - tell).toBeLessThanOrEqual(0.8 + DT);
    const aim = emerge + EMERGE_TIME.step_out;
    expect(fire - aim).toBeCloseTo(1.4, 1); // wave 1's aim time
    expect(fire - glint).toBeCloseTo(GLINT_LEAD, 1);
    expect(hide - fire).toBeCloseTo(FIRE_RECOVER, 1);
    expect(w.fired).toBe(1);
  });

  it("is visible from the first frame out of cover until back in", () => {
    const w = new FakeWorld(1);
    const b = new Bandit(1, "gunman", byId("store_barrels"));
    b.spawn(0.1);
    let sawVisible = false;
    for (let i = 0; i < 2000; i++) {
      w.time += DT;
      b.step(DT, w);
      if (b.state === "emerging" || b.state === "aiming" || b.state === "hiding") expect(b.visible).toBe(true);
      if (b.state === "hidden" || b.state === "tell") expect(b.visible).toBe(false);
      sawVisible ||= b.visible;
    }
    expect(sawVisible).toBe(true);
  });

  it("aims faster on later waves", () => {
    const w1 = new FakeWorld(1);
    const w10 = new FakeWorld(10);
    for (const w of [w1, w10]) {
      const b = new Bandit(1, "gunman", byId("bank_corner"));
      b.spawn(0.1);
      stepFor(b, w, 5);
    }
    const aim1 = at(w1, "fire") - at(w1, "emerge");
    const aim10 = at(w10, "fire") - at(w10, "emerge");
    expect(aim1 - EMERGE_TIME.lean_right).toBeCloseTo(1.4, 1);
    expect(aim10 - EMERGE_TIME.lean_right).toBeCloseTo(0.7, 1);
  });

  it("waits hidden between 0.8 and 2.5 s before coming out again", () => {
    for (let seed = 1; seed < 20; seed++) {
      const w = new FakeWorld(1);
      w.random = mulberry32(seed);
      const b = new Bandit(1, "gunman", byId("store_door"));
      b.spawn(0.1);
      stepFor(b, w, 12);
      const hides = w.log.filter((x) => x.e === "hide").map((x) => x.t);
      const tells = w.log.filter((x) => x.e === "tell").map((x) => x.t);
      const c = byId("store_door");
      const hideTime = Math.max(HIDE_TIME.step_out, Math.hypot(c.hidden.x - c.exposed.x, c.hidden.z - c.exposed.z) / WALK_OUT_SPEED);
      const hidden = (tells[1] as number) - ((hides[0] as number) + hideTime);
      expect(hidden).toBeGreaterThanOrEqual(HIDDEN_WAIT[0] - 2 * DT);
      expect(hidden).toBeLessThanOrEqual(HIDDEN_WAIT[1] + 2 * DT);
    }
  });

  it("stays hidden while every slot is taken", () => {
    const w = new FakeWorld(1);
    w.slots = 0;
    const b = new Bandit(1, "gunman", byId("store_door"));
    b.spawn(0.1);
    stepFor(b, w, 5);
    expect(w.log.some((x) => x.e === "emerge")).toBe(false);
    w.slots = 1;
    stepFor(b, w, 2);
    expect(w.log.some((x) => x.e === "emerge")).toBe(true);
  });

  it("moves to an adjacent cover while hidden", () => {
    const w = new FakeWorld(1);
    w.random = () => 0.1; // always relocate
    const b = new Bandit(1, "gunman", byId("store_door"));
    w.relocate = byId("store_barrels");
    b.spawn(0.1);
    stepFor(b, w, 5);
    expect(w.log.some((x) => x.e === "relocate")).toBe(true);
    expect(b.cover.id).toBe("store_barrels");
  });

  it("a dynamiter lights, throws, and releases the stick mid-throw", () => {
    const w = new FakeWorld(4);
    const b = new Bandit(1, "dynamiter", byId("wagon"));
    b.spawn(0.1);
    stepFor(b, w, 4);
    const light = at(w, "light");
    const thrown = at(w, "throw");
    expect(thrown - light).toBeCloseTo(LIGHT_TIME + THROW_RELEASE, 1);
    expect(w.fired).toBe(0);
    expect(w.thrown).toBe(1);
  });

  it("a dynamiter out of range fights like a gunman", () => {
    const w = new FakeWorld(4);
    w.canThrowFlag = false;
    const b = new Bandit(1, "dynamiter", byId("far_barrels"));
    b.spawn(0.1);
    stepFor(b, w, 4);
    expect(w.thrown).toBe(0);
    expect(w.fired).toBe(1);
  });

  it("a runner's first appearance is a sprint across the street, in view", () => {
    const w = new FakeWorld(3);
    w.run = byId("trough");
    const b = new Bandit(1, "runner", byId("store_barrels"));
    b.spawn(0.2);
    stepFor(b, w, 0.25);
    expect(b.state).toBe("running");
    expect(b.visible).toBe(true);
    const startX = b.pos.x;
    stepFor(b, w, 0.6);
    expect(b.pos.x).toBeGreaterThan(startX);
    stepFor(b, w, 4);
    expect(b.cover.id).toBe("trough");
  });

  it("riflemen take longer to aim", () => {
    const w = new FakeWorld(6);
    const b = new Bandit(1, "rifleman", byId("hotel_roof"));
    b.spawn(0.1);
    stepFor(b, w, 5);
    const aim = at(w, "fire") - at(w, "emerge") - EMERGE_TIME.rise;
    expect(aim).toBeCloseTo(waveSpec(6).aimTime * 1.6, 1);
  });

  it("the duelist walks ten paces, stands off, and draws on the bell", () => {
    const w = new FakeWorld(1);
    const b = new Bandit(1, "duelist", byId("saloon_door"));
    b.startDuel({ x: -8.6, y: 0, z: -24 }, { x: -1, y: 0, z: -21.5 });
    stepFor(b, w, DUEL_PACES * DUEL_PACE_TIME + DUEL_STANDOFF + DUEL_DRAW + 0.2);
    expect(w.log.filter((x) => x.e === "pace").length).toBe(DUEL_PACES);
    const bell = at(w, "bell");
    expect(bell).toBeCloseTo(DUEL_PACES * DUEL_PACE_TIME + DUEL_STANDOFF, 1);
    expect(at(w, "fire") - bell).toBeCloseTo(DUEL_DRAW, 1);
    expect(b.emergedAt).toBeCloseTo(bell, 1);
  });

  it("dies and stays dead", () => {
    const w = new FakeWorld(1);
    const b = new Bandit(1, "gunman", byId("saloon_door"));
    b.spawn(0.1);
    stepFor(b, w, 1);
    b.die({ clip: "death_back", fall: false });
    expect(b.alive).toBe(false);
    stepFor(b, w, 3);
    expect(b.state).toBe("dead");
    expect(w.log.filter((x) => x.e === "dead").length).toBe(1);
  });
});

describe("the gang on Relaxed", () => {
  const relaxed = DIFFICULTY.relaxed;

  it("aims half as long again, and glints earlier before the shot", () => {
    const w = new FakeWorld(1, relaxed);
    const b = new Bandit(1, "gunman", byId("saloon_door"));
    b.spawn(0.5);
    stepFor(b, w, 8);
    const aim = at(w, "emerge") + EMERGE_TIME.step_out;
    expect(at(w, "fire") - aim).toBeCloseTo(1.4 * relaxed.aimFactor, 1);
    expect(at(w, "fire") - at(w, "glint")).toBeCloseTo(relaxed.glintLead, 1);
    expect(relaxed.glintLead).toBeGreaterThan(GLINT_LEAD);
  });

  it("gives a dynamiter longer to light his fuse", () => {
    const w = new FakeWorld(4, relaxed);
    const b = new Bandit(1, "dynamiter", byId("wagon"));
    b.spawn(0.1);
    stepFor(b, w, 5);
    expect(at(w, "throw") - at(w, "light")).toBeCloseTo(relaxed.lightTime + THROW_RELEASE, 1);
    expect(relaxed.lightTime).toBeGreaterThan(LIGHT_TIME);
  });

  it("takes longer to draw in the duel", () => {
    const w = new FakeWorld(1, relaxed);
    const b = new Bandit(1, "duelist", byId("saloon_door"));
    b.startDuel({ x: -8.6, y: 0, z: -24 }, { x: -1, y: 0, z: -21.5 });
    stepFor(b, w, DUEL_PACES * DUEL_PACE_TIME + DUEL_STANDOFF + DUEL_DRAW * relaxed.aimFactor + 0.2);
    expect(at(w, "fire") - at(w, "bell")).toBeCloseTo(DUEL_DRAW * relaxed.aimFactor, 1);
  });
});
