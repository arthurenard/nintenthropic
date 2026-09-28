import { describe, expect, it } from "vitest";
import type { Matrix } from "../input/homography";
import { aimKey, loadAim, saveAim, type CameraIdentity, type KeyValueStore } from "./storage";

function memory(): KeyValueStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const camera: CameraIdentity = { deviceId: "cam-1", width: 1280, height: 720 };
const town: Matrix = [1.2, 0.05, -0.1, -0.02, 1.3, -0.2, 0, 0, 1];
const valley: Matrix = [1.1, 0, -0.05, 0, 1.25, -0.15, 0, 0, 1];

describe("each game's own aim", () => {
  it("is kept for the game, and as the camera's latest", () => {
    const store = memory();
    expect(saveAim(store, camera, town, 1, "high-noon")).toBe(true);
    expect(store.items.has(aimKey(camera, "high-noon"))).toBe(true);
    expect(store.items.has(aimKey(camera))).toBe(true);
    expect(loadAim(store, camera, "high-noon")).toEqual(town);
  });

  it("starts a game with none of its own from the camera's latest", () => {
    const store = memory();
    saveAim(store, camera, town, 1, "high-noon");
    expect(loadAim(store, camera, "overwatch-ridge")).toEqual(town);
  });

  it("keeps a game's own aim apart from another game's", () => {
    const store = memory();
    saveAim(store, camera, town, 1, "high-noon");
    saveAim(store, camera, valley, 2, "overwatch-ridge");
    expect(loadAim(store, camera, "high-noon")).toEqual(town);
    expect(loadAim(store, camera, "overwatch-ridge")).toEqual(valley);
    // The latest for the camera is the last saved, for a third game.
    expect(loadAim(store, camera, "dead-of-night")).toEqual(valley);
  });

  it("throws away a game's unreadable aim, and falls back to the camera's", () => {
    const store = memory();
    saveAim(store, camera, town, 1);
    store.setItem(aimKey(camera, "high-noon"), "{not json");
    expect(loadAim(store, camera, "high-noon")).toEqual(town);
    expect(store.items.has(aimKey(camera, "high-noon"))).toBe(false);
  });
});
