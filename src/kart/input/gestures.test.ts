import { describe, expect, it } from "vitest";
import { turns } from "./gestures";
import { Rig, wheelHands, type SynthHand, type WheelPose } from "./testHands";

/** What a stretch of hands did, tick by tick. */
interface Seen {
  brake: boolean;
  drift: boolean;
  items: number;
  horns: number;
  emotes: Set<string | null>;
  last: Rig["last"];
}

/** A rig that has been driving straight with fists for a second, the way a race begins. */
function driving(options: ConstructorParameters<typeof Rig>[0] = {}): Rig {
  const rig = new Rig(options);
  rig.wheel(1, { angle: 0 });
  return rig;
}

/** Runs the hands `pose` says for `seconds` in 60 Hz steps, noting every gesture the wheel made. */
function watch(rig: Rig, seconds: number, pose: (t: number) => readonly SynthHand[]): Seen {
  const before = rig.last.input;
  const seen: Seen = { brake: false, drift: false, items: 0, horns: 0, emotes: new Set(), last: rig.last };
  const step = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += step) {
    const out = rig.run(step, (e) => pose(t + e));
    seen.last = out;
    if (out.input.brake > 0 || out.status.mode === "brake") seen.brake = true;
    if (out.input.drift) seen.drift = true;
    seen.items = out.input.itemPresses - before.itemPresses;
    seen.horns = (out.input.horn ?? 0) - (before.horn ?? 0);
    seen.emotes.add(out.input.emote ?? null);
  }
  return seen;
}

/** Fists on a level wheel. */
const fists = (over: Partial<WheelPose> = {}): SynthHand[] => wheelHands({ angle: 0, ...over });

/** The palms come together to `closest` (picture heights apart) and part again within `seconds`. */
function clap(rig: Rig, options: { seconds?: number; closest?: number; fingers?: WheelPose["fingers"]; angle?: number } = {}): Seen {
  const { seconds = 0.4, closest = 0.04, fingers = "open", angle = 0 } = options;
  return watch(rig, seconds, (t) => {
    const k = Math.sin((Math.PI * t) / seconds);
    return wheelHands({ angle, fingers, span: 0.5 - (0.5 - closest) * k });
  });
}

describe("the clap", () => {
  it("honks once: open palms come together and part, then fists are back on the wheel", () => {
    const rig = driving();
    const seen = clap(rig);
    expect(seen.horns).toBe(1);
    // The wheel does not take it for anything else.
    expect(seen.brake).toBe(false);
    expect(seen.drift).toBe(false);
    expect(seen.items).toBe(0);
    const after = watch(rig, 1.2, () => fists());
    expect(after.horns).toBe(0);
    expect(after.brake).toBe(false);
    expect(after.items).toBe(0);
    expect(after.last.input).toMatchObject({ horn: 1, throttle: 1, brake: 0, drift: false, itemPresses: 0, emote: null });
  });

  it("honks for a fist bump too, and for a quick clap and a slow one", () => {
    for (const [fingers, seconds] of [["fist", 0.4], ["open", 0.25], ["open", 0.5]] as const) {
      const rig = driving();
      expect(clap(rig, { fingers, seconds }).horns).toBe(1);
    }
  });

  it("is judged in hand lengths: the same clap with small, far hands honks too", () => {
    const rig = new Rig();
    const small = (span: number, fingers: WheelPose["fingers"]) => wheelHands({ angle: 0, span, fingers }).map((hand) => ({ ...hand, size: 0.03 }));
    rig.hold(1, small(0.2, "fist"));
    const seen = watch(rig, 0.4, (t) => small(0.2 - 0.18 * Math.sin((Math.PI * t) / 0.4), "open"));
    expect(seen.horns).toBe(1);
  });

  it("does not fire from driving, with the wobble of real tracking", () => {
    for (const yaw of [0, 90]) {
      const rig = new Rig({ jitter: 0.006 });
      rig.wheel(1, { angle: 0, yaw });
      const seen = watch(rig, 8, (t) => wheelHands({ angle: 25 * Math.sin(t * 1.3), yaw }));
      expect(seen.horns).toBe(0);
      expect([...seen.emotes]).toEqual([null]);
    }
  });

  it("does not fire when the hands only come together slowly", () => {
    const rig = driving();
    const seen = watch(rig, 4, (t) => wheelHands({ angle: 0, span: Math.max(0.04, 0.5 - 0.2 * t) }));
    expect(seen.horns).toBe(0);
    // ...and held together for a while, then parted, is a prayer, not a clap.
    const held = watch(rig, 3, (t) => wheelHands({ angle: 0, span: t < 1.5 ? 0.04 : 0.5 }));
    expect(held.horns).toBe(0);
  });

  it("does not fire while braking, nor with the wheel turned hard", () => {
    const braking = driving();
    braking.wheel(0.6, { angle: 0, fingers: "open" });
    expect(braking.last.input.brake).toBe(1);
    expect(clap(braking).horns).toBe(0);

    const hard = new Rig();
    hard.wheel(1, { angle: 45 });
    expect(hard.last.input.steer).toBe(1);
    expect(clap(hard, { angle: 45 }).horns).toBe(0);
  });

  it("honks again after a pause, not twice from one clap", () => {
    const rig = driving();
    expect(clap(rig).horns).toBe(1);
    expect(clap(rig, { seconds: 0.3 }).horns).toBe(0); // inside the cooldown
    watch(rig, 0.8, () => fists());
    expect(clap(rig).horns).toBe(1);
    expect(rig.last.input.horn).toBe(2);
  });

  it("still counts when the tracker loses a hand behind the other as the palms meet", () => {
    const rig = driving();
    const seen = watch(rig, 0.5, (t) => {
      const hands = wheelHands({ angle: 0, fingers: "open", span: 0.5 - 0.46 * Math.sin((Math.PI * t) / 0.5) });
      // Only the right hand is reported around the moment of contact.
      return t > 0.18 && t < 0.3 ? [hands[1]] : hands;
    });
    expect(seen.horns).toBe(1);
  });
});

