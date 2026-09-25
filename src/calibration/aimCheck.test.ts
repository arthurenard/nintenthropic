// The aim check, driven through the real aim pipeline (AimController) by
// synthetic hands, as tests/test_shot_calibration.py drives the desktop's.
import { describe, expect, it } from "vitest";
import type { CalibrationTarget } from "../engine/types";
import { gaussian, seededRandom } from "../engine/random";
import { AimController } from "../input/aim";
import { apply, type Matrix } from "../input/homography";
import { palmSpan } from "../input/hand";
import { asCameraSees, makeHand } from "../input/synthetic";
import { AimCheck, PLAY_ANYWAY_AFTER, tipFor, type ShotEvent } from "./aimCheck";
import { AIM_RADIUS, READY_SCORE, aimScore, measure, spread } from "./score";
import { aimKey, loadAim, saveAim, type CameraIdentity, type KeyValueStore } from "./storage";

const VIEWPORT = { width: 1440, height: 900 };

/** Nine targets over the view, as a game's stage would give them. */
const TARGETS: CalibrationTarget[] = [0.15, 0.5, 0.85].flatMap((y, row) =>
  [0.12, 0.5, 0.88].map((x, column) => ({ id: `t${row * 3 + column}`, x, y, radius: 0.03 })),
);

/** Where this player's fingertip sits (mirrored camera image) when aiming at a
 * point of the view: a camera above the screen, a little rotated. */
function pointerFor([x, y]: readonly [number, number], shift: readonly [number, number] = [0, 0]): [number, number] {
  return [0.3 + 0.4 * x + 0.03 * y + shift[0], 0.28 + 0.36 * y - 0.02 * x + shift[1]];
}

/** The inverse of pointerFor: the map a perfect aim check would learn. */
function trueMap(): Matrix {
  // p = M v + c, so v = M^-1 (p - c).
  const [a, b, c, d] = [0.4, 0.03, -0.02, 0.36];
  const det = a * d - b * c;
  const [ia, ib, ic, id] = [d / det, -b / det, -c / det, a / det];
  const [cx, cy] = [0.3, 0.28];
  return [ia, ib, -(ia * cx + ib * cy), ic, id, -(ic * cx + id * cy), 0, 0, 1];
}

interface ShotOptions {
  /** Where the player's hand aims instead of the lit target (a wild shot). */
  aimAt?: readonly [number, number];
  /** How far the fingertip wanders from the true aim, in camera fractions. */
  noise?: number;
  /** The fingertip jerks away as the thumb folds. */
  kick?: boolean;
  /** Frames spent part-folded before the shot. */
  pause?: number;
  /** A systematic shift of the hand, as if the camera had moved. */
  shift?: readonly [number, number];
}

/** A player at 30 fps: the real aim controller feeding the real aim check. */
class Player {
  readonly control = new AimController();
  readonly check: AimCheck;
  clock = 0;
  private version = 0;
  private readonly noise = gaussian(seededRandom(7));

  constructor(saved: Matrix | null = null) {
    this.check = new AimCheck({ saved, targets: TARGETS, viewport: VIEWPORT });
    if (saved) this.control.setMapping(saved);
  }

  frame(degrees: number, tip: readonly [number, number] | null): ShotEvent | null {
    this.clock += 1 / 30;
    const hand = tip ? asCameraSees(makeHand({ thumbDegrees: degrees, indexTip: tip })) : null;
    const reading = this.control.update(hand, this.clock);
    const event = this.check.observe(
      { pointer: reading.pointer, armed: reading.armed, travel: reading.travel, fired: reading.fired, span: hand ? palmSpan(hand) : undefined },
      this.clock,
    );
    if (this.check.mappingVersion !== this.version && this.check.mapping) {
      this.version = this.check.mappingVersion;
      this.control.setMapping(this.check.mapping);
    }
    return event;
  }

  /** Aim at the lit target with the thumb up, then fold it to fire. */
  shoot(options: ShotOptions = {}): ShotEvent {
    const target = this.check.lit!;
    const aim = pointerFor(options.aimAt ?? [target.x, target.y], options.shift);
    const wobble = () => [aim[0] + this.noise(0, options.noise ?? 0), aim[1] + this.noise(0, options.noise ?? 0)] as const;
    let event: ShotEvent | null = null;
    // Half a second a shot: as fast as the aim check takes them.
    for (let i = 0; i < 11; i++) this.frame(20, wobble());
    for (let i = 0; i < (options.pause ?? 0); i++) this.frame(42, wobble());
    for (let i = 0; i < 4; i++) event = this.frame(70, options.kick ? [0.95, 0.95] : wobble()) ?? event;
    expect(event, "every fold should fire exactly one shot").not.toBeNull();
    return event!;
  }
}

