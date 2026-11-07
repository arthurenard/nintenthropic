/**
 * A small track with two alternate routes, for the tests of the routes engine (track/routes.test.ts, sim/routes.test.ts):
 * an oval with a shortcut across the inside of its top-left corner and a split past an island on the back straight.
 * Not a track anyone races.
 */
import type { TrackDef } from "./geometry";

export const ROUTE_OVAL: TrackDef = {
  id: "route-oval",
  name: "Route Oval",
  theme: "meadow",
  laps: 3,
  width: 14,
  itemRows: [0.2, 0.6],
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 60, y: 0.3 },
    { x: 0, z: 125, y: 0.6 },
    { x: 20, z: 180, y: 1 },
    { x: 70, z: 215, y: 1.4 },
    { x: 130, z: 222, y: 1.2 },
    { x: 195, z: 215, y: 0.8 },
    { x: 245, z: 180, y: 0.5 },
    { x: 262, z: 125, y: 0.3 },
    { x: 262, z: 50, y: 0.2 },
    { x: 262, z: -20, y: 0.2 },
    { x: 240, z: -80 },
    { x: 190, z: -112 },
    { x: 130, z: -118 },
    { x: 70, z: -112 },
    { x: 20, z: -80 },
  ],
  boostPads: [{ at: 0.4, offset: 0 }],
  routes: [
    {
      // Across the inside of the top-left corner: shorter, narrower, with a bump to fly.
      id: "cut",
      kind: "shortcut",
      from: 0.09,
      to: 0.3,
      width: 9,
      points: [
        { x: 22, z: 140, y: 0.8 },
        { x: 52, z: 175, y: 1.1 },
        { x: 95, z: 200, y: 1.4 },
      ],
      ramps: [{ at: 0.45, lift: 5 }],
      boostPads: [{ at: 0.2, offset: 0 }],
    },
    {
      // Past an island on the back straight: one way high and narrow, one way the road.
      id: "island",
      kind: "split",
      from: 0.62,
      to: 0.8,
      width: 11,
      points: [
        { x: 226, z: -46, y: 1.5 },
        { x: 192, z: -72, y: 2 },
        { x: 152, z: -82, y: 2 },
      ],
    },
  ],
};
