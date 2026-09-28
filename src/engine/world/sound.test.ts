import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import type { AudioBus } from "../types";
import { Sound } from "./sound";

/** A bus that only remembers what it was told. */
function recordingBus() {
  const filters: [string, number][] = [];
  const bus: AudioBus = {
    muted: true,
    play() {},
    loop: () => () => {},
    setFilter(name, amount) {
      filters.push([name, amount]);
    },
  };
  return { bus, filters };
}

describe("Sound over a pause", () => {
  it("lets the heartbeat go while paused and brings it back on resume", () => {
    const { bus, filters } = recordingBus();
    const sound = new Sound(bus, new PerspectiveCamera());
    sound.filter("hurt", 0.6);
    sound.pause();
    expect(filters.at(-1)).toEqual(["hurt", 0]);
    sound.resume();
    expect(filters.at(-1)).toEqual(["hurt", 0.6]);
  });

  it("keeps a change made while paused for the resume", () => {
    const { bus, filters } = recordingBus();
    const sound = new Sound(bus, new PerspectiveCamera());
    sound.filter("hurt", 0.6);
    sound.pause();
    const before = filters.length;
    sound.filter("hurt", 0.2);
    expect(filters.length).toBe(before); // nothing sounds while paused
    sound.resume();
    expect(filters.at(-1)).toEqual(["hurt", 0.2]);
  });

  it("passes slow motion through as it is", () => {
    const { bus, filters } = recordingBus();
    const sound = new Sound(bus, new PerspectiveCamera());
    sound.pause();
    sound.filter("slowmo", 1);
    expect(filters.at(-1)).toEqual(["slowmo", 1]);
  });
});
