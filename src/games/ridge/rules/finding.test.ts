import { describe, expect, it } from "vitest";
import { Actor } from "./actors";
import { fadeNear, FADE_FAR, FADE_NEAR, landmarksOf, LABEL_H, LABEL_W, liftLabel, MARK_GAP, MARK_H, MARK_W, nearestOf, placeMarks, rimArrow, whereWords, whoIsMarked, type CamMan } from "./finding";
import { testPlan } from "./testkit";
import type { Role, Side } from "./types";

function someone(id: number, side: Side, role: Role, { alive = true, hidden = false } = {}): Actor {
  const a = new Actor(id, side, role);
  a.alive = alive;
  a.hidden = hidden;
  return a;
}

const none = new Set<number>();

describe("who gets a mark", () => {
  const sentry = someone(1, "hostile", "sentry");
  const patrol = someone(2, "hostile", "patrol");
  const farmer = someone(3, "civilian", "farmer");
  const cyclist = someone(4, "civilian", "cyclist");
  const cow = someone(5, "animal", "cow");
  const duck = someone(6, "animal", "duck");
  const child = someone(7, "civilian", "child");
  const everyone = [sentry, patrol, farmer, cyclist, cow, duck, child];

  it("marks every hostile in the open, and never a civilian or an animal", () => {
    const marked = whoIsMarked(everyone, { assist: true, revealed: none, lastOne: null });
    expect(marked.map((m) => m.id)).toEqual([1, 2]);
    expect(marked.every((m) => m.standing && m.pulse === null)).toBe(true);
    // Not even to help: whatever is going on, nothing it would be wrong to shoot is ever marked.
    const everything = whoIsMarked(everyone, { assist: true, revealed: new Set(everyone.map((a) => a.id)), lastOne: 3 });
    expect(everything.map((m) => m.id)).toEqual([1, 2]);
  });

  it("marks no one in the open with Aim Assist off", () => {
    expect(whoIsMarked(everyone, { assist: false, revealed: none, lastOne: 1 })).toEqual([]);
  });

  it("leaves out the dead and the hidden", () => {
    const down = someone(8, "hostile", "sentry", { alive: false });
    const trooper = someone(9, "hostile", "trooper", { hidden: true });
    const marked = whoIsMarked([sentry, down, trooper], { assist: true, revealed: none, lastOne: null });
    expect(marked.map((m) => m.id)).toEqual([1]);
  });

  it("keeps the counter-sniper to his glint: marked only once he has fired, or when he is the last and not found", () => {
    const sniper = someone(10, "hostile", "sniper");
    expect(whoIsMarked([sniper], { assist: true, revealed: none, lastOne: null })).toEqual([]);
    expect(whoIsMarked([sniper], { assist: true, revealed: new Set([10]), lastOne: null })).toEqual([{ id: 10, pulse: "shot", standing: true }]);
    expect(whoIsMarked([sniper], { assist: true, revealed: none, lastOne: 10 })).toEqual([{ id: 10, pulse: "last", standing: true }]);
    // Down in his nest he is never marked, however long he has been missing.
    sniper.hidden = true;
    expect(whoIsMarked([sniper], { assist: true, revealed: none, lastOne: 10 })).toEqual([]);
  });

  it("makes the last man's mark breathe, only where there are marks", () => {
    expect(whoIsMarked([sentry, patrol], { assist: true, revealed: none, lastOne: 2 })).toEqual([
      { id: 1, pulse: null, standing: true },
      { id: 2, pulse: "last", standing: true },
    ]);
    expect(whoIsMarked([sentry, patrol], { assist: false, revealed: none, lastOne: 2 })).toEqual([]);
  });

  it("marks whoever fires at the player, with Aim Assist off too, and where he fired from when he has gone to ground", () => {
    const gunner = someone(11, "hostile", "gunner");
    expect(whoIsMarked([sentry, gunner], { assist: false, revealed: new Set([11]), lastOne: null })).toEqual([{ id: 11, pulse: "shot", standing: true }]);
    const sniper = someone(12, "hostile", "sniper", { hidden: true });
    expect(whoIsMarked([sniper], { assist: false, revealed: new Set([12]), lastOne: null })).toEqual([{ id: 12, pulse: "shot", standing: false }]);
    // Shot dead after firing: nothing to mark.
    sniper.alive = false;
    expect(whoIsMarked([sniper], { assist: false, revealed: new Set([12]), lastOne: null })).toEqual([]);
  });
});

