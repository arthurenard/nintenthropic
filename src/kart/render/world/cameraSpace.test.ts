import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { barrierDistance, isOpen } from "../../sim/terrain";
import { KartSpace } from "./kartSpace";
import { TRACKS } from "../../track/tracks";
import { chaseOffsets } from "../cameras";
import { createCameraSpace } from "./cameraSpace";
import { makeProbe, placedLandmarks } from "./corridorProbe";
import { rampHeight, SOLID_MARGIN } from "./features";
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
      let tried = 0;
      const pos = new Vector3();
      const kartSpace = new KartSpace(def, geo);
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
              // Where the kart really can be: inside the barrier of the nearest road (the loop's barrier opens wide where a branch leaves it).
              const kartAt = kartSpace.place(kx, kz, 200);
              if (!kartAt || kartAt.past > 0) continue;
              const heading = Math.atan2(c.tx, c.tz) + turn;
              const { distance, height } = chaseOffsets(1, 1, 0.8);
              pos.set(kx - Math.sin(heading) * distance, c.y + height, kz - Math.cos(heading) * distance);
              space.fit(pos, { x: kx, y: c.y, z: kz });
              tried++;
              worstGround = Math.min(worstGround, pos.y - terrain.heightAt(pos.x, pos.z));
              // By the nearest road of any (the loop or a branch road), as the sim puts a kart.
              const here = kartSpace.place(pos.x, pos.z, 200);
              // Over an open edge there is no barrier to keep inside of: the ground falls away there.
              if (!here || !here.walled) continue;
              // Midway between two roads the sim keeps a kart on the one it is on (project's stickiness): judge by that one.
              if (here.route !== geo.project(pos.x, pos.z, undefined, kartAt.route).route) continue;
              worstOut = Math.max(worstOut, here.past - SOLID_MARGIN);
            }
          }
        }
      }
      mats.dispose();
      layer.dispose();
      expect(tried).toBeGreaterThan(50);
      expect(worstGround, "camera above the ground").toBeGreaterThanOrEqual(0.8);
      // (On a narrow, curving branch road the camera is held to the nearest sample's margin: a tenth of a metre of the 1.5 m margin is slack.)
      expect(worstOut, "camera beyond the barrier's margin").toBeLessThanOrEqual(0.2);
    });
  }

  it("keeps the camera out of a ramp's wedge, where it stands and between it and the kart", { timeout: 60_000 }, () => {
    let ramps = 0;
    for (const def of TRACKS) {
      if (!def.ramps?.length) continue;
      const probe = makeProbe(def);
      const space = createCameraSpace(probe.geo, probe.terrain, probe.terrain.features, [], probe.bank);
      for (const r of probe.terrain.features.ramps) {
        ramps++;
        // A kart halfway up the wedge and at the lip, a camera behind it down at the road's own height.
        for (const ahead of [r.length / 2, 0]) {
          const ks = r.lip - ahead;
          const k = probe.geo.at(ks);
          const ky = k.y + rampHeight(probe.terrain.features.ramps, ks, probe.geo.length);
          const c = probe.geo.at(ks - 5);
          const pos = new Vector3(c.x, c.y + 0.3, c.z);
          space.fit(pos, { x: k.x, y: ky, z: k.z });
          const wedge = rampHeight(probe.terrain.features.ramps, ks - 5, probe.geo.length);
          expect(pos.y, `${def.id} camera over the wedge`).toBeGreaterThanOrEqual(c.y + wedge + 0.85);
        }
      }
    }
    expect(ramps).toBeGreaterThan(2);
  });

  it("keeps the camera under the roof of a thing over the road, and the roofs are over a kart's reach", { timeout: 120_000 }, () => {
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