const accurate = (map: Matrix | null, tolerance: number) => {
  expect(map).not.toBeNull();
  for (const target of TARGETS) {
    const landed = apply(map!, pointerFor([target.x, target.y]))!;
    expect(Math.abs(landed[0] - target.x)).toBeLessThan(tolerance);
    expect(Math.abs(landed[1] - target.y)).toBeLessThan(tolerance);
  }
};

describe("the aim score", () => {
  it("is the chance a shot lands within R", () => {
    expect(aimScore(0)).toBe(1);
    expect(aimScore(Number.POSITIVE_INFINITY)).toBe(0);
    // 95% needs σ = R / sqrt(2 ln 20).
    const sigma = AIM_RADIUS / Math.sqrt(2 * Math.log(20));
    expect(aimScore(sigma)).toBeCloseTo(READY_SCORE, 12);
    expect(aimScore(sigma * 1.01)).toBeLessThan(READY_SCORE);
  });

  it("estimates σ as a 2D Gaussian and the bias as the mean", () => {
    const { sigma, bias } = spread([
      [0.01, 0],
      [-0.01, 0],
      [0, 0.01],
      [0, -0.01],
    ]);
    expect(sigma).toBeCloseTo(Math.sqrt(0.0004 / 8), 12);
    expect(bias[0]).toBeCloseTo(0, 12);
    expect(bias[1]).toBeCloseTo(0, 12);
  });

  it("wants three errors, 95% and a small bias", () => {
    expect(measure([[0, 0], [0, 0]]).ready).toBe(false);
    expect(measure([[0, 0], [0, 0], [0, 0]]).ready).toBe(true);
    // Tight, but every shot to the left by R/2: a steady hand on a crooked map.
    const crooked = Array.from({ length: 6 }, () => [-AIM_RADIUS * 0.55, 0] as const);
    expect(measure(crooked).score!).toBeGreaterThan(READY_SCORE);
    expect(measure(crooked).ready).toBe(false);
  });

  it("is measured over the last six errors only", () => {
    const wild = [0.3, 0.3] as const;
    const good = [0.001, -0.001] as const;
    expect(measure([wild, good, good, good, good, good, good]).ready).toBe(true);
    expect(measure([wild, good, good, good, good, good]).ready).toBe(false);
  });
});

