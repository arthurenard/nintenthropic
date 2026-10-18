import { describe, expect, it } from "vitest";
import { gaussian, seededRandom } from "../engine/random";
import type { HandFrame, HandSource } from "../tracking/types";
import { AimController, DEFAULT_STEADINESS } from "./aim";
import { EXIT_MOMENT, HandInput, MAX_PREDICTION, STALE_FRAME } from "./handInput";
import { TRUST_AFTER } from "./trust";
import { boxMapping } from "./homography";
import { asCameraSees, makeHand, type HandPose } from "./synthetic";

/** A camera that publishes whatever the test hands it. */
class FakeCamera implements HandSource {
  private readonly listeners = new Set<(frame: HandFrame) => void>();
  private newest: HandFrame | null = null;
  private sequence = 0;

  subscribe(listener: (frame: HandFrame) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latest() {
    return this.newest;
  }

  show(pose: HandPose | null, capturedAt: number) {
    const frame: HandFrame = {
      landmarks: pose ? asCameraSees(makeHand(pose)) : null,
      handedness: pose ? "Right" : null,
      hands: [],
      capturedAt,
      sequence: ++this.sequence,
    };
    this.newest = frame;
    for (const listener of this.listeners) listener(frame);
  }
}

const VIEW = { width: 1440, height: 900 };
// The fingertip's sweep 0.2..0.8 of the picture covers the view.
const MAP = boxMapping([0.2, 0.2], [0.8, 0.8]);

function setup() {
  const camera = new FakeCamera();
  const input = new HandInput(camera, () => VIEW, MAP);
  input.compensate = false;
  return { camera, input };
}

describe("the hand as an input", () => {
  it("reports one shot per fold, however often it is read", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 5; i++) camera.show({ thumbDegrees: 20 }, (t += 33));
    for (let i = 0; i < 3; i++) camera.show({ thumbDegrees: 75 }, (t += 33));
    const reads = [input.sample(t + 5), input.sample(t + 10), input.sample(t + 20)];
    expect(reads.filter((aim) => aim.fired)).toHaveLength(1);
    expect(reads[0]!.fired).toBe(true);
  });

  it("puts the shot where the hand aimed before the fold, not where the fold threw it", () => {
    // How far the crosshair has moved a frame later is the filter's: this case was tuned on Balanced,
    // and the player's default, Steady, holds it back a little longer (the shot itself is the same).
    AimController.steadiness = "balanced";
    try {
      const { camera, input } = setup();
      let t = 0;
      for (let i = 0; i < 6; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
      // The fingertip jerks as the thumb snaps down.
      for (let i = 0; i < 2; i++) camera.show({ thumbDegrees: 75, indexTip: [0.56, 0.58] }, (t += 33));
      const shot = input.sample(t);
      expect(shot.fired).toBe(true);
      expect(shot.x).toBeCloseTo(0.5, 1);
      expect(shot.y).toBeCloseTo(0.5, 1);
      expect(Math.abs(input.sample(t + 1).y - 0.5)).toBeGreaterThan(0.05); // and then it follows the hand again
    } finally {
      AimController.steadiness = DEFAULT_STEADINESS;
    }
  });

  it("says the crosshair is off the screen before clamping it to the edge", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 10; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
    expect(input.sample(t).offscreen).toBe(false);
    // 0.86 in the picture is 1.1 of the view: well past the right edge.
    for (let i = 0; i < 10; i++) camera.show({ thumbDegrees: 20, indexTip: [0.86, 0.5] }, (t += 33));
    const out = input.sample(t);
    expect(out.offscreen).toBe(true);
    expect(out.x).toBe(1);
    // Resting just past the edge, within the margin, is not "off".
    for (let i = 0; i < 20; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
    for (let i = 0; i < 20; i++) camera.show({ thumbDegrees: 20, indexTip: [0.81, 0.5] }, (t += 33));
    expect(input.sample(t).offscreen).toBe(false);
  });

  it("still fires a shot whose next frame lost the hand before the game read it", () => {
    // Two camera frames between two of the game's (a frame that took long): the fold's, then one without the hand,
    // which the tracker drops most often mid-fold. The shot is the trigger's, and it goes where it was aimed.
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 6; i++) camera.show({ thumbDegrees: 20, indexTip: [0.4, 0.6] }, (t += 33));
    expect(input.sample(t).fired).toBe(false);
    for (let i = 0; i < 2; i++) camera.show({ thumbDegrees: 75, indexTip: [0.4, 0.6] }, (t += 33));
    camera.show(null, (t += 33));
    const shot = input.sample(t + 5);
    expect(shot.fired).toBe(true);
    expect(shot.offscreen).toBe(false);
    expect(shot.x).toBeCloseTo(1 / 3, 2);
    expect(shot.y).toBeCloseTo(2 / 3, 2);
    // Once: the next read is the hand lost.
    const after = input.sample(t + 10);
    expect(after.fired).toBe(false);
    expect(after.tracking).toBe(false);
    // A camera gone quiet since does not fire it late.
    for (let i = 0; i < 6; i++) camera.show({ thumbDegrees: 20, indexTip: [0.4, 0.6] }, (t += 33));
    for (let i = 0; i < 2; i++) camera.show({ thumbDegrees: 75, indexTip: [0.4, 0.6] }, (t += 33));
    camera.show(null, (t += 33));
    expect(input.sample(t + STALE_FRAME + 50).fired).toBe(false);
  });