describe("the cheer", () => {
  /** Open hands at the wheel's height, then lifted to `top` over `rise` seconds. */
  function cheer(rig: Rig, options: { top?: number; rise?: number; hold?: number; open?: number } = {}): Seen {
    const { top = 0.1, rise = 0.5, hold = 0.6, open = 0.4 } = options;
    // Open at the wheel first, as a player does; braking is the wheel's own business meanwhile.
    watch(rig, open, () => fists({ fingers: "open" }));
    return watch(rig, rise + hold, (t) => fists({ fingers: "open", centre: [0.5, 0.45 - (0.45 - top) * Math.min(1, t / rise)] }));
  }

  it("is two open hands raised high and held, for as long as they are up", () => {
    const rig = driving();
    const seen = cheer(rig);
    expect(seen.last.input.emote).toBe("cheer");
    // It is no hop, item, horn or brake once it has begun.
    expect(seen.drift).toBe(false);
    expect(seen.items).toBe(0);
    expect(seen.horns).toBe(0);
    expect(seen.last.input.brake).toBe(0);
    expect(seen.last.status.mode).toBe("drive");
    // Down again: it goes, and the wheel is back to normal.
    const down = watch(rig, 1.5, () => fists());
    expect(down.last.input.emote).toBeNull();
    expect(down.last.input).toMatchObject({ throttle: 1, brake: 0, drift: false, itemPresses: 0, horn: 0 });
  });

  it("needs the hands high enough, and long enough", () => {
    // Lifted off the wheel to brake, like the hop test's: not a cheer.
    const low = driving();
    expect(cheer(low, { top: 0.2 }).last.input.emote).toBeNull();
    // Up and straight down again.
    const brief = driving();
    const seen = watch(brief, 1.2, (t) => fists({ fingers: "open", centre: [0.5, t > 0.4 && t < 0.6 ? 0.1 : 0.45] }));
    expect(seen.emotes.has("cheer")).toBe(false);
  });

  it("is not made by fists thrown up, nor by one raised hand", () => {
    const hop = driving();
    const seen = watch(hop, 1.5, (t) => fists({ centre: [0.5, 0.45 - 0.35 * Math.min(1, t / 0.5)] }));
    expect(seen.emotes.has("cheer")).toBe(false);
    const one = driving();
    const raised = watch(one, 1.5, () => wheelHands({ angle: 0, left: { fingers: "open", y: 0.1 }, right: { fingers: "open", y: 0.45 } }));
    expect(raised.emotes.has("cheer")).toBe(false);
  });

  it("waits to have seen the wheel held before it can tell what is high", () => {
    const rig = new Rig();
    rig.hold(1, fists({ fingers: "open", centre: [0.5, 0.1] }));
    expect(rig.last.input.emote).toBeNull();
  });
});