describe("a first aim check", () => {
  it("learns in two shots, fits the full map on the third, and ends on its own at 95%", () => {
    const player = new Player();
    const check = player.check;
    expect(check.mapping).toBeNull();
    expect(check.words.title).toBe("Shoot the lit target.");

    expect(player.shoot().outcome).toBe("hit"); // a learning shot breaks its target
    expect(check.mapping).toBeNull();
    player.shoot();
    expect(check.fit).toBe("scaled"); // the crosshair appears
    expect(check.words.title).toBe("There’s your crosshair.");
    // The third shot is aimed with the crosshair on, but a map of scale and
    // offset alone cannot know how the camera is turned: what it predicted
    // says nothing yet about the player, so it is shown, not scored.
    const third = player.shoot();
    expect(third.landed).not.toBeNull();
    expect(check.errors.length).toBe(0);
    expect(check.fit).toBe("affine");
    player.shoot();
    player.shoot();
    expect(check.done).toBe(false);
    player.shoot();
    // Shots four, five and six were each predicted before they were learned from.
    expect(check.errors.length).toBe(3);
    expect(check.done).toBe(true);
    expect(check.shots).toBe(6);
    expect(check.measure.score!).toBeGreaterThanOrEqual(READY_SCORE);
    expect(check.words.title).toMatch(/^Aim \d+%$/);
    accurate(check.mapping, 0.002);
  });

  it("opens with two targets far apart on both axes, then one off their line", () => {
    const player = new Player();
    const first = player.check.lit!;
    player.shoot();
    const second = player.check.lit!;
    player.shoot();
    const third = player.check.lit!;
    expect(Math.abs(first.x - second.x)).toBeGreaterThan(0.7);
    expect(Math.abs(first.y - second.y)).toBeGreaterThan(0.6);
    const area = Math.abs((second.x - first.x) * (third.y - first.y) - (third.x - first.x) * (second.y - first.y));
    expect(area).toBeGreaterThan(0.3);
  });

  it("learns from the aim before the fold, not the hand's kick as it fires", () => {
    const player = new Player();
    while (!player.check.done) player.shoot({ kick: true });
    accurate(player.check.mapping, 0.002);
  });

  for (const pause of [0, 7, 10, 20]) {
    it(`keeps a fold that pauses part way (${pause} frames)`, () => {
      // Aim samples expired a quarter second after the thumb left "up"; a fold
      // that paused longer reached the trigger with nothing left.
      const player = new Player();
      expect(player.shoot({ pause }).outcome).toBe("hit");
      expect(player.check.shots).toBe(1);
    });
  }

  it("does not leave a given-up fold's aim behind for the next one", () => {
    const player = new Player();
    const target = player.check.lit!;
    const old: [number, number] = [0.3, 0.3];
    const right = pointerFor([target.x, target.y]);
    for (let i = 0; i < 10; i++) player.frame(20, old);
    for (let i = 0; i < 10; i++) player.frame(42, old);
    for (let i = 0; i < 10; i++) player.frame(20, right);
    for (let i = 0; i < 4; i++) player.frame(70, right);
    player.shoot();
    // Two shots fit a map that passes exactly through both: the first one's
    // aim was the one it finished on.
    const landed = apply(player.check.mapping!, right)!;
    expect(landed[0]).toBeCloseTo(target.x, 9);
    expect(landed[1]).toBeCloseTo(target.y, 9);
  });

  it("refuses two shots from the same spot, and keeps the target lit", () => {
    const player = new Player();
    const first = player.check.lit!;
    player.shoot();
    const second = player.check.lit!;
    const event = player.shoot({ aimAt: [first.x, first.y] });
    expect(event.outcome).toBe("refused");
    expect(player.check.lit!.id).toBe(second.id);
    expect(player.check.mapping).toBeNull();
    expect(player.check.words.title).toBe("Those two were too alike.");
  });

  it("does not count a shot it never saw aimed", () => {
    const check = new AimCheck({ saved: null, targets: TARGETS, viewport: VIEWPORT });
    check.observe({ pointer: [0.5, 0.5], armed: true, travel: 0.0, fired: false }, 0);
    // The camera went quiet for half a second: what it saw before is stale.
    const event = check.observe({ pointer: [0.5, 0.5], armed: false, travel: 1, fired: true }, 0.5);
    expect(event!.outcome).toBe("unaimed");
    expect(check.shots).toBe(0);
    expect(check.words.title).toBe("Raise your thumb first.");
  });

  it("drops a wild shot from the map instead of bending it", () => {
    const player = new Player();
    for (let i = 0; i < 4; i++) player.shoot();
    if (!player.check.done) player.shoot({ aimAt: [0.5 + 0.2, 0.5 - 0.2] }); // yanked off target
    let shots = 0;
    while (!player.check.done && shots++ < 12) player.shoot();
    expect(player.check.done).toBe(true);
    accurate(player.check.mapping, 0.004);
  });

  it("offers Play Anyway after twelve shots below 95%, with one tip", () => {
    const player = new Player();
    for (let i = 0; i < PLAY_ANYWAY_AFTER - 1; i++) player.shoot({ noise: 0.03 });
    expect(player.check.canPlayAnyway).toBe(false);
    player.shoot({ noise: 0.03 });
    expect(player.check.done).toBe(false);
    expect(player.check.canPlayAnyway).toBe(true);
    expect(player.check.tip).toBe("Keep your finger still as your thumb folds.");
    expect(player.check.words.detail).toBe(player.check.tip);
  });
});

