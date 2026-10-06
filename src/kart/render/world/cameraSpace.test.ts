import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { barrierDistance, isOpen } from "../../sim/terrain";
import { TRACKS } from "../../track/tracks";
import { chaseOffsets } from "../cameras";
import { createCameraSpace } from "./cameraSpace";
import { makeProbe, placedLandmarks } from "./corridorProbe";
import { SOLID_MARGIN } from "./features";
import { buildLandmarks, landmarkMaterials } from "./landmarks/place";

describe("the chase camera's room", () => {
  for (const def of TRACKS) {
    it(`${def.id}: never in the ground, never past the margin beyond the barrier, never through a roof`, { timeout: 60_000 }, () => {
      const probe = makeProbe(def);
      const { geo, terrain, sim, bank } = probe;
      const mats = landmarkMaterials();
      const layer = buildLandmarks(probe.env, placedLandmarks(def), mats);
      const space = createCameraSpace(geo, terrain, terrain.features, layer.roofs, bank);
      let worstGround = Infinity;
      let worstOut = -Infinity;
      let moved = 0;
      let tried = 0;
      const pos = new Vector3();
      for (let s = 0; s < geo.length; s += 7) {
        const c = geo.at(s);
        const half = c.width / 2;
        for (const side of [-1, 1] as const) {
          if (isOpen(sim, c.s, side)) continue;
          const wall = barrierDistance(sim, c.s, side);
          // A kart at the barrier line and a little inside it, nosed this way and that across the road: the camera trails behind.
          for (const inset of [0.8, 3]) {
            for (const turn of [-1.1, -0.5, 0, 0.5, 1.1]) {
              const lat = side * (half + wall - inset);
              const kx = c.x - c.tz * lat;
              const kz = c.z + c.tx * lat;
              const heading = Math.atan2(c.tx, c.tz) + turn;
              const { distance, height } = chaseOffsets(1, 1, 0.8);
              pos.set(kx - Math.sin(heading) * distance, c.y + height, kz - Math.cos(heading) * distance);
              const before = pos.clone();
              space.fit(pos, { x: kx, y: c.y, z: kz });
              tried++;
              if (!pos.equals(before)) moved++;
              worstGround = Math.min(worstGround, pos.y - terrain.heightAt(pos.x, pos.z));
              const p = geo.project(pos.x, pos.z);
              const pSide = p.offset > 0 ? 1 : -1;
              // Over an open edge there is no barrier to keep inside of: the ground falls away there.
              if (isOpen(sim, p.s, pSide)) continue;
              worstOut = Math.max(worstOut, Math.abs(p.offset) - p.sample.width / 2 - barrierDistance(sim, p.s, pSide) - SOLID_MARGIN);
            }
          }
        }
      }
      mats.dispose();
      layer.dispose();
      expect(tried).toBeGreaterThan(50);
      expect(worstGround, "camera above the ground").toBeGreaterThanOrEqual(0.8);
      expect(worstOut, "camera beyond the barrier's margin").toBeLessThanOrEqual(0.01);
      // The camera does swing out in a bend: the margin is doing something on at least some of these tracks (not asserted per track).
      void moved;
    });
  }

  it("keeps the camera under the roof of a thing over the road, and the roofs are over a kart's reach", () => {
    let roofs = 0;
    for (const def of TRACKS) {
      const probe = makeProbe(def);
      const mats = landmarkMaterials();
      const layer = buildLandmarks(probe.env, placedLandmarks(def), mats);
      const space = createCameraSpace(probe.geo, probe.terrain, probe.terrain.features, layer.roofs, probe.bank);
      for (const roof of layer.roofs) {
        roofs++;
        const low = Math.min(...roof.heights);
        expect(low, `${def.id} roof over the road`).toBeGreaterThanOrEqual(5);
        // The middle of it: a camera well above is brought down under it, not below the kart.
        const mid = roof.s0 + (roof.heights.length * roof.step) / 2;
        const c = probe.geo.at(mid);
        const pos = new Vector3(c.x, c.y + 30, c.z);
        space.fit(pos, { x: c.x, y: c.y, z: c.z });
        const here = roof.heights[Math.round((mid - roof.s0) / roof.step)]!;
        if (Number.isFinite(here)) expect(pos.y, `${def.id} camera under the roof`).toBeLessThanOrEqual(c.y + here);
        expect(pos.y).toBeGreaterThan(c.y + 1);
      }
      mats.dispose();
      layer.dispose();
    }
    expect(roofs).toBeGreaterThan(5);
  });
});
