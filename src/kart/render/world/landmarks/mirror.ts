/**
 * A landmark model seen in a mirror (x -> -x), for a mirrored track.
 *
 * A mirrored track (track/mirror.ts) negates every offset and every turn, which puts each landmark where the original's
 * reflection stands but turns it by the reflected angle instead of reflecting it: a model that is not the same on both sides
 * (a pond with its bank on one side, a toaster with its lever, a cart with its load) would show its other flank to the road,
 * and what stood clear of the road on the original track could stand on it. Reflecting the model too makes the mirrored
 * landmark the exact mirror image of the original one, so what was checked on the track holds on its mirror.
 */
import { Object3D } from "three";
import { MeshBuilder } from "../builder";
import type { Halo, LandmarkModel, MovingPart } from "./types";

/** A copy of `b` reflected across the x = 0 plane: x negated, and each triangle's second and third corners swapped so it still faces out. */
function flipped(b: MeshBuilder): MeshBuilder {
  const out = new MeshBuilder(b.uv.length > 0);
  out.smooth = b.smooth;
  const { position: p, normal: n, color: c, uv } = b;
  for (let i = 0; i < p.length; i += 9) {
    for (const k of [0, 6, 3]) {
      out.position.push(-p[i + k]!, p[i + k + 1]!, p[i + k + 2]!);
      out.normal.push(-n[i + k]!, n[i + k + 1]!, n[i + k + 2]!);
      out.color.push(c[i + k]!, c[i + k + 1]!, c[i + k + 2]!);
    }
  }
  for (let i = 0; i < uv.length; i += 6) out.uv.push(uv[i]!, uv[i + 1]!, uv[i + 4]!, uv[i + 5]!, uv[i + 2]!, uv[i + 3]!);
  return out;
}

/** The mirror image of a part that moves: its pose is the reflection of the original's (turning the other way, swinging to the other side). */
function flippedPart(part: MovingPart): MovingPart {
  return {
    ...(part.lit ? { lit: flipped(part.lit) } : {}),
    ...(part.glow ? { glow: flipped(part.glow) } : {}),
    ...(part.glass ? { glass: flipped(part.glass) } : {}),
    pivot: [-part.pivot[0], part.pivot[1], part.pivot[2]],
    update(t: number, node: Object3D) {
      part.update(t, node);
      node.position.x = -node.position.x;
      node.rotation.y = -node.rotation.y;
      node.rotation.z = -node.rotation.z;
    },
  };
}

/** The model as a mirror shows it (a new model; the original is untouched). */
export function mirrorModel(model: LandmarkModel): LandmarkModel {
  const halos: Halo[] | undefined = model.halos?.map((h) => ({ ...h, x: -h.x }));
  return {
    ...(model.smooth !== undefined ? { smooth: model.smooth } : {}),
    lit: flipped(model.lit),
    ...(model.glow ? { glow: flipped(model.glow) } : {}),
    ...(model.glass ? { glass: flipped(model.glass) } : {}),
    ...(model.moving ? { moving: model.moving.map(flippedPart) } : {}),
    ...(halos ? { halos } : {}),
  };
}