  it("holds the trigger's state but not the aim while the hand is gone", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 5; i++) camera.show({ thumbDegrees: 20 }, (t += 33));
    camera.show(null, (t += 33));
    const lost = input.sample(t);
    expect(lost.tracking).toBe(false);
    expect(lost.armed).toBe(true);
    expect(lost.fired).toBe(false);
  });

  it("stops tracking when the camera stops sending frames", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 10; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
    const held = input.sample(t + STALE_FRAME - 50);
    expect(held.tracking).toBe(true);
    // The camera went quiet: its last frame is not a hand.
    const stale = input.sample(t + STALE_FRAME + 50);
    expect(stale.tracking).toBe(false);
    expect(stale.fired).toBe(false);
    expect(stale.offscreen).toBe(false); // lost mid-view is not a reload
    expect(stale.x).toBeCloseTo(held.x, 5);
    // A new frame brings it back.
    camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 600));
    expect(input.sample(t + 5).tracking).toBe(true);
  });

  it("counts a hand swung out of the picture as pointing off the screen, for a moment", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 10; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
    // The swing: across the view and past its right edge, then gone.
    for (const x of [0.6, 0.7, 0.8, 0.86, 0.9]) camera.show({ thumbDegrees: 20, indexTip: [x, 0.5] }, (t += 33));
    const leftAt = t;
    camera.show(null, (t += 33));
    const gone = input.sample(t + 5);
    expect(gone.tracking).toBe(false);
    expect(gone.offscreen).toBe(true);
    while (t < leftAt + EXIT_MOMENT - 100) camera.show(null, (t += 33));
    expect(input.sample(t).offscreen).toBe(true);
    // Out for longer than a reload's swing: simply lost.
    while (t < leftAt + EXIT_MOMENT + 100) camera.show(null, (t += 33));
    expect(input.sample(t).offscreen).toBe(false);
    expect(input.sample(t).tracking).toBe(false);
  });

  it("counts a swing too fast for the filter to follow as leaving", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 10; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
    // One frame far past the edge, then gone: the smoothed aim has not got there yet.
    camera.show({ thumbDegrees: 20, indexTip: [0.9, 0.5] }, (t += 33));
    camera.show(null, (t += 33));
    expect(input.sample(t + 5).offscreen).toBe(true);
  });

  it("does not reload for a frame lost as the thumb folds, aiming near an edge", () => {
    // Aiming at 0.95 of the view, the fold's kick takes the raw aim past the edge's margin for a frame, and the
    // tracker loses the hand on the next (most likely mid-fold): a shot, and no reload the player never asked for.
    const { camera, input } = setup();
    let t = 0;
    const aim = 0.2 + 0.95 * 0.6;
    for (let i = 0; i < 12; i++) camera.show({ thumbDegrees: 20, indexTip: [aim, 0.5] }, (t += 33));
    camera.show({ thumbDegrees: 45, indexTip: [aim + 0.03, 0.52] }, (t += 33));
    camera.show({ thumbDegrees: 75, indexTip: [aim + 0.06, 0.55] }, (t += 33));
    const reads = [input.sample(t + 5)];
    camera.show(null, (t += 33));
    for (let at = t + 5; at < t + 33; at += 8) reads.push(input.sample(at));
    camera.show(null, (t += 33));
    for (let at = t + 5; at < t + 33; at += 8) reads.push(input.sample(at));
    camera.show({ thumbDegrees: 75, indexTip: [aim + 0.03, 0.52] }, (t += 33));
    reads.push(input.sample(t + 5));
    expect(reads.filter((read) => read.fired)).toHaveLength(1);
    expect(reads.some((read) => read.offscreen)).toBe(false);
  });

  it("still counts a swing too fast for the filter as leaving with the thumb down, once the hand stays gone", () => {
    // A player who fires their last round and swings off to reload with the thumb still folded.
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 10; i++) camera.show({ thumbDegrees: 75, indexTip: [0.5, 0.5] }, (t += 33));
    camera.show({ thumbDegrees: 75, indexTip: [0.9, 0.5] }, (t += 33));
    const leftAt = t;
    while (t < leftAt + 200) camera.show(null, (t += 33));
    expect(input.sample(t + 5).offscreen).toBe(true);
  });

  it("counts a fingertip lost at the picture's edge as leaving, even aiming inside the view", () => {
    const camera = new FakeCamera();
    // The whole picture stretched over the view: its edge is the view's edge.
    const input = new HandInput(camera, () => VIEW, boxMapping([0, 0], [1, 1]));
    input.compensate = false;
    let t = 0;
    for (let i = 0; i < 12; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.975] }, (t += 33));
    expect(input.sample(t).offscreen).toBe(false); // still inside the view's margin
    camera.show(null, (t += 33));
    expect(input.sample(t + 5).offscreen).toBe(true);
  });

  it("does not call a hand that vanished mid-view off the screen", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 10; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
    camera.show(null, (t += 33));
    const lost = input.sample(t + 5);
    expect(lost.tracking).toBe(false);
    expect(lost.offscreen).toBe(false);
  });

  it("does not let another hand take the aim, or fire, until it has stayed", () => {
    const { camera, input } = setup();
    const mine = { thumbDegrees: 20, indexTip: [0.4, 0.45] as const, wrist: [0.42, 0.72] as const };
    // Someone else's, across the picture, with the thumb down as it comes in.
    const theirs = { thumbDegrees: 75, indexTip: [0.75, 0.3] as const, wrist: [0.77, 0.57] as const };
    let t = 0;
    for (let i = 0; i < 12; i++) camera.show(mine, (t += 33));
    const before = input.sample(t);
    expect(before.tracking).toBe(true);
    expect(before.armed).toBe(true);
    const arrived = t + 33;
    while (t < arrived + TRUST_AFTER - 40) {
      camera.show(theirs, (t += 33));
      const aim = input.sample(t);
      expect(aim.fired).toBe(false);
      expect(aim.tracking).toBe(false);
      expect(aim.x).toBeCloseTo(before.x, 5);
    }
    // It stayed: followed from now on, from where it is, but not cocked
    // until its thumb has been up.
    for (let i = 0; i < 4; i++) camera.show(theirs, (t += 33));
    const adopted = input.sample(t);
    expect(adopted.tracking).toBe(true);
    expect(adopted.fired).toBe(false);
    expect(adopted.armed).toBe(false);
    expect(adopted.x).toBeGreaterThan(0.8);
  });

  it("stays on the player's hand when the tracker flickers to another", () => {
    const { camera, input } = setup();
    const mine = { thumbDegrees: 20, indexTip: [0.4, 0.45] as const, wrist: [0.42, 0.72] as const };
    const theirs = { thumbDegrees: 75, indexTip: [0.8, 0.3] as const, wrist: [0.82, 0.57] as const };
    let t = 0;
    for (let i = 0; i < 12; i++) camera.show(mine, (t += 33));
    const x = input.sample(t).x;
    let fired = 0;
    for (let i = 0; i < 30; i++) {
      camera.show(i % 3 === 1 ? theirs : mine, (t += 33));
      const aim = input.sample(t);
      if (aim.fired) fired++;
      if (aim.tracking) expect(Math.abs(aim.x - x)).toBeLessThan(0.02);
    }
    expect(fired).toBe(0);
  });

  it("kicks the crosshair up after a shot, and settles within a quarter second", () => {
    const { camera, input } = setup();
    let t = 0;
    for (let i = 0; i < 6; i++) camera.show({ thumbDegrees: 20, indexTip: [0.5, 0.5] }, (t += 33));
    camera.show({ thumbDegrees: 75, indexTip: [0.5, 0.5] }, (t += 33));
    camera.show({ thumbDegrees: 75, indexTip: [0.5, 0.5] }, (t += 33));
    const shot = input.sample(t);
    const kicked = input.sample(t + 35);
    const settled = input.sample(t + 300);
    expect(kicked.y).toBeLessThan(shot.y - 0.01);
    expect(Math.abs(settled.y - shot.y)).toBeLessThan(0.004);
  });
});

