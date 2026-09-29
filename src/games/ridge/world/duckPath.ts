import type { V3 } from "../rules/types";

/**
 * The stretch of the duck's river worth swimming: from the first place it can
 * be seen from the scope to the last. The art lays the duck's nodes along the
 * whole river, and the river's far bend lies behind its bank from the eye: a
 * duck starting there, at under a metre a second, spends its first minutes
 * (most of a round) where no scope can find it. Starting it where it comes
 * out from behind the bank, it is in view for the swim that follows.
 *
 * `seen` says whether the eye can see a duck at a point. The path is cut at
 * the first and last samples (every `step` metres) where it can; the rest of
 * the nodes between are kept as the art has them. A path that is never seen,
 * or already seen from end to end, comes back as it was.
 */
export function seenStretch(path: readonly V3[], seen: (p: V3) => boolean, step = 2): V3[] {
  interface Sample {
    p: V3;
    /** The segment it lies on (from node `seg` to the next). */
    seg: number;
  }
  const samples: Sample[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i] as V3;
    const b = path[i + 1] as V3;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      samples.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, seg: i });
    }
  }
  const last = path[path.length - 1];
  if (last) samples.push({ p: { ...last }, seg: path.length - 1 });
  const first = samples.findIndex((s) => seen(s.p));
  let end = samples.length - 1;
  while (end > first && !seen((samples[end] as Sample).p)) end--;
  if (first < 0 || (first === 0 && end === samples.length - 1)) return path.map((p) => ({ ...p }));
  const from = samples[first] as Sample;
  const to = samples[end] as Sample;
  // The cut points, and the art's own nodes between them.
  const out: V3[] = [from.p];
  for (let i = from.seg + 1; i <= to.seg; i++) out.push({ ...(path[i] as V3) });
  const tail = out[out.length - 1] as V3;
  if (Math.hypot(to.p.x - tail.x, to.p.z - tail.z) > 0.01) out.push(to.p);
  return out.length > 1 ? out : path.map((p) => ({ ...p }));
}
