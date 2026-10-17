import { describe, expect, it } from "vitest";
import { BLOCK, EASY_WINDOWS, FLOOR, HandsFirst, JUDGE_WINDOWS, STARVED_WINDOWS, STEP_DOWN, WINDOW } from "./handsFirst";

/**
 * A tracker reading `share` of its due frames, 30 due a second, for `seconds`; `share` may depend on the ceiling (a race that
 * gives up pixels gives the tracker the GPU). Returns the ceilings seen.
 */
function run(hands: HandsFirst, clock: { t: number; frames: number; skipped: number }, seconds: number, share: number | ((ceiling: number) => number)): number[] {
  const seen: number[] = [];
  const step = 1 / 30;
  for (let k = 0; k < seconds * 30; k++) {
    clock.t += step;
    const s = typeof share === "number" ? share : share(hands.ceiling);
    // Spread the reads evenly: a fractional read is carried.
    const read = Math.floor((clock.frames + clock.skipped + 1) * s) - Math.floor((clock.frames + clock.skipped) * s);
    clock.frames += read;
    clock.skipped += 1 - read;
    hands.sample({ frames: clock.frames, skipped: clock.skipped }, clock.t);
    if (seen[seen.length - 1] !== hands.ceiling) seen.push(hands.ceiling);
  }
  return seen;
}

const fresh = () => ({ t: 0, frames: 0, skipped: 0 });

describe("the hands first: the race's resolution while the tracker beside it is short of the GPU", () => {
  it("leaves the picture alone while the tracker keeps up", () => {
    const hands = new HandsFirst();
    expect(run(hands, fresh(), 60, 0.97)).toEqual([1]);
  });

  it("gives up pixels a step at a time while the tracker drops frames, and stops where it keeps up", () => {
    const hands = new HandsFirst();
    // The tracker keeps up once the race is at 0.7 of its resolution or less.
    const seen = run(hands, fresh(), 30, (ceiling) => (ceiling <= 0.7 + 1e-9 ? 0.97 : 0.4));
    expect(seen.slice(0, 4)).toEqual([1, 0.9, 0.8, 0.7]);
    // Once settled it looks for room a little above now and then, and comes straight back.
    expect(Math.max(...seen.slice(3))).toBeLessThanOrEqual(0.75);
    expect(hands.ceiling).toBeCloseTo(0.7);
  });

  it("steps down only after a second of drops, not for one bad window", () => {
    const hands = new HandsFirst();
    const clock = fresh();
    run(hands, clock, 5, 0.97);
    run(hands, clock, WINDOW * (STARVED_WINDOWS - 1) * 0.8, 0.3);
    expect(hands.ceiling).toBe(1);
    run(hands, clock, 5, 0.97);
    expect(hands.ceiling).toBe(1);
  });

  it("goes no lower than the floor", () => {
    const hands = new HandsFirst();
    // Better at every step (so each is kept), never enough.
    run(hands, fresh(), 60, (ceiling) => 0.2 + (1 - ceiling) * 0.5);
    expect(hands.ceiling).toBeCloseTo(FLOOR);
  });

  it("undoes steps down that do not help (a tracker slow for another reason), and waits before trying again", () => {
    const hands = new HandsFirst();
    const clock = fresh();
    const steps = Math.round((1 - FLOOR) / STEP_DOWN);
    const seen = run(hands, clock, (STARVED_WINDOWS * steps + JUDGE_WINDOWS + 2) * WINDOW, 0.5);
    expect(seen).toEqual([1, 0.9, 0.8, 0.7, 0.6, 1]);
    // No new try before the block is over...
    expect(run(hands, clock, BLOCK - 4, 0.5)).toEqual([1]);
    // ...then another, undone again.
    expect(run(hands, clock, 15, 0.5)).toContain(1 - STEP_DOWN);
    expect(hands.ceiling).toBe(1);
  });

  it("gives the pixels back once the tracker has room, a little at a time, and takes back a step up that brings the drops back", () => {
    const hands = new HandsFirst();
    const clock = fresh();
    // The tracker keeps up at 0.8 or below.
    const fits = (ceiling: number) => (ceiling <= 0.8 + 1e-9 ? 0.97 : 0.4);
    run(hands, clock, 2.5, fits);
    expect(hands.ceiling).toBeCloseTo(0.8);
    // After a few easy seconds it tries 0.85, which brings the drops back: straight back to 0.8, and 0.85 left alone a while.
    const seen = run(hands, clock, WINDOW * (EASY_WINDOWS + 4), fits);
    expect(seen).toEqual([0.8, 0.85, 0.8]);
    expect(run(hands, clock, BLOCK - 2, fits)).toEqual([0.8]);
    // The race ends, or the tracker gets lighter (a player leaves): all the way back up.
    run(hands, clock, 60, 0.97);
    expect(hands.ceiling).toBe(1);
  });

  it("gives the pixels back when the share hovers round the line whatever the resolution, never sitting at the floor", () => {
    const hands = new HandsFirst();
    // Two windows under the line and one over it, again and again, at every ceiling: the pixels change nothing.
    let frames = 0;
    let skipped = 0;
    let lowered = 0;
    const windows = 480;
    for (let w = 0; w < windows; w++) {
      const read = w % 3 === 2 ? 12 : 10;
      frames += read;
      skipped += 15 - read;
      hands.sample({ frames, skipped }, (w + 1) * (WINDOW + 1e-6));
      if (hands.ceiling < 1) lowered++;
    }
    // Each try down is undone, and tried again less and less often: the picture is whole nearly all the time.
    expect(hands.ceiling).toBe(1);
    expect(lowered / windows).toBeLessThan(0.15);
  });

  it("says nothing for a window with nothing due, and starts again with a new tracker's counts", () => {
    const hands = new HandsFirst();
    const clock = fresh();
    run(hands, clock, 3, 0.3);
    expect(hands.ceiling).toBeLessThan(1);
    hands.reset();
    expect(hands.ceiling).toBe(1);
    // Counts that went backwards (a new tracker) are a first sample, not a window of drops.
    expect(hands.sample({ frames: 0, skipped: 0 }, clock.t + 1)).toBe(false);
    expect(hands.sample({ frames: 0, skipped: 0 }, clock.t + 2)).toBe(false);
    expect(hands.ceiling).toBe(1);
  });
});