describe("the wave", () => {
  /** A fist on the left of the wheel and the right hand open, swinging side to side `hz` times a second. */
  const wave = (hz: number, over: Partial<SynthHand> = {}) => (t: number): SynthHand[] => {
    const [left, right] = fists();
    return [left!, { ...right!, fingers: "open", x: right!.x + 0.07 * Math.sin(2 * Math.PI * hz * t), ...over }];
  };

  it("is one open hand swinging, the other a fist", () => {
    const rig = driving();
    const seen = watch(rig, 1.6, wave(2.5));
    expect(seen.last.input.emote).toBe("wave");
    expect(seen.items).toBe(0);
    expect(seen.horns).toBe(0);
    expect(seen.brake).toBe(false);
    // Fists again: it lets go, and the closing of the hand is no item.
    const after = watch(rig, 1.2, () => fists());
    expect(after.last.input.emote).toBeNull();
    expect(after.items).toBe(0);
  });

  it("is one open hand swinging with the other down, out of the picture", () => {
    const rig = driving();
    const seen = watch(rig, 1.6, (t) => [wave(2.5)(t)[1]!]);
    expect(seen.last.input.emote).toBe("wave");
    expect(seen.items).toBe(0);
  });

  it("is not a hand held still, a slow drift, or a swing of both hands", () => {
    const still = watch(driving(), 2, wave(0));
    expect(still.emotes.has("wave")).toBe(false);
    const slow = watch(driving(), 2, wave(0.4));
    expect(slow.emotes.has("wave")).toBe(false);
    // Both hands open and swinging is a brake and nothing more.
    const both = watch(driving(), 2, (t) => wheelHands({ angle: 0, fingers: "open" }).map((hand) => ({ ...hand, x: hand.x + 0.07 * Math.sin(2 * Math.PI * 2.5 * t) })));
    expect(both.emotes.has("wave")).toBe(false);
    expect(both.brake).toBe(true);
  });

  it("is not made by the wobble of tracking on an open hand", () => {
    const rig = new Rig({ jitter: 0.006 });
    rig.hold(1, fists());
    const seen = watch(rig, 3, (t) => wave(0)(t));
    expect(seen.emotes.has("wave")).toBe(false);
  });
});

describe("gestures and the wheel's own", () => {
  it("leave the item flick, the wheel jerked up and the brake as they were", () => {
    const flick = driving();
    const [left, right] = fists();
    const item = watch(flick, 0.7, (t) => [left!, { ...right!, fingers: t > 0.1 && t < 0.4 ? "open" : "fist" }]);
    expect(item.items).toBe(1);
    expect(item.horns).toBe(0);
    expect([...item.emotes]).toEqual([null]);

    // Once a hop; now the wheel drifts only with open hands, so it is nothing at all, and no cheer either.
    const lifted = driving();
    lifted.wheel(1, { angle: 30 });
    const jerk = watch(lifted, 0.2, (t) => wheelHands({ angle: 30, centre: [0.5, 0.45 - 0.25 * Math.min(1, t / 0.1)] }));
    expect(jerk.drift).toBe(false);
    expect(jerk.horns).toBe(0);
    expect(jerk.emotes.has("cheer")).toBe(false);

    const brake = driving();
    const slowed = watch(brake, 1, () => fists({ fingers: "open" }));
    expect(slowed.brake).toBe(true);
    expect(slowed.horns).toBe(0);
    expect([...slowed.emotes]).toEqual([null]);
  });

  it("do not set each other off: a clap is no wave or cheer, a wave is no horn, a cheer is no wave", () => {
    const clapped = driving();
    const clapping = clap(clapped);
    expect(clapping.horns).toBe(1);
    expect([...clapping.emotes]).toEqual([null]);

    const waved = driving();
    const waving = watch(waved, 2, (t) => {
      const [left, right] = fists();
      return [left!, { ...right!, fingers: "open", x: right!.x + 0.07 * Math.sin(2 * Math.PI * 2.5 * t) }];
    });
    expect(waving.horns).toBe(0);
    expect([...waving.emotes].filter(Boolean)).toEqual(["wave"]);

    const cheered = driving();
    watch(cheered, 0.4, () => fists({ fingers: "open" }));
    const cheering = watch(cheered, 1.2, (t) => fists({ fingers: "open", centre: [0.5, 0.45 - 0.35 * Math.min(1, t / 0.5)] }));
    expect(cheering.horns).toBe(0);
    expect(cheering.emotes.has("wave")).toBe(false);
    expect(cheering.emotes.has("cheer")).toBe(true);
  });
});

describe("turns", () => {
  const path = (...xs: number[]) => xs.map((x) => ({ x }));
  it("counts the times a path turns round, ignoring small wobbles", () => {
    expect(turns(path(0, 1, 2, 3), 0.5)).toBe(0);
    expect(turns(path(0, 1, 0, 1), 0.5)).toBe(2);
    expect(turns(path(0, 1, 0, 1, 0, 1), 0.5)).toBe(4);
    expect(turns(path(0, 0.1, 0, 0.1, 0.05), 0.5)).toBe(0);
    expect(turns(path(1, 0, 1), 0.5)).toBe(1);
    expect(turns([], 0.5)).toBe(0);
  });
});
