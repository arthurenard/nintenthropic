import { Color, Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadError } from "../../../engine/fetch";
import type { AssetLoader, GameContext, LoadedAsset } from "../../../engine/types";
import { loadAssets, namedMaps, placeholders, type Placeholders } from "./assets";

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

describe("loading the night's art", () => {
  it("has its placeholders outside production (the tests, the dev harness)", async () => {
    const kit = await placeholders();
    expect(typeof kit?.standIn).toBe("function");
    expect(typeof kit?.buildSky).toBe("function");
  });

  it("without placeholders, fails the load with a DownloadError when a model will not load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = context({
      gltf: (url) => (url.endsWith("mechanic.glb") ? Promise.reject(new SyntaxError("not a glTF")) : Promise.resolve(empty())),
      texture: () => Promise.resolve(new Texture()),
    });
    const load = loadAssets(ctx, () => {}, null, null);
    await expect(load).rejects.toBeInstanceOf(DownloadError);
    await expect(load).rejects.toMatchObject({ url: expect.stringMatching(/mechanic\.glb$/) });
  });

  it("without placeholders, fails the load when the sky will not load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = context({ gltf: () => Promise.resolve(empty()), texture: () => Promise.reject(new Event("error")) });
    await expect(loadAssets(ctx, () => {}, null, null)).rejects.toMatchObject({ url: expect.stringMatching(/night\/sky\.webp$/) });
  });

  it("with placeholders, stands in for what will not load and goes on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "model/gltf-binary" } }));
    const kit = fakeKit();
    const ctx = context({
      gltf: (url) => (url.endsWith("cat.glb") ? Promise.reject(new Error("corrupt")) : Promise.resolve(empty())),
      texture: () => Promise.reject(new Event("error")),
    });
    const assets = await loadAssets(ctx, () => {}, null, kit);
    expect(kit.used.sort()).toEqual(["cat", "sky"]);
    expect(assets.real.cat).toBe(false);
    expect(assets.real.road).toBe(true);
  });

  it("finds the textures a baked material names beside the file: its albedo, the streetlight's mask", () => {
    const root = new Group();
    const a = new MeshBasicMaterial();
    a.userData["albedo"] = "road_albedo_1.webp";
    const b = new MeshBasicMaterial();
    b.userData["albedo"] = "road_albedo_1.webp";
    b.userData["flicker"] = "road_flicker.webp";
    root.add(new Mesh(undefined, a), new Mesh(undefined, b));
    root.userData["flicker"] = "road_flicker.webp";
    expect(namedMaps(root).sort()).toEqual(["road_albedo_1.webp", "road_flicker.webp"]);
  });
});
