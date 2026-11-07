/**
 * The comet layer keeps to the music's bars: every run of it starts on a bar line and ends at the loop's restart, so a
 * piece whose bars differ in length (a waltz bridge) never leaves it behind. Played on a stand-in clock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicPlayer, type MusicTrack } from "./player";

interface Starts {
  start: number;
  stop: number;
  loop: boolean;
}

function fakeContext() {
  const sources: Starts[] = [];
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  const node = (): Record<string, unknown> => {
    const n: Record<string, unknown> = { gain: param(), frequency: param(), Q: param(), connect: (to: unknown) => to ?? n, disconnect() {} };
    return n;
  };
  const ctx = {
    currentTime: 100,
    createGain: node,
    createBiquadFilter: node,
    createBufferSource: () => {
      const rec: Starts = { start: -1, stop: -1, loop: false };
      sources.push(rec);
      const n = node();
      return Object.assign(n, {
        buffer: null,
        set loop(v: boolean) {
          rec.loop = v;
        },
        start: (t: number) => void (rec.start = t),
        stop: (t: number) => void (rec.stop = t),
      });
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources, clock: ctx };
}

describe("the comet layer", () => {
  afterEach(() => vi.useRealTimers());

  it("starts on a bar line and is renewed at each restart of the music's loop", () => {
    vi.useFakeTimers();
    const { ctx, sources, clock } = fakeContext();
    const player = new MusicPlayer(ctx, {} as AudioNode);
    const bars = Float32Array.from([0, 2, 4, 5.5, 7]);
    const track: MusicTrack = {
      id: "t", buffer: {} as AudioBuffer, beats: bars, barStarts: bars, duration: 8.5, comet: {} as AudioBuffer,
    };
    player.play(track, 0.1);
    const origin = 100;
    clock.currentTime = 101;
    player.setComet(true);
    const first = sources.at(-1)!;
    const into = (first.start - origin) % 8.5;
    expect([...bars].some((b) => Math.abs(b - into) < 1e-6)).toBe(true);
    expect(first.stop).toBeCloseTo(origin + 8.5, 6);
    clock.currentTime = 107.5;
    vi.advanceTimersByTime(7000);
    const second = sources.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.start).toBeCloseTo(origin + 8.5, 6);
    expect(second.stop).toBeCloseTo(origin + 17, 6);
    player.setComet(false);
  });
});
