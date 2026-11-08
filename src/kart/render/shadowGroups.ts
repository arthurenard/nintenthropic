/**
 * Which views share one shadow pass. The sun's shadow map is a box round a spot, and drawing it is the karts again
 * (a dozen draws each, welded far away) for every view. Views whose karts are near each other see the same
 * shadows, so they can share a map aimed between them: one pass instead of two to four. How near is a
 * `spread`, metres across the group's karts; 0 gives every view its own pass (the picture at the top step), and
 * `maxGroups` merges the closest groups when even that is too many passes for a machine that is struggling.
 */

export interface Spot {
  x: number;
  y: number;
  z: number;
}

export interface ShadowGroup {
  /** The views in this group, ascending. */
  views: number[];
  /** Where its shadow map is aimed: the middle of the box round the group's karts. */
  centre: Spot;
}

interface Box {
  min: Spot;
  max: Spot;
  views: number[];
}

const reach = (b: Box) => Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z, (b.max.y - b.min.y) * 0.5);

function grown(b: Box, s: Spot): Box {
  return {
    min: { x: Math.min(b.min.x, s.x), y: Math.min(b.min.y, s.y), z: Math.min(b.min.z, s.z) },
    max: { x: Math.max(b.max.x, s.x), y: Math.max(b.max.y, s.y), z: Math.max(b.max.z, s.z) },
    views: b.views,
  };
}

const merged = (a: Box, b: Box): Box => ({
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  views: [...a.views, ...b.views].sort((p, q) => p - q),
});

const middle = (b: Box): Spot => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 });

/**
 * `spots` are where each view's kart is. Groups come back by their first view, so view 0 always leads the first. A view
 * joins the first group it fits in without the group's karts spreading wider than `spread`; with `maxGroups` fewer
 * groups than that, the two whose middles are closest are merged until it is so.
 */
export function shadowGroups(spots: readonly Spot[], spread: number, maxGroups = 4): ShadowGroup[] {
  let boxes: Box[] = [];
  spots.forEach((s, i) => {
    if (spread > 0) {
      for (let g = 0; g < boxes.length; g++) {
        const next = grown(boxes[g]!, s);
        if (reach(next) <= spread) {
          next.views.push(i);
          boxes[g] = next;
          return;
        }
      }
    }
    boxes.push({ min: { ...s }, max: { ...s }, views: [i] });
  });
  const limit = Math.max(1, maxGroups);
  while (boxes.length > limit) {
    let best: [number, number] = [0, 1];
    let bestD = Infinity;
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const p = middle(boxes[a]!);
        const q = middle(boxes[b]!);
        const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        if (d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
    }
    const [a, b] = best;
    const m = merged(boxes[a]!, boxes[b]!);
    boxes = boxes.filter((_, i) => i !== a && i !== b);
    boxes.push(m);
  }
  boxes.sort((p, q) => p.views[0]! - q.views[0]!);
  return boxes.map((b) => ({ views: b.views, centre: middle(b) }));
}