/**
 * Latency compensation, measured. A hand sweeps side to side (a 0.5 Hz swing
 * across most of the view) with MediaPipe-sized jitter; the camera runs at
 * 30 fps and each frame reaches the page 25 ms after capture; the display
 * runs at 60 fps and shows a frame one vsync after it is drawn. The error is
 * the distance, in fractions of the view's width, between the crosshair on
 * screen and where the hand really points at that moment.
 */
function simulate(compensate: boolean, moving: boolean) {
  const noise = gaussian(seededRandom(11));
  const camera = new FakeCamera();
  const input = new HandInput(camera, () => VIEW, MAP);
  input.compensate = compensate;
  const truth = (ms: number) => (moving ? 0.5 + 0.2 * Math.sin((2 * Math.PI * 0.5 * ms) / 1000) : 0.5);
  const pending: { at: number; tip: number }[] = [];
  const errors: number[] = [];
  const steps: number[] = [];
  let lastShown: number | null = null;
  for (let ms = 0; ms < 12000; ms++) {
    if (ms % 33 === 0) pending.push({ at: ms, tip: truth(ms) + noise(0, 0.0015) });
    while (pending.length && ms - pending[0]!.at >= 25) {
      const frame = pending.shift()!;
      camera.show({ thumbDegrees: 20, indexTip: [frame.tip, 0.5] }, frame.at);
    }
    if (ms % 17 === 0 && ms > 2000) {
      const shown = input.sample(ms).x;
      const actual = (truth(ms + 17) - 0.2) / 0.6;
      errors.push(shown - actual);
      if (lastShown !== null) steps.push(shown - lastShown);
      lastShown = shown;
    }
  }
  const rms = (values: number[]) => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
  return { error: rms(errors), jitter: rms(steps) };
}

describe("latency compensation", () => {
  const moving = { off: simulate(false, true), on: simulate(true, true) };
  const still = { off: simulate(false, false), on: simulate(true, false) };
  console.info(
    `latency compensation (RMS, fraction of view width): moving ${moving.off.error.toFixed(4)} -> ${moving.on.error.toFixed(4)}; ` +
      `still jitter ${still.off.jitter.toFixed(5)} -> ${still.on.jitter.toFixed(5)} (max prediction ${MAX_PREDICTION} ms)`,
  );

  it("brings the crosshair closer to a moving hand", () => {
    expect(moving.on.error).toBeLessThan(moving.off.error * 0.75);
  });

  it("does not make a still hand's crosshair noticeably shakier", () => {
    expect(still.on.jitter).toBeLessThan(still.off.jitter * 1.5 + 1e-4);
  });
});