describe("where a mark floats", () => {
  it("leaves men who stand apart where they are", () => {
    const places = placeMarks([
      { id: 1, x: 100, y: 300 },
      { id: 2, x: 400, y: 320 },
    ]);
    expect(places.get(1)).toEqual({ lift: 0, shift: 0 });
    expect(places.get(2)).toEqual({ lift: 0, shift: 0 });
  });

  it("never covers another man: a mark under a man on a tower rises above him", () => {
    // The sentry on the tower stands 14 px over the one at the barrier, in line with him.
    const places = placeMarks([
      { id: 1, x: 200, y: 286 },
      { id: 2, x: 202, y: 300 },
    ]);
    expect(places.get(1)?.lift).toBe(0);
    const lift = places.get(2)!.lift;
    // His caret now sits wholly above the man on the tower: its foot clears the tower man's head.
    expect(300 - MARK_GAP - lift).toBeLessThanOrEqual(286 - 2);
  });

  it("spreads the carets of men standing close together into a row over them, not a pile", () => {
    // A column of four walking 3 px apart: the carets side by side, about their middle, none lifted.
    const places = placeMarks([0, 1, 2, 3].map((i) => ({ id: i + 1, x: 500 + i * 3, y: 400 })));
    const xs = [1, 2, 3, 4].map((id) => 500 + (id - 1) * 3 + places.get(id)!.shift);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(MARK_W + 5);
    expect((xs[0]! + xs[3]!) / 2).toBeCloseTo(504.5);
    expect([1, 2, 3, 4].map((id) => places.get(id)!.lift)).toEqual([0, 0, 0, 0]);
    // A pair that is far enough apart is left alone.
    const apart = placeMarks([
      { id: 1, x: 500, y: 400 },
      { id: 2, x: 560, y: 402 },
    ]);
    expect(apart.get(1)?.shift).toBe(0);
    expect(apart.get(2)?.shift).toBe(0);
  });

  it("floats the distance label above the carets round it, never among them", () => {
    // The stage's three sentries at the guard post: the tower man above, two below, the nearest at the right.
    const heads = [
      { id: 1, x: 601, y: 490 },
      { id: 2, x: 592, y: 505 },
      { id: 3, x: 636, y: 503 },
    ];
    const places = placeMarks(heads);
    const lift = liftLabel(heads, places, 3);
    // The label's box, over his caret and lifted: clear of every other caret, and of every other man.
    const mine = places.get(3)!;
    const bottom = 503 - MARK_GAP - MARK_H - 4 - mine.lift - lift;
    const label = { x0: 636 + mine.shift - LABEL_W / 2, x1: 636 + mine.shift + LABEL_W / 2, top: bottom - LABEL_H, bottom };
    const hits = (x0: number, x1: number, top: number, bot: number) => label.x0 < x1 && label.x1 > x0 && label.top < bot && label.bottom > top;
    for (const o of heads.filter((h) => h.id !== 3)) {
      expect(hits(o.x - 4, o.x + 4, o.y - 2, o.y + 8)).toBe(false);
      const there = places.get(o.id)!;
      const caretBottom = o.y - MARK_GAP - there.lift;
      expect(hits(o.x + there.shift - MARK_W / 2, o.x + there.shift + MARK_W / 2, caretBottom - MARK_H, caretBottom)).toBe(false);
    }
    // Alone, it stays just over its own caret.
    expect(liftLabel([{ id: 9, x: 300, y: 300 }], placeMarks([{ id: 9, x: 300, y: 300 }]), 9)).toBe(0);
  });

  it("fades as the crosshair comes onto a man, and is whole when it is away", () => {
    expect(fadeNear(0)).toBe(0);
    expect(fadeNear(FADE_NEAR)).toBe(0);
    expect(fadeNear(FADE_FAR)).toBe(1);
    expect(fadeNear(900)).toBe(1);
    let last = 0;
    for (let px = FADE_NEAR; px <= FADE_FAR; px += 6) {
      expect(fadeNear(px)).toBeGreaterThanOrEqual(last);
      last = fadeNear(px);
    }
  });

  it("gives the distance to the nearest man only", () => {
    expect(
      nearestOf([
        { id: 1, range: 410 },
        { id: 2, range: 289 },
        { id: 3, range: 355 },
      ]),
    ).toBe(2);
    expect(nearestOf([])).toBeNull();
  });
});

