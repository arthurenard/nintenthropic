import { Matrix4, MeshLambertMaterial, type BufferGeometry, type InstancedMesh, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../../track/geometry";
import { MEADOW_LOOP } from "../../track/tracks";
import { QUALITY } from "../quality";
import { buildScenery } from "./scenery";
import { Terrain } from "./terrain";
import { styleFor, THEMES } from "./themes";
import { buildTrackMeshes } from "./track";

function triangles(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
}

function finite(g: BufferGeometry): boolean {
  const pos = g.getAttribute("position").array;
  for (let i = 0; i < pos.length; i += 1) if (!Number.isFinite(pos[i]!)) return false;
  return true;
}

const quality = QUALITY.high;
const geometry = TrackGeometry.build(MEADOW_LOOP);

describe("terrain", () => {
  const style = styleFor("meadow");
  const terrain = Terrain.build(geometry, style, 8);

  it("sits just under the road next to it, so the verge lies on top", () => {
    for (const s of [10, 200, 400, 640, 900]) {
      const c = geometry.at(s);
      const p = geometry.point(s, c.width / 2 + 3);
      const q = geometry.point(s, -(c.width / 2 + 3));
      for (const pt of [p, q]) {
        const h = terrain.heightAt(pt.x, pt.z);
        expect(h).toBeLessThan(pt.y - 0.2);
        expect(h).toBeGreaterThan(pt.y - 1.6);
      }
    }
  });

  it("knows how far a point is beyond the road's edge", () => {
    const c = geometry.at(300);
    const far = geometry.point(300, c.width / 2 + 30);
    expect(terrain.edgeAt(far.x, far.z)).toBeGreaterThan(20);
    expect(terrain.edgeAt(c.x, c.z)).toBeLessThan(2);
  });

  it("builds tiles with sane geometry", () => {
    const tiles = terrain.buildTiles(20);
    expect(tiles.length).toBeGreaterThan(4);
    for (const t of tiles) {
      expect(finite(t)).toBe(true);
      expect(t.boundingSphere).not.toBeNull();
    }
  });
});

describe("the track's meshes", () => {
  for (const theme of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
    it(`builds for the ${theme} theme within a triangle budget`, () => {
      const style = styleFor(theme);
      const terrain = Terrain.build(geometry, style, quality.cell + 4);
      const meshes = buildTrackMeshes(geometry, style, terrain, quality);
      const all = [...meshes.road, ...meshes.deco, ...(meshes.pads ? [meshes.pads] : []), ...(meshes.pools ? [meshes.pools] : [])];
      for (const g of all) expect(finite(g)).toBe(true);
      const total = all.reduce((sum, g) => sum + triangles(g), 0);
      expect(total).toBeGreaterThan(20_000);
      expect(total).toBeLessThan(700_000);
      // Cut into chunks, so the camera can skip the ones it is not facing.
      expect(meshes.road.length).toBeGreaterThan(10);
      expect(meshes.deco.length).toBeGreaterThan(10);
      expect(meshes.startLights).toHaveLength(3);
      expect(meshes.pads).not.toBeNull();
      // Street lamps (the harbour) and the fair's strings of bulbs give lights; nothing else needs to.
      if (style.lamps) expect(meshes.glows.length).toBeGreaterThan(0);
    });
  }

  it("puts the barriers 6 m beyond the road's edge: nothing solid stands closer", { timeout: 30_000 }, () => {
    // The kerbs and verge are flat; look at what stands tall near the road: the lowest vertex of anything
    // above 0.3 m must be at least 6 m out. Check the deco chunk at the middle of the first straight.
    const style = styleFor("meadow");
    const terrain = Terrain.build(geometry, style, 8);
    const meshes = buildTrackMeshes(geometry, style, terrain, quality);
    let nearTall = 0;
    for (const g of meshes.deco) {
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = pos.getY(i);
        const proj = geometry.project(x, z);
        const lateral = Math.abs(proj.offset) - proj.sample.width / 2;
        // Skip the start gantry's legs (which stand 1.9 m out, by design) and the sign boards: tall things only.
        if (proj.s > geometry.length - 5 || proj.s < 5) continue;
        if (y - proj.sample.y > 0.45 && lateral < WALL_MIN) nearTall++;
      }
    }
    expect(nearTall).toBe(0);
  });
});

const WALL_MIN = 5.7;

describe("scenery", () => {
  for (const theme of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
    it(`keeps ${theme}'s scenery well clear of the road`, () => {
      const style = styleFor(theme);
      const terrain = Terrain.build(geometry, style, quality.cell + 4);
      const material = new MeshLambertMaterial({ vertexColors: true });
      const scenery = buildScenery(style, terrain, quality, material);
      let instances = 0;
      let closest = Infinity;
      scenery.group.traverse((o) => {
        const m = o as InstancedMesh;
        if (!m.isInstancedMesh) return;
        const p = m.geometry.getAttribute("position");
        // Skip the flowers: they are meant to grow just beyond the barriers.
        if (p.count < 120 && theme === "meadow") return;
        const mat = new Matrix4();
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, mat);
          const x = mat.elements[12]!;
          const z = mat.elements[14]!;
          const info = terrain.info(x, z);
          closest = Math.min(closest, info.edge);
          instances++;
        }
      });
      scenery.dispose();
      material.dispose();
      expect(instances).toBeGreaterThan(20);
      expect(closest).toBeGreaterThan(8);
    });
  }

  it("is the same every time it loads", () => {
    const style = styleFor("meadow");
    const terrain = Terrain.build(geometry, style, 10);
    const count = () => {
      const material = new MeshLambertMaterial({ vertexColors: true });
      const s = buildScenery(style, terrain, quality, material, 77);
      let n = 0;
      s.group.traverse((o) => {
        if ((o as Mesh).isMesh) n += (o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh).count : 1;
      });
      s.dispose();
      material.dispose();
      return n;
    };
    expect(count()).toBe(count());
  });
});
