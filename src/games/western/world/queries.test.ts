import { describe, expect, it } from "vitest";
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from "three";
import { TownQueries } from "./queries";
import type { TownLayout } from "./town";
import { mulberry32 } from "../rules/rng";

/** A jumble of a town: a huge ground, boxes of all sizes, a tilted board, and one secret. */
function town(hideOne = false) {
  const root = new Group();
  const mat = new MeshBasicMaterial({ side: DoubleSide });
  const r = mulberry32(3);
  const solids: Mesh[] = [];
  const ground = new Mesh(new PlaneGeometry(400, 400), mat);
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);
  solids.push(ground);
  for (let i = 0; i < 60; i++) {
    const m = new Mesh(new BoxGeometry(0.2 + r() * 6, 0.2 + r() * 8, 0.2 + r() * 6), mat);
    m.position.set((r() - 0.5) * 40, r() * 6, -r() * 70);
    m.rotation.y = r() * Math.PI;
    root.add(m);
    solids.push(m);
  }
  const board = new Mesh(new PlaneGeometry(3, 2), mat);
  board.position.set(2, 2, -12);
  board.rotation.set(0.4, 0.7, 0.1);
  root.add(board);
  solids.push(board);
  const bell = new Group();
  bell.userData["name"] = "secret.bell";
  const bellMesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
  bell.position.set(0, 12, -60);
  bell.add(bellMesh);
  root.add(bell);
  solids.push(bellMesh);
  if (hideOne) solids[5]!.visible = false;
  root.updateMatrixWorld(true);
  return { root, solids };
}

describe("TownQueries", () => {
  it("finds the same first hit as a plain raycast, for thousands of rays", () => {
    const { root, solids } = town();
    const q = new TownQueries({ root, solids } as unknown as TownLayout);
    const ray = new Raycaster();
    const r = mulberry32(11);
    const o = new Vector3();
    const d = new Vector3();
    const hit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      o.set((r() - 0.5) * 50, r() * 15, -r() * 80);
      d.set(r() - 0.5, r() - 0.6, r() - 0.5).normalize();
      if (i % 7 === 0) d.set(0, -1, 0); // straight down, as groundAt casts
      const far = 5 + r() * 100;
      ray.set(o, d);
      ray.far = far;
      const want = ray.intersectObjects(solids, false)[0];
      const got = q.cast(o, d, far, hit);
      if (!want) {
        expect(got, `ray ${i}`).toBeNull();
        continue;
      }
      hits++;
      expect(got, `ray ${i}`).not.toBeNull();
      expect(got!.distance).toBeCloseTo(want.distance, 3);
      expect(got!.object).toBe(want.object);
      expect(got!.normal.dot(d)).toBeLessThanOrEqual(1e-6);
    }
    expect(hits).toBeGreaterThan(1500);
  });

  it("passes through what is hidden", () => {
    const { root, solids } = town(true);
    const q = new TownQueries({ root, solids } as unknown as TownLayout);
    const hidden = solids[5]!;
    const at = hidden.getWorldPosition(new Vector3());
    const from = at.clone().add(new Vector3(0, 30, 0));
    const hit = q.cast(from, new Vector3(0, -1, 0), 100, { point: new Vector3(), normal: new Vector3(), distance: 0, object: null });
    expect(hit?.object).not.toBe(hidden);
  });

  it("sees the ground under a point, and the moving secrets as they are now", () => {
    const { root, solids } = town();
    const q = new TownQueries({ root, solids } as unknown as TownLayout);
    expect(q.groundAt(150, 150, 3)).toBeCloseTo(0, 5);
    const bell = solids[solids.length - 1]!;
    bell.parent!.position.y = 20;
    bell.parent!.updateMatrixWorld(true);
    const hit = q.cast(new Vector3(0, 30, -60), new Vector3(0, -1, 0), 50, { point: new Vector3(), normal: new Vector3(), distance: 0, object: null });
    expect(hit?.object).toBe(bell);
    expect(hit!.point.y).toBeCloseTo(20.5, 3);
  });
});
