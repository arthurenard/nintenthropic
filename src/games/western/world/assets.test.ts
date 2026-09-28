import { Color, Group, Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadError } from "../../../engine/fetch";
import type { AssetLoader, GameContext, LoadedAsset } from "../../../engine/types";
import { loadAssets, placeholders, type Placeholders } from "./assets";

/** Just enough of a GameContext for loading: the asset loader. */
function context(assets: AssetLoader): GameContext {
  return { assets } as unknown as GameContext;
}

const empty = (): LoadedAsset => ({ scene: new Group(), animations: [] });

/** Stand-ins that only say they were used. */
function fakeKit(): Placeholders & { used: string[] } {
  const used: string[] = [];
  return {
    used,
    standIn: (name: string) => {
      used.push(name);
      return empty();
    },
    buildSky: () => {
      used.push("sky");
      return { texture: new Texture(), fog: new Color() };
    },
  } as unknown as Placeholders & { used: string[] };
}

afterEach(() => vi.restoreAllMocks());

describe("loading the art", () => {
  it("has its placeholders outside production (the tests, the dev harness)", async () => {
    const kit = await placeholders();
    expect(typeof kit?.standIn).toBe("function");
    expect(typeof kit?.buildSky).toBe("function");
  });

  it("without placeholders, fails the load with a DownloadError when a model will not load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = context({
      gltf: (url) => (url.endsWith("boss.glb") ? Promise.reject(new SyntaxError("not a glTF")) : Promise.resolve(empty())),
      texture: () => Promise.resolve(new Texture()),
    });
    const load = loadAssets(ctx, () => {}, false, null, null);
    await expect(load).rejects.toBeInstanceOf(DownloadError);
    await expect(load).rejects.toMatchObject({ url: expect.stringMatching(/boss\.glb$/) });
  });

  it("passes the engine's own DownloadError through, status and all", async () => {
    const missing = new DownloadError("assets/western/town.glb", 404);
    const ctx = context({
      gltf: (url) => (url.endsWith("town.glb") ? Promise.reject(missing) : Promise.resolve(empty())),
      texture: () => Promise.resolve(new Texture()),
    });
    await expect(loadAssets(ctx, () => {}, false, null, null)).rejects.toBe(missing);
  });

  it("without placeholders, fails the load when the sky will not load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = context({
      gltf: () => Promise.resolve(empty()),
      texture: () => Promise.reject(new Event("error")),
    });
    const load = loadAssets(ctx, () => {}, true, null, null);
    await expect(load).rejects.toBeInstanceOf(DownloadError);
    await expect(load).rejects.toMatchObject({ url: expect.stringMatching(/sky_noon\.webp$/) });
  });

  it("with placeholders, stands in for what will not load and goes on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Every file answers the probe as present, then fails to load.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "model/gltf-binary" } }));
    const kit = fakeKit();
    const ctx = context({
      gltf: (url) => (url.endsWith("chicken.glb") ? Promise.reject(new Error("corrupt")) : Promise.resolve(empty())),
      texture: () => Promise.reject(new Event("error")),
    });
    const assets = await loadAssets(ctx, () => {}, false, null, kit);
    expect(kit.used.sort()).toEqual(["chicken", "sky"]);
    expect(assets.real.chicken).toBe(false);
    expect(assets.real.sky).toBe(false);
    expect(assets.real.town).toBe(true);
  });
});
