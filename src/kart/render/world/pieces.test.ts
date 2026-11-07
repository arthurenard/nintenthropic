import { describe, expect, it } from "vitest";
import { InstancedMesh, Matrix4, Vector3, type Texture } from "three";
import { TrackGeometry, type HazardDef, type TrackDef } from "../../track/geometry";
import { CRUSH, hazardAt } from "../../track/hazards";
import { PIECE_KINDS, crosser, pendulum, stomperRow, sweeper } from "../../track/pieces";
import { Bank } from "./bank";
import { landmarkMaterials } from "./landmarks/place";
import { PIECE_MODELS, buildPieces, isPiece } from "./pieces";
import { styleFor } from "./themes";

const def: TrackDef = {
  id: "t",
  name: "t",
  theme: "canyon",
  laps: 1,
  width: 14,
  itemRows: [],
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 150 },
    { x: 0, z: 300 },
    { x: -60, z: 380 },
    { x: -180, z: 380 },
    { x: -240, z: 300 },
    { x: -240, z: 150 },
    { x: -240, z: 0 },
    { x: -180, z: -80 },
    { x: -60, z: -80 },
  ],
};
const track = TrackGeometry.build(def);
const env = { track, style: styleFor("canyon"), bank: new Bank(track), groundAt: () => 0 };
const fake = {} as Texture;

const pieces: HazardDef[] = [
  ...stomperRow({ at: 0.05, lanes: [-4, 4], period: 4.4 }),
  pendulum({ at: 0.12, reach: 5, period: 3 }),
  crosser({ at: 0.2, reach: 12, period: 6 }),
  ...sweeper({ at: 0.3, length: 8, period: 4, both: true }),
  { kind: "icicle", at: 0.4, motion: "crush", period: 4, radius: 1.5, offset: 2 },
  { kind: "boulder", at: 0.5, motion: "roll", period: 5, radius: 2, span: 0.05 },
];

describe("the set piece layer", () => {
  it("has a model for every kind the data helpers name", () => {
    expect([...PIECE_KINDS].sort()).toEqual([...PIECE_MODELS].sort());
  });

  it("draws the pieces and leaves everything else to the hazard layer", () => {
    expect(pieces.filter(isPiece).length).toBe(pieces.length - 1);
    expect(isPiece(pieces[pieces.length - 1]!)).toBe(false);
  });

  it("is a handful of draw calls however many pieces: one per kind, plus parts and shadows", () => {
    const mats = landmarkMaterials();
    const layer = buildPieces(env, pieces, mats, fake);
    const meshes = layer.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    // Crusher, ball, cart, arm ball, icicle; the parts; the shadows.
    expect(meshes.length).toBe(7);
    layer.dispose();
    mats.dispose();
  });

  it("poses a crusher where hazardAt says, flushes it red as it warns and allocates nothing new per frame", () => {
    const mats = landmarkMaterials();
    const layer = buildPieces(env, pieces, mats, fake);
    const crusher = layer.group.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.count === 2)!;
    const m = new Matrix4();
    const p = new Vector3();
    const first = pieces[0]!;
    for (const t of [0.4, 2.6, 3.4, 3.9]) {
      layer.update(t, 1 / 60);
      crusher.getMatrixAt(0, m);
      p.setFromMatrixPosition(m);
      const pose = hazardAt(track, first, t);
      const road = track.at(first.at * track.length).y;
      expect(p.y - road).toBeCloseTo(pose.y, 2);
    }
    // Mid-warning, the instance colour goes above 1 (the flush); up high, plain.
    layer.update(first.period * ((CRUSH.warn + CRUSH.fall) / 2), 1 / 60);
    const c = crusher.instanceColor!.array;
    expect(Math.max(c[0]!, c[1]!, c[2]!)).toBeGreaterThan(1.05);
    layer.update(0.1, 1 / 60);
    expect(crusher.instanceColor!.array[0]).toBe(1);
    layer.dispose();
    mats.dispose();
  });

  it("hides a cart while it waits off the road", () => {
    const mats = landmarkMaterials();
    const layer = buildPieces(env, [crosser({ at: 0.2, reach: 12, period: 6 })], mats, fake);
    const cart = layer.group.children[0] as InstancedMesh;
    const m = new Matrix4();
    layer.update(4.2, 1 / 60);
    cart.getMatrixAt(0, m);
    expect(new Vector3().setFromMatrixScale(m).x).toBe(0);
    layer.update(1.5, 1 / 60);
    cart.getMatrixAt(0, m);
    expect(new Vector3().setFromMatrixScale(m).x).toBeGreaterThan(0.5);
    layer.dispose();
    mats.dispose();
  });
});
