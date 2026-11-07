/**
 * The far kart: the whole kart (body, livery, wheels, driver at rest) welded and
 * thinned by vertex clustering, so a kart 34 m or more from the camera costs a
 * fraction of the triangles of a near one. Vertices that fall in the same cell
 * of a grid, and share a surface (chrome stays chrome, paint stays paint), merge
 * into one; triangles that collapse are dropped. Colours and surfaces are kept
 * from the cluster's first vertex, positions and normals averaged. Nothing here
 * is random, so every device makes the same far kart.
 */
import { BufferGeometry, Float32BufferAttribute } from "three";

/** `geometry` (the kart's shared vertex format: position, normal, color, aSurf, indexed) with its vertices merged on a grid of `cell` metres. */
export function cluster(geometry: BufferGeometry, cell: number): BufferGeometry {
  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  const col = geometry.getAttribute("color");
  const surf = geometry.getAttribute("aSurf");
  const idx = geometry.index!;
  const inv = 1 / cell;
  const clusterOf = new Map<string, number>();
  const map = new Int32Array(pos.count);
  const sum: number[] = [];
  const count: number[] = [];
  const first: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * inv)},${Math.round(pos.getY(i) * inv)},${Math.round(pos.getZ(i) * inv)}|${surf.getX(i).toFixed(2)},${surf.getY(i).toFixed(2)},${surf.getZ(i).toFixed(2)},${surf.getW(i).toFixed(1)}`;
    let c = clusterOf.get(key);
    if (c === undefined) {
      c = count.length;
      clusterOf.set(key, c);
      count.push(0);
      first.push(i);
      sum.push(0, 0, 0, 0, 0, 0);
    }
    map[i] = c;
    count[c]!++;
    const s = c * 6;
    sum[s]! += pos.getX(i);
    sum[s + 1]! += pos.getY(i);
    sum[s + 2]! += pos.getZ(i);
    sum[s + 3]! += nor.getX(i);
    sum[s + 4]! += nor.getY(i);
    sum[s + 5]! += nor.getZ(i);
  }
  const n = count.length;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const aSurf = new Float32Array(n * 4);
  for (let c = 0; c < n; c++) {
    const s = c * 6;
    const k = 1 / count[c]!;
    position[c * 3] = sum[s]! * k;
    position[c * 3 + 1] = sum[s + 1]! * k;
    position[c * 3 + 2] = sum[s + 2]! * k;
    const len = Math.hypot(sum[s + 3]!, sum[s + 4]!, sum[s + 5]!) || 1;
    normal[c * 3] = sum[s + 3]! / len;
    normal[c * 3 + 1] = sum[s + 4]! / len;
    normal[c * 3 + 2] = sum[s + 5]! / len;
    const f = first[c]!;
    color[c * 3] = col.getX(f);
    color[c * 3 + 1] = col.getY(f);
    color[c * 3 + 2] = col.getZ(f);
    aSurf[c * 4] = surf.getX(f);
    aSurf[c * 4 + 1] = surf.getY(f);
    aSurf[c * 4 + 2] = surf.getZ(f);
    aSurf[c * 4 + 3] = surf.getW(f);
  }
  const index: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = map[idx.getX(t)]!;
    const b = map[idx.getX(t + 1)]!;
    const d = map[idx.getX(t + 2)]!;
    if (a !== b && b !== d && a !== d) index.push(a, b, d);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  g.setAttribute("color", new Float32BufferAttribute(color, 3));
  g.setAttribute("aSurf", new Float32BufferAttribute(aSurf, 4));
  g.setIndex(index);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
