// Ported from tests/test_aiming.py and the trigger cases of
// tests/test_shot_calibration.py: one camera, the same poses, the same numbers.
import { describe, expect, it } from "vitest";
import { gaussian, seededRandom } from "../engine/random";
import { AimController, Recoil, type AimOptions, type AimReading } from "./aim";
import { angleBetween, palmSpan, thumbAngle, thumbExtension, thumbPull } from "./hand";
import { boxMapping, type Matrix } from "./homography";
import { asCameraSees, makeHand, type HandPose } from "./synthetic";

const PROFILE = boxMapping([0.2, 0.2], [0.8, 0.8]);

// beta=0 and a wide-open cutoff keep the filter out of the way of assertions.
const controller = (options: AimOptions = {}) =>
  new AimController({ minCutoff: 1e4, beta: 0, mapping: PROFILE, ...options });

/** The camera's view of a synthetic hand posed as the player sees it. */
const seen = (pose: HandPose) => asCameraSees(makeHand(pose));

/** Drives a controller with a synthetic hand on a 30 fps clock. Poses are held
 * for a few frames, as a real hand would, rather than teleported between them. */
class Pistol {
  static readonly FRAME = 1 / 30;
  readonly control: AimController;
  clock = 0;
  shots = 0;

  constructor(options: AimOptions = {}) {
    this.control = controller(options);
  }

  hold(degrees: number, frames = 3, pose: HandPose = {}): AimReading {
    let aim!: AimReading;
    for (let i = 0; i < frames; i++) {
      this.clock += Pistol.FRAME;
      aim = this.control.update(seen({ thumbDegrees: degrees, ...pose }), this.clock);
      if (aim.fired) this.shots++;
    }
    return aim;
  }

  loseHand(frames = 2): AimReading {
    let aim!: AimReading;
    for (let i = 0; i < frames; i++) {
      this.clock += Pistol.FRAME;
      aim = this.control.update(null, this.clock);
    }
    return aim;
  }
}

describe("hand geometry", () => {
  it("measures the right angle and the degenerate case", () => {
    expect(angleBetween([1, 0], [0, 1])).toBeCloseTo(90, 9);
    expect(angleBetween([1, 0], [-1, 0])).toBeCloseTo(180, 9);
    expect(angleBetween([1, 0], [1, 0])).toBeCloseTo(0, 9);
    expect(angleBetween([0, 0], [0, 0])).toBe(0);
  });

  it("measures the thumb's rotation away from the hand's up axis", () => {
    expect(thumbAngle(makeHand({ thumbDegrees: 0 }))).toBeCloseTo(0, 9);
    expect(thumbAngle(makeHand({ thumbDegrees: 25 }))).toBeCloseTo(25, 9);
    expect(thumbAngle(makeHand({ thumbDegrees: -80 }))).toBeCloseTo(80, 9);
  });

  it("survives the player tilting their hand", () => {
    // The whole point of measuring against the hand instead of the screen.
    expect(thumbAngle(makeHand({ thumbDegrees: 30, roll: 55 }))).toBeCloseTo(
      thumbAngle(makeHand({ thumbDegrees: 30, roll: 0 })),
      9,
    );
  });

  it("ignores the distance from the camera", () => {
    const near = makeHand({ thumbDegrees: 35, reach: 0.9, scale: 1 });
    const far = makeHand({ thumbDegrees: 35, reach: 0.9, scale: 0.4 });
    expect(thumbAngle(far)).toBeCloseTo(thumbAngle(near), 9);
    expect(thumbExtension(far)).toBeCloseTo(thumbExtension(near), 9);
  });

  it("measures extension in palm spans", () => {
    expect(palmSpan(makeHand())).toBeCloseTo(0.2, 9);
    expect(thumbExtension(makeHand({ reach: 0.75 }))).toBeCloseTo(0.75, 9);
  });

  it("reads the same, mirrored or not", () => {
    const hand = makeHand({ thumbDegrees: 40, reach: 0.7, roll: 20 });
    expect(thumbPull(asCameraSees(hand))).toBeCloseTo(thumbPull(hand), 12);
  });

  for (const scale of [0.4, 1, 2]) {
    for (const roll of [-80, 0, 65]) {
      it(`reads the thumb the same at scale ${scale}, roll ${roll}`, () => {
        expect(thumbPull(makeHand({ thumbDegrees: 20, scale, roll }))).toBeLessThan(0.3);
        expect(thumbPull(makeHand({ thumbDegrees: 70, scale, roll }))).toBeGreaterThan(0.5);
        expect(thumbPull(makeHand({ thumbDegrees: 20, reach: 0.4, scale, roll }))).toBeGreaterThan(0.5);
      });
    }
  }
});

