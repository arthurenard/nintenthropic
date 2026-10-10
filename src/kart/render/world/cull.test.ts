import { BoxGeometry, Color, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CELL, CulledInstances } from "./cull";

/** Instances placed by a plain position and scale, coloured by where they stand. */
function field(count = 3000): { group: Group; mesh: InstancedMesh; spots: { x: number; z: number; s: number }[] } {
  const group = new Group();
  const geometry = new BoxGeometry(2, 4, 2).translate(0, 2, 0);
  const mesh = new InstancedMesh(geometry, new MeshBasicMaterial(), count);
  const spots: { x: number; z: number; s: number }[] = [];
  const m = new Matrix4();
  for (let i = 0; i < count; i++) {
    const x = ((i * 7919) % 6000) / 10 - 300;
    const z = ((i * 104729) % 6000) / 10 - 300;
    const s = 0.8 + (i % 7) * 0.3;
    m.makeScale(s, s, s).setPosition(x, 0, z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, new Color((x + 300) / 600, 0, (z + 300) / 600));
    spots.push({ x, z, s });
  }
  group.add(mesh);
  return { group, mesh, spots };
}

function frustumOf(position: [number, number, number], target: [number, number, number], fov = 60): Frustum {
  const camera = new PerspectiveCamera(fov, 16 / 9, 0.5, 700);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

/** The (x, z) of every instance a mesh will draw, read back from its matrices. */
function drawn(mesh: InstancedMesh): string[] {
  const out: string[] = [];
  const m = new Matrix4();
  const p = new Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    out.push(`${p.x.toFixed(2)},${p.z.toFixed(2)}`);
  }
  return out;
}

describe("culling a scatter of instances for a view", () => {
  it("draws everything the frustum could see, once each, and a good deal less than everything", () => {
    const { mesh, spots } = field();
    const cull = new CulledInstances(mesh);
    const frustum = frustumOf([0, 6, -250], [0, 2, 0], 25);
    const n = cull.select(0, frustum);
    expect(n).toBeLessThan(spots.length * 0.5);
    expect(mesh.count).toBe(n);
    const got = drawn(mesh);
    expect(new Set(got).size).toBe(got.length);
    // Every instance whose own sphere touches the frustum is among them.
    const sphere = mesh.geometry.boundingSphere!;
    const wanted = spots.filter((s) => frustum.intersectsSphere(sphere.clone().set(new Vector3(s.x, 2 * s.s, s.z), sphere.radius * s.s)));
    expect(wanted.length).toBeGreaterThan(50);
    for (const s of wanted) expect(got).toContain(`${s.x.toFixed(2)},${s.z.toFixed(2)}`);
  });

  it("keeps every instance's colour with it", () => {
    const { mesh } = field();
    const cull = new CulledInstances(mesh);
    cull.select(0, frustumOf([120, 6, 40], [200, 2, 160]));
    const m = new Matrix4();
    const p = new Vector3();
    const c = new Color();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      mesh.getColorAt(i, c);
      expect(c.r).toBeCloseTo((p.x + 300) / 600, 3);
      expect(c.b).toBeCloseTo((p.z + 300) / 600, 3);
    }
  });

  it("gives each view a mesh of its own, shows only the asked one, and leaves a buffer alone until its cells change", () => {
    const { group, mesh } = field();
    const cull = new CulledInstances(mesh);
    const a = frustumOf([0, 6, -250], [0, 2, 0]);
    const b = frustumOf([200, 6, 200], [100, 2, 100]);
    cull.select(0, a);
    cull.select(1, b);
    const other = group.children.find((o) => o !== mesh) as InstancedMesh;
    expect(other).toBeDefined();
    expect(other.visible).toBe(true);
    expect(mesh.visible).toBe(false);
    cull.select(0, a);
    expect(mesh.visible).toBe(true);
    expect(other.visible).toBe(false);
    const version = mesh.instanceMatrix.version;
    const otherVersion = other.instanceMatrix.version;
    // The same cells again: nothing to rewrite.
    cull.select(1, b);
    cull.select(0, a);
    expect(mesh.instanceMatrix.version).toBe(version);
    expect(other.instanceMatrix.version).toBe(otherVersion);
    // A camera that moved on to other cells: rewritten.
    cull.select(0, frustumOf([-200, 6, -200], [-100, 2, -100]));
    expect(mesh.instanceMatrix.version).toBeGreaterThan(version);
    cull.dispose();
    expect(group.children).toEqual([mesh]);
  });

  it("puts everything back in the world's own mesh when asked, and draws nothing for a view that sees none", () => {
    const { mesh, spots } = field();
    const cull = new CulledInstances(mesh);
    expect(cull.select(0, frustumOf([0, 6, -900], [0, 6, -1500]))).toBe(0);
    expect(mesh.visible).toBe(false);
    cull.select(0, frustumOf([0, 6, -250], [0, 2, 0]));
    expect(mesh.count).toBeLessThan(spots.length);
    cull.all();
    expect(mesh.count).toBe(spots.length);
    expect(mesh.visible).toBe(true);
    expect(new Set(drawn(mesh)).size).toBe(spots.length);
  });

  it("makes cells of about a cell, and sorts without losing or duplicating an instance", () => {
    const { mesh, spots } = field(2000);
    const cull = new CulledInstances(mesh);
    // 600 m across at 48 m a cell: at most 14 x 14 of them, and a good many.
    expect(cull.cellCount).toBeGreaterThan(40);
    expect(cull.cellCount).toBeLessThanOrEqual(Math.ceil(600 / CELL + 1) ** 2);
    expect(new Set(drawn(mesh)).size).toBe(spots.length);
  });

  it("leaves a mesh that is not at the origin whole", () => {
    const { group, mesh, spots } = field(500);
    group.position.set(1000, 0, 0);
    group.updateMatrixWorld(true);
    const cull = new CulledInstances(mesh);
    expect(cull.select(0, frustumOf([0, 6, -250], [0, 2, 0]))).toBe(spots.length);
    expect(mesh.count).toBe(spots.length);
  });
});
