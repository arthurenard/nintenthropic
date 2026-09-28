import { describe, expect, it } from "vitest";
import { EXIT_MOMENT } from "../input/handInput";
import { BEAT, DROP, FireToPlay, HandWatch, LOST_AFTER, QUIET, STEADY_FOR, type HandWatchEvent } from "./handWatch";

/** Ticks the watch at 60 fps from `from` to `to`, with the hand seen or not; returns every event. */
function run(watch: HandWatch, from: number, to: number, seen: boolean | ((t: number) => boolean)): { t: number; event: HandWatchEvent }[] {
  const events: { t: number; event: HandWatchEvent }[] = [];
  for (let t = from; t <= to; t += 1000 / 60) {
    const event = watch.update(t, typeof seen === "function" ? seen(t) : seen);
    if (event) events.push({ t, event });
  }
  return events;
}

describe("the hand watch", () => {
  it("leaves the round alone while the hand is seen", () => {
    const watch = new HandWatch(0);
    expect(run(watch, 0, 10_000, true)).toEqual([]);
    expect(watch.state).toBe("watching");
  });

  it("freezes the round once the hand has been gone for a second and a half", () => {
    const watch = new HandWatch(0);
    run(watch, 0, 1000, true);
    const events = run(watch, 1001, 4000, false);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toEqual({ type: "hold" });
    expect(events[0]!.t).toBeGreaterThanOrEqual(1000 + LOST_AFTER);
    expect(events[0]!.t).toBeLessThan(1000 + LOST_AFTER + 20);
    expect(watch.state).toBe("waiting");
    expect(watch.asking).toBe(true);
  });

  it("never trips on the swing out of the picture that reloads", () => {
    expect(LOST_AFTER).toBeGreaterThan(EXIT_MOMENT + 200);
    const watch = new HandWatch(0);
    // Out of the picture for the whole of a reload's moment, and back.
    const events = run(watch, 0, 6000, (t) => t < 1000 || t > 1000 + EXIT_MOMENT);
    expect(events).toEqual([]);
  });

  it("bridges frames the tracker drops", () => {
    const watch = new HandWatch(0);
    // One frame in five without a hand, for ten seconds.
    let frame = 0;
    expect(run(watch, 0, 10_000, () => frame++ % 5 !== 0)).toEqual([]);
  });

  it("counts 3-2-1 once the hand is steady again, then carries on", () => {
    const watch = new HandWatch(0);
    run(watch, 0, 2000, false);
    expect(watch.state).toBe("waiting");
    const back = 3000;
    run(watch, 2001, back - 1, false);
    const events = run(watch, back, back + 3000, true);
    expect(events.map((e) => e.event)).toEqual([
      { type: "count", beat: 3 },
      { type: "count", beat: 2 },
      { type: "count", beat: 1 },
      { type: "go" },
    ]);
    // Steady for half a second, then half a second a beat.
    expect(events[0]!.t - back).toBeGreaterThanOrEqual(STEADY_FOR);
    expect(events[0]!.t - back).toBeLessThan(STEADY_FOR + 20);
    expect(events[3]!.t - events[0]!.t).toBeGreaterThanOrEqual(3 * BEAT);
    expect(events[3]!.t - events[0]!.t).toBeLessThan(3 * BEAT + 20);
    expect(watch.state).toBe("watching");
    // Watching afresh: the hand going again takes the full second and a half.
    const again = run(watch, back + 3001, back + 3000 + LOST_AFTER - 50, false);
    expect(again).toEqual([]);
  });

  it("goes back to waiting when the hand drops during the count", () => {
    const watch = new HandWatch(0);
    run(watch, 0, 2000, false);
    const events = run(watch, 2001, 3200, true);
    expect(events.map((e) => e.event)).toContainEqual({ type: "count", beat: 3 });
    const dropped = run(watch, 3201, 3201 + DROP + 50, false);
    expect(dropped.map((e) => e.event)).toEqual([{ type: "ask" }]);
    expect(watch.state).toBe("waiting");
    expect(watch.beat).toBe(0);
    // And counts from 3 again once it is steady.
    const back = run(watch, 3600, 4400, true);
    expect(back.map((e) => e.event)).toEqual([{ type: "count", beat: 3 }]);
  });

  it("is not thrown back to waiting by one dropped frame in the count", () => {
    const watch = new HandWatch(0);
    run(watch, 0, 2000, false);
    let frame = 0;
    const events = run(watch, 2001, 5000, () => frame++ % 6 !== 0);
    expect(events.map((e) => e.event.type)).toEqual(["count", "count", "count", "go"]);
  });

  it("resuming from the pause sheet waits for the hand without asking for one already there", () => {
    const watch = new HandWatch(0);
    watch.hold(10_000);
    expect(watch.state).toBe("waiting");
    // The camera sees the hand a moment after resuming.
    const events = run(watch, 10_000, 12_500, (t) => t > 10_150);
    expect(events.map((e) => e.event)).toEqual([
      { type: "count", beat: 3 },
      { type: "count", beat: 2 },
      { type: "count", beat: 1 },
      { type: "go" },
    ]);
  });

  it("resuming from the pause sheet asks for a hand that is not there", () => {
    const watch = new HandWatch(0);
    watch.hold(10_000);
    const events = run(watch, 10_000, 11_000, false);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toEqual({ type: "ask" });
    expect(events[0]!.t - 10_000).toBeGreaterThanOrEqual(QUIET);
    expect(watch.asking).toBe(true);
  });
});

describe("fire to play again", () => {
  const up = { seen: true, armed: true, travel: 0.05, fired: false };
  const fold = { seen: true, armed: false, travel: 0.8, fired: true };
  const folded = { seen: true, armed: false, travel: 0.8, fired: false };

  it("plays again on a fold after the thumb was raised, once the card has settled", () => {
    const fire = new FireToPlay(1000);
    expect(fire.observe(1100, up)).toBe(false);
    expect(fire.observe(2300, fold)).toBe(true);
  });

  it("ignores a fold from before the card appeared", () => {
    const fire = new FireToPlay(1000);
    expect(fire.observe(900, up)).toBe(false);
    expect(fire.observe(950, fold)).toBe(false);
    // The thumb still folded when the card arrives: no shot until it is raised.
    expect(fire.observe(2300, folded)).toBe(false);
    expect(fire.observe(2400, fold)).toBe(false);
  });

  it("ignores a fold while the card is still arriving, and asks for a fresh raise", () => {
    const fire = new FireToPlay(1000);
    fire.observe(1050, up);
    expect(fire.observe(1500, fold)).toBe(false);
    // Folding again later without raising first is not a shot.
    expect(fire.observe(2500, fold)).toBe(false);
    fire.observe(2600, up);
    expect(fire.observe(2700, fold)).toBe(true);
  });

  it("does not count a thumb raised by a hand the camera cannot see", () => {
    const fire = new FireToPlay(1000);
    fire.observe(1100, { ...up, seen: false });
    expect(fire.observe(2300, fold)).toBe(false);
  });
});