describe("a returning player", () => {
  it("finishes in three shots when the saved aim still fits", () => {
    const player = new Player(trueMap());
    expect(player.check.words.title).toBe("Welcome back.");
    player.shoot();
    player.shoot();
    expect(player.check.done).toBe(false);
    player.shoot();
    expect(player.check.done).toBe(true);
    expect(player.check.shots).toBe(3);
    expect(player.check.fit).toBe("saved"); // the verified map is the one played on
  });

  it("relearns when the camera has moved since", () => {
    const player = new Player(trueMap());
    const shift = [0.06, -0.04] as const;
    for (let i = 0; i < 3; i++) player.shoot({ shift });
    expect(player.check.done).toBe(false);
    let shots = 3;
    while (!player.check.done && shots++ < PLAY_ANYWAY_AFTER) player.shoot({ shift });
    expect(player.check.done).toBe(true);
    expect(player.check.fit).toBe("affine");
  });
});

describe("the tip", () => {
  const base = { frames: 400, framesWithoutHand: 0, spans: Array(20).fill(0.15), edgeShots: 0 };
  it("names what the camera saw", () => {
    expect(tipFor({ ...base, edgeShots: 3 })).toMatch(/camera’s view/);
    expect(tipFor({ ...base, framesWithoutHand: 200 })).toMatch(/light/);
    expect(tipFor({ ...base, spans: Array(20).fill(0.05) })).toMatch(/closer/);
    expect(tipFor({ ...base, spans: Array(20).fill(0.4) })).toMatch(/Sit back/);
    expect(tipFor(base)).toMatch(/still/);
  });
});

/** Words a player never reads (DESIGN.md, Voice). */
const ENGINEERING = ["calibrat", "rig", "track", "fused", "landmark", "session", "model", "sigma", "affine", "fit"];

describe("the words", () => {
  it("are short, second person, and free of engineering", () => {
    const said: string[] = [];
    const listen = (check: AimCheck) => said.push(check.words.title, check.words.detail, check.tip ?? "");
    const fresh = new Player();
    listen(fresh.check);
    while (!fresh.check.done) {
      fresh.shoot();
      listen(fresh.check);
    }
    const noisy = new Player();
    for (let i = 0; i < PLAY_ANYWAY_AFTER; i++) {
      noisy.shoot({ noise: 0.03 });
      listen(noisy.check);
    }
    listen(new Player(trueMap()).check);
    for (const line of new Set(said.filter(Boolean))) {
      expect(line.length, line).toBeLessThanOrEqual(64);
      expect(ENGINEERING.some((word) => line.toLowerCase().includes(word)), line).toBe(false);
    }
  });
});

describe("the saved aim", () => {
  class Memory implements KeyValueStore {
    readonly items = new Map<string, string>();
    getItem(key: string) {
      return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.items.set(key, value);
    }
    removeItem(key: string) {
      this.items.delete(key);
    }
  }
  const camera: CameraIdentity = { deviceId: "cam-1", width: 1280, height: 720 };

  it("comes back for the same camera at the same size", () => {
    const store = new Memory();
    expect(saveAim(store, camera, trueMap())).toBe(true);
    expect(loadAim(store, camera)).toEqual([...trueMap()]);
    expect(loadAim(store, { ...camera, deviceId: "cam-2" })).toBeNull();
    expect(loadAim(store, { ...camera, width: 640, height: 480 })).toBeNull();
  });

  it("is thrown away when it cannot be read", () => {
    const store = new Memory();
    for (const junk of ["{nope", "null", JSON.stringify({ version: 99, matrix: [...trueMap()] }), JSON.stringify({ version: 1, matrix: [1, 2] })]) {
      store.setItem(aimKey(camera), junk);
      expect(loadAim(store, camera)).toBeNull();
      expect(store.items.has(aimKey(camera))).toBe(false);
    }
  });

  it("is thrown away when it stretches the hand beyond sense", () => {
    const store = new Memory();
    saveAim(store, camera, [60, 0, -30, 0, 1, 0, 0, 0, 1]);
    expect(loadAim(store, camera)).toBeNull();
  });

  it("is simply not kept by a window that cannot store anything", () => {
    const refusing: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(saveAim(refusing, camera, trueMap())).toBe(false);
    expect(loadAim(refusing, camera)).toBeNull();
    expect(loadAim(null, camera)).toBeNull();
  });

  it("carries a returning player through the whole check", () => {
    const store = new Memory();
    const first = new Player(loadAim(store, camera));
    while (!first.check.done) first.shoot();
    saveAim(store, camera, first.check.mapping!);
    const again = new Player(loadAim(store, camera));
    for (let i = 0; i < 3; i++) again.shoot();
    expect(again.check.done).toBe(true);
  });
});
