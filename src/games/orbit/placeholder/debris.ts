/**
 * The placeholder debris library, to the art's contract
 * (art/orbit/orbitlib/debris.py): wholes at the origin named `shrapnel.<n>`,
 * `chunk.<n>`, `slab.<n>`, `shard.<n>` and `foil.<n>` (a group of
 * `foil.<n>.wrap` round `foil.<n>.core`), with extras {kind, size_m}; and
 * for what splits, a sibling group `<name>.pieces` whose pieces
 * (`<name>.piece.<m>`) reassemble the whole. Faceted metal that catches
 * the sun as it turns; solar cells on the shards; gold foil round the cores.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type Material } from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mulberry32, type Random } from "../../../engine/rules/rng";
import { nameNode } from "../../../engine/world/names";
import { materials } from "./materials";

function jitter(r: Random, s: number): number {
  return (r() - 0.5) * 2 * s;
}

/** Random points filling an ellipsoid (dented where `dent`), for a hull. */
function blob(r: Random, n: number, sx: number, sy: number, sz: number, dent = 0.25): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const k = 1 - dent * r();
    pts.push(new Vector3(Math.cos(a) * s * sx * k, u * sy * k, Math.sin(a) * s * sz * k));
  }
  return pts;
}

/** Per-face normals and box-projected UVs, so it reads as crumpled, faceted metal. */
function faceted(g: BufferGeometry, uvScale = 1.5): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const [a, b] = ax > ay && ax > az ? [pos.getY(i), pos.getZ(i)] : ay > az ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = a * uvScale;
    uv[i * 2 + 1] = b * uvScale;
  }
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
  return geo;
}

function hull(points: Vector3[]): BufferGeometry {
  return faceted(new ConvexGeometry(points));
}

/** The points split by planes through the middle into `n` groups, each with the cut faces' points shared. */
function fracture(r: Random, points: Vector3[], n: number): Vector3[][] {
  const groups: Vector3[][] = Array.from({ length: n }, () => []);
  const seeds = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    return new Vector3(Math.cos(a), jitter(r, 0.4), Math.sin(a)).multiplyScalar(0.5);
  });
  // Each point to its nearest seed (a Voronoi cut), and points near a border to both.
  for (const p of points) {
    const d = seeds.map((s) => s.distanceToSquared(p));
    const order = d.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    groups[order[0]![1]]!.push(p);
    if (order[1] && order[1][0] - order[0]![0] < 0.02) groups[order[1][1]]!.push(p);
  }
  // A piece needs a few points to be a solid: borrow from the middle.
  return groups.map((g) => (g.length >= 6 ? g : g.concat(blob(r, 8, 0.05, 0.05, 0.05))));
}

function whole(name: string, kind: string, size: number, mesh: Object3D): Object3D {
  nameNode(mesh, name);
  mesh.userData["kind"] = kind;
  mesh.userData["size_m"] = size;
  mesh.userData["surface"] = "metal";
  return mesh;
}

function mesh(g: BufferGeometry, m: Material): Mesh {
  const out = new Mesh(g, m);
  out.castShadow = false;
  return out;
}

function pieces(root: Group, name: string, parts: Vector3[][], m: Material): void {
  const group = new Group();
  nameNode(group, `${name}.pieces`);
  parts.forEach((pts, i) => {
    const g = new ConvexGeometry(pts);
    // Each piece's own origin at its centre, placed where it sat in the whole.
    g.computeBoundingBox();
    const c = new Vector3();
    g.boundingBox!.getCenter(c);
    g.translate(-c.x, -c.y, -c.z);
    const p = mesh(faceted(g), m);
    p.position.copy(c);
    nameNode(p, `${name}.piece.${i + 1}`);
    p.userData["kind"] = "piece";
    group.add(p);
  });
  root.add(group);
}

export function buildPlaceholderDebris(): Group {
  const root = new Group();
  nameNode(root, "debris");
  const m = materials();
  const flat = (base: MeshStandardMaterial) => {
    const c = base.clone();
    c.flatShading = true;
    return c;
  };
  const alu = flat(m.alu);
  const gold = flat(m.gold);
  const white = flat(m.white);
  const dark = flat(m.dark);
  const r = mulberry32(77);

  // Shrapnel: torn skin, a bent bracket, a crushed tube, a nut plate.
  for (let i = 1; i <= 4; i++) {
    const pts = blob(r, 14, 0.14 + r() * 0.06, 0.05 + r() * 0.06, 0.1 + r() * 0.05, 0.5);
    root.add(whole(`shrapnel.${i}`, "shrapnel", 0.3, mesh(hull(pts), i % 3 === 0 ? gold : alu)));
  }
  // Chunks: a dented avionics box in torn blanket, a pipe with a flange, a wheel housing.
  for (let i = 1; i <= 3; i++) {
    const pts = blob(r, 40, 0.42, 0.32 + r() * 0.1, 0.36, 0.3);
    const mat = i === 1 ? white : i === 2 ? alu : gold;
    root.add(whole(`chunk.${i}`, "chunk", 0.85, mesh(hull(pts), mat)));
    pieces(root, `chunk.${i}`, fracture(r, pts, i % 2 === 1 ? 3 : 2), mat);
  }
  // Slabs: torn panels the size of a door, isogrid skin, honeycomb.
  for (let i = 1; i <= 2; i++) {
    const pts: Vector3[] = [];
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const rad = 1 + jitter(r, 0.18);
      pts.push(new Vector3(Math.cos(a) * 0.95 * rad, jitter(r, 0.02) + 0.04, Math.sin(a) * 0.55 * rad));
      pts.push(new Vector3(Math.cos(a) * 0.95 * rad, jitter(r, 0.02) - 0.04, Math.sin(a) * 0.55 * rad));
    }
    const mat = i === 1 ? white : alu;
    root.add(whole(`slab.${i}`, "slab", 1.9, mesh(hull(pts), mat)));
    pieces(root, `slab.${i}`, fracture(r, pts, 3), mat);
  }
  // Solar panel shards: cells on one face, bare on the back.
  const cells = m.cells.clone();
  cells.flatShading = true;
  for (let i = 1; i <= 3; i++) {
    const pts: Vector3[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + jitter(r, 0.2);
      const rad = 0.6 * (1 + jitter(r, 0.3));
      pts.push(new Vector3(Math.cos(a) * rad, Math.sin(a) * rad * 0.7, 0.012));
      pts.push(new Vector3(Math.cos(a) * rad, Math.sin(a) * rad * 0.7, -0.012));
    }
    // Faces +Z: the shard's face, which the rules turn toward and away from the eye.
    root.add(whole(`shard.${i}`, "shard", 1.2, mesh(hull(pts), cells)));
  }
  // Foil-wrapped pieces: gold insulation crumpled round a dense core.
  for (let i = 1; i <= 3; i++) {
    const group = new Group();
    const core = blob(r, 30, 0.3, 0.26, 0.3, 0.2);
    const wrap = blob(r, 50, 0.44, 0.38, 0.44, 0.35);
    const coreMesh = mesh(hull(core), dark);
    nameNode(coreMesh, `foil.${i}.core`);
    const wrapMesh = mesh(hull(wrap), gold);
    nameNode(wrapMesh, `foil.${i}.wrap`);
    group.add(coreMesh, wrapMesh);
    root.add(whole(`foil.${i}`, "foil", 0.9, group));
    pieces(root, `foil.${i}`, fracture(r, core, 2 + (i % 2)), dark);
  }
  return root;
}