describe("the scope's rim arrow", () => {
  // Through the scope at 900 px tall, a 7 degree view: about 7,400 px to a unit of tangent. The glass reaches 330 px.
  const focal = 7400;
  const reach = 330;
  /** A man `across` metres right and `up` metres above the line of sight, `range` metres out. */
  const man = (id: number, across: number, up: number, range = 300): CamMan => ({ id, x: across, y: up, z: -range });

  it("says nothing while a man is inside the glass", () => {
    // 4 m across at 300 m is 99 px from the reticle.
    expect(rimArrow([man(1, 4, 0), man(2, 80, 0)], focal, reach)).toBeNull();
  });

  it("points toward the man nearest the reticle, when none is in the glass", () => {
    const rim = rimArrow([man(1, 60, 0), man(2, 25, 0)], focal, reach);
    // 25 m across at 300 m is 616 px: out of the glass, and nearer than 60 m.
    expect(rim?.id).toBe(2);
  });

  it("points the way to pan: right, left, up and down", () => {
    const at = (across: number, up: number) => rimArrow([man(1, across, up)], focal, reach)!.angle;
    expect(at(30, 0)).toBeCloseTo(Math.PI / 2);
    expect(at(-30, 0)).toBeCloseTo(-Math.PI / 2);
    expect(at(0, 30)).toBeCloseTo(0);
    expect(Math.abs(at(0, -30))).toBeCloseTo(Math.PI);
    // Up and to the right is between up and right.
    expect(at(30, 30)).toBeCloseTo(Math.PI / 4);
    // Down and to the left is the other way about.
    expect(at(-30, -30)).toBeCloseTo((-3 * Math.PI) / 4);
  });

  it("has no arrow when there is no one to point to", () => {
    expect(rimArrow([], focal, reach)).toBeNull();
  });
});

describe("where a man is, in plain words", () => {
  const plan = testPlan();
  const landmarks = landmarksOf(plan);
  const where = (at: { x: number; y: number; z: number }, anchor?: string) => whereWords(at, plan.eye, 0, landmarks, anchor);
  const post = (id: string) => plan.posts.find((p) => p.id === id)!.at;

  it("knows the valley's landmarks by the names a player would use", () => {
    expect(new Set(landmarks.map((l) => l.name))).toEqual(new Set(["the watchtower", "the guard post", "the bridge", "the farm", "the chapel", "the dam"]));
    // The place players misread as a game checkpoint is never called that.
    expect(landmarks.some((l) => /checkpoint/i.test(l.name))).toBe(false);
  });

  it("describes a man by what stands by him, and which side of the next thing he is on", () => {
    expect(where(post("tower"))).toBe("by the watchtower, right of the guard post");
    expect(where(post("mg"))).toBe("by the guard post, left of the watchtower");
    expect(where(post("farm.gate"))).toBe("by the farm, left of the chapel");
    expect(where(post("dam.right"))).toBe("by the dam, right of the bridge");
  });

  it("says left and right as the player sees them: by the farm is left of the chapel, by the chapel is right of the farm", () => {
    expect(where(post("farm.gate"))).toBe("by the farm, left of the chapel");
    expect(where(post("village.well"))).toBe("by the chapel, right of the farm");
  });

  it("places a man with nothing near him between two landmarks", () => {
    expect(where({ x: 12, y: 0, z: -400 })).toBe("between the chapel and the guard post");
    expect(where({ x: -300, y: 0, z: -300 })).toBe("left of the farm");
  });

  it("names the counter-sniper's nest as the rules do", () => {
    const nest = plan.nests[0]!;
    expect(where(nest.exposed, nest.place)).toMatch(new RegExp(`^${nest.place}(, (left|right) of the .+)?$`));
    expect(where(nest.exposed, nest.place)).not.toContain("of the chapel");
  });
});
