import { Group, Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { nameNode } from "../../engine/world/names";

// Each file holds a few named nodes, as Blender's export would.
const FILES: Record<string, string[]> = {
  "assets/kart/karts.glb": ["kart.body", "kart.wheel"],
  "assets/kart/drivers.glb": ["driver.fox.head"],
  "assets/kart/world-snow.glb": ["scenery.pine.1", "scenery.pine.2", "landmark.chalet"],
  "assets/kart/world-meadow.glb": ["scenery.pine.1", "landmark.windmill"],
};

vi.mock("../../engine/assets", () => ({
  Assets: class {
    async gltf(url: string): Promise<{ scene: Object3D; animations: [] }> {
      const names = FILES[url];
      if (!names) throw new Error(`no ${url}`);
      const scene = new Group();
      for (const name of names) scene.add(nameNode(new Object3D(), name));
      return { scene, animations: [] };
    }
  },
}));

describe("kart art", () => {
  it("dresses each race in its own world's models only, whichever world was loaded before", async () => {
    const { artNames, artNode, hasArt, loadKartArt } = await import("./art");
    await loadKartArt("snow");
    expect(artNames("scenery.pine.")).toEqual(["scenery.pine.1", "scenery.pine.2"]);
    expect(hasArt("landmark.chalet")).toBe(true);

    await loadKartArt("meadow");
    expect(artNames("scenery.pine.")).toEqual(["scenery.pine.1"]);
    expect(hasArt("landmark.chalet")).toBe(false);
    expect(artNode("landmark.chalet")).toBeNull();
    expect(hasArt("landmark.windmill")).toBe(true);
    // The karts and drivers are the same in every world.
    expect(hasArt("kart.body")).toBe(true);
    expect(hasArt("driver.fox.head")).toBe(true);

    // Back to a world already loaded: its own set again, without reloading.
    await loadKartArt("snow");
    expect(artNames("scenery.pine.")).toEqual(["scenery.pine.1", "scenery.pine.2"]);
    expect(hasArt("landmark.windmill")).toBe(false);
  });
});