describe("the trigger", () => {
  it("has no aim without a hand", () => {
    const aim = controller().update(null, 0);
    expect(aim.position).toBeNull();
    expect(aim.armed || aim.fired).toBe(false);
  });

  it("arms with the thumb up and fires once as it rotates down", () => {
    const pistol = new Pistol();
    const cocked = pistol.hold(20);
    expect(cocked.armed).toBe(true);
    expect(cocked.travel).toBeCloseTo(0, 9);

    const down = pistol.hold(70);
    expect(down.armed).toBe(false);
    expect(down.travel).toBeCloseTo(1, 9);
    expect(pistol.shots).toBe(1);

    pistol.hold(70, 15);
    expect(pistol.shots).toBe(1); // holding the thumb down must not machine-gun
  });

  it("never fires while the thumb still points up", () => {
    const pistol = new Pistol();
    for (const degrees of [20, 22, 25, 30, 28, 24, 31, 19]) pistol.hold(degrees, 2);
    expect(pistol.shots).toBe(0);
  });

  it("does not re-arm on a small dip after firing", () => {
    const pistol = new Pistol();
    pistol.hold(20);
    pistol.hold(75);
    expect(pistol.shots).toBe(1);
    // Wobbling a few degrees around the fold is not a return.
    for (const angle of [72, 74, 71, 75, 73, 72]) expect(pistol.hold(angle, 2).armed).toBe(false);
    expect(pistol.shots).toBe(1);
  });

  it("fires one shot per fold in a burst", () => {
    const pistol = new Pistol();
    for (let i = 0; i < 5; i++) {
      pistol.hold(20);
      pistol.hold(75);
    }
    expect(pistol.shots).toBe(5);
  });

  it("cannot be fired by a single misread frame", () => {
    const pistol = new Pistol();
    pistol.hold(20);
    pistol.hold(120, 1); // one wild misread from the model
    pistol.hold(20, 2);
    expect(pistol.shots).toBe(0); // one bad frame is outvoted by its neighbours
  });

  it("disarms when the hand is lost for real", () => {
    const pistol = new Pistol();
    expect(pistol.hold(20).armed).toBe(true);
    pistol.loseHand(15); // half a second: properly gone
    pistol.hold(75);
    expect(pistol.shots).toBe(0); // no shot on re-acquisition from a stale armed state
  });

  it("keeps the shot through a dropped frame or two", () => {
    // Resetting on one missing frame disarmed the trigger - which turned the
    // shot into nothing.
    const pistol = new Pistol();
    expect(pistol.hold(20).armed).toBe(true);
    pistol.loseHand(2); // a 70 ms blip
    pistol.hold(75);
    expect(pistol.shots).toBe(1);
  });

  it("says where the thumb is while the hand blinks out", () => {
    const pistol = new Pistol();
    expect(pistol.hold(70).armed).toBe(false); // first seen folded: not ready
    expect(pistol.loseHand(2).armed).toBe(false); // and a blip does not cock it

    pistol.loseHand(15); // properly gone
    expect(pistol.hold(20).armed).toBe(true);
    const armed: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      armed.push(pistol.loseHand(2).armed);
      armed.push(pistol.hold(20).armed);
    }
    expect(armed.every(Boolean)).toBe(true); // a raised thumb stays cocked through every blip
  });

  it("needs a release between shots, and never fires on acquiring a folded thumb", () => {
    const control = new AimController(); // the default filter and map
    const shots: number[] = [];
    const sequence = [...Array(8).fill(70), ...Array(4).fill(20), ...Array(8).fill(70), ...Array(4).fill(20), ...Array(4).fill(70)];
    sequence.forEach((degrees, i) => {
      if (control.update(seen({ thumbDegrees: degrees }), i * 0.05).fired) shots.push(i);
    });
    expect(shots.length).toBe(2);
    control.update(null, 10);
    expect(control.update(seen({ thumbDegrees: 70 }), 11).fired).toBe(false);
  });

  it("refuses thresholds without hysteresis", () => {
    expect(() => new AimController({ fireAbove: 0.3, armBelow: 0.8 })).toThrow();
  });
});

describe("the aim point", () => {
  it("is mapped through the fitted map", () => {
    // The box runs 0.2..0.8, so those edges are the edges of the window.
    for (const [tip, expected] of [
      [[0.2, 0.5], 0],
      [[0.8, 0.5], 1],
      [[0.5, 0.5], 0.5],
    ] as const) {
      const pistol = new Pistol();
      const position = pistol.hold(20, 8, { indexTip: tip }).position!;
      expect(Math.abs(position[0] - expected)).toBeLessThan(1e-3);
    }
  });

  it("is clamped to the edge when aiming outside the box, but says how far out", () => {
    const pistol = new Pistol();
    const aim = pistol.hold(20, 8, { indexTip: [0.02, 0.99] });
    expect(aim.position![0]).toBeCloseTo(0, 3);
    expect(aim.position![1]).toBeCloseTo(1, 3);
    expect(aim.unclamped![0]).toBeLessThan(-0.2);
    expect(aim.unclamped![1]).toBeGreaterThan(1.2);
  });

  it("is not thrown to the opposite corner from past a map's horizon", () => {
    const legacy: Matrix = [
      2.871934573670249, -0.061145355513888985, -1.2142552975804075, -0.9041251222717106, 2.3601729633571686,
      -0.8949543501390803, -1.2131671258909114, 0.4386268157484197, 1.0,
    ];
    const control = controller({ mapping: legacy });
    expect(control.update(seen({ thumbDegrees: 20, indexTip: [0.95, 0.2] }), 0).position).toBeNull();
  });

  it("forgets the filter when a new map arrives", () => {
    const control = new AimController({ mapping: PROFILE });
    for (let i = 0; i < 10; i++) control.update(seen({ thumbDegrees: 20, indexTip: [0.5, 0.5] }), i / 30);
    control.setMapping(boxMapping([0, 0], [1, 1]));
    const aim = control.update(seen({ thumbDegrees: 20, indexTip: [0.3, 0.3] }), 11 / 30);
    expect(aim.position![0]).toBeCloseTo(0.3, 9); // no slide from where the old map had it
  });
});

// --- sensitivity: quick, lazy, real-world folds ------------------------------

function noisyPistol(seed = 0) {
  const noise = gaussian(seededRandom(seed));
  const control = controller();
  return (angles: number[], deviation = 2.0) => {
    let shots = 0;
    angles.forEach((angle, index) => {
      if (control.update(seen({ thumbDegrees: angle + noise(0, deviation) }), index / 30).fired) shots++;
    });
    return shots;
  };
}

const linspace = (from: number, to: number, count: number) =>
  Array.from({ length: count }, (_, i) => (count === 1 ? from : from + ((to - from) * i) / (count - 1)));

function foldSequence(peak: number, frames: number, repeats = 4): number[] {
  const rest = Array(10).fill(18);
  const stroke = [...linspace(18, peak, frames), peak, ...linspace(peak, 18, frames)];
  const sequence = [...rest];
  for (let i = 0; i < repeats; i++) sequence.push(...stroke, ...rest.slice(0, 6));
  return sequence;
}

describe("every kind of fold", () => {
  for (const [label, peak, frames] of [
    ["snappy full fold", 75, 2],
    ["quick lazy fold", 55, 3],
    ["slow lazy fold", 50, 6],
  ] as const) {
    it(`fires every time: ${label}`, () => {
      // A lazy 50-degree fold is still unmistakably a fold, and it must fire -
      // reliably, not sometimes.
      expect(noisyPistol()(foldSequence(peak, frames))).toBe(4);
    });
  }

  it("never fires on tremor at rest", () => {
    const tremor = Array.from({ length: 600 }, (_, i) => 18 + 4 * Math.sin(i / 3));
    expect(noisyPistol()(tremor, 2.5)).toBe(0); // 20 s of wobble at rest
  });

  it("fires once for a held fold", () => {
    const sequence = [...foldSequence(75, 3, 1).slice(0, -16), ...Array(90).fill(74)];
    expect(noisyPistol()(sequence)).toBe(1);
  });
});

describe("recoil", () => {
  it("sits still before the gun has fired", () => {
    expect(new Recoil().offset(12.3)).toEqual([0, 0]);
  });

  it("kicks the crosshair up, then settles", () => {
    const recoil = new Recoil({ kick: 30, rise: 0.04, decay: 0.2 });
    recoil.fire(0);
    const peak = recoil.offset(0.04)[1];
    expect(peak).toBeCloseTo(-30, 9); // up is negative on screen
    const settling = recoil.offset(0.25)[1];
    expect(peak < settling && settling < 0).toBe(true);
    expect(Math.abs(recoil.offset(2.0)[1])).toBeLessThan(0.5);
  });

  it("stacks when firing again before it settles", () => {
    const single = new Recoil({ kick: 30 });
    single.fire(0);
    const double = new Recoil({ kick: 30 });
    double.fire(0);
    double.fire(0.05);
    expect(Math.abs(double.offset(0.09)[1])).toBeGreaterThan(Math.abs(single.offset(0.09)[1]));
  });

  it("caps the stack", () => {
    const recoil = new Recoil({ kick: 20 });
    for (let shot = 0; shot < 30; shot++) recoil.fire(shot * 0.01);
    expect(Math.abs(recoil.offset(0.3)[1])).toBeLessThanOrEqual(2.5 * 20);
  });

  it("is disabled entirely by a zero kick, and remembers nothing", () => {
    const recoil = new Recoil({ kick: 0 });
    for (let shot = 0; shot < 500; shot++) {
      recoil.fire(shot * 0.5);
      recoil.offset(shot * 0.5);
    }
    expect(recoil.offset(0.04)).toEqual([0, 0]);
    expect(recoil.shots).toEqual([]);
  });

  it("forgets old shots rather than accumulating them", () => {
    const recoil = new Recoil({ kick: 25 });
    for (let shot = 0; shot < 200; shot++) {
      recoil.fire(shot * 0.5);
      recoil.offset(shot * 0.5);
    }
    expect(recoil.shots.length).toBeLessThan(10);
  });
});
