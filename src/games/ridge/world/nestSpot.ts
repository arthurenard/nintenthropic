import type { Nest, V3 } from "../rules/types";

/**
 * Where the counter-sniper lies in his nest, so that the ridge can see him.
 * The art marks each nest with a point, and a point is not a man: in the real
 * valley the crag's ledge sits a metre under the rock's own surface, and the
 * belfry's lies behind the back of the opening he is meant to shoot through.
 * A man there is a glint and nothing more - no round can reach him, and the
 * stage he is the job of can never be won.
 *
 * So each nest is settled once, at load: from the art's point, a step at a
 * time toward the ridge (into the opening, to the ledge's lip), onto whatever
 * he would lie on there, until his head and his shoulders over the rifle are
 * in plain sight. A nest where they never are is left out, so long as another
 * remains.
 *
 * `clear` says whether nothing solid lies on the straight line between two
 * points; `floor` gives the height of the surface under (x, z) at or below
 * `top`, or null where there is none near.
 */
export interface NestWorld {
  clear(from: V3, to: V3): boolean;
  floor(x: number, z: number, top: number): number | null;
}

/** A prone man, as the rig lies (art/ridge/people): his head and the back of his neck, metres ahead of where he is put and above the ground. */
const PRONE: readonly { ahead: number; up: number }[] = [
  { ahead: 0, up: 0.45 },
  { ahead: -0.1, up: 0.27 },
];
/** How far toward the ridge he may be moved, and in what steps, metres. */
const REACH = 2.5;
const STEP = 0.1;
/** How far above the art's point the surface he lies on may be (a ledge's own rock), and below it (no falling off). */
const ABOVE = 1.2;
const BELOW = 0.6;

export function settleNest(nest: Nest, eye: V3, world: NestWorld): Nest | null {
  const from = nest.exposed;
  const dx = eye.x - from.x;
  const dz = eye.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  const fx = dx / d;
  const fz = dz / d;
  for (let k = 0; k * STEP <= REACH + 1e-9; k++) {
    const x = from.x + fx * k * STEP;
    const z = from.z + fz * k * STEP;
    const y = world.floor(x, z, from.y + ABOVE);
    if (y === null || y < from.y - BELOW) continue;
    const seen = PRONE.every((p) => world.clear(eye, { x: x + fx * p.ahead, y: y + p.up, z: z + fz * p.ahead }));
    if (!seen) continue;
    const at = { x, y, z };
    if (k === 0 && Math.abs(y - from.y) < 1e-6) return nest;
    // Hidden, he lies where he was put: out of sight is all that matters then.
    return { ...nest, exposed: at, hidden: { ...nest.hidden }, heading: Math.atan2(eye.x - x, eye.z - z) };
  }
  return null;
}

/** Every nest settled; one that cannot be is left out while another can be (with none, the art's are kept as they are). */
export function settleNests(nests: readonly Nest[], eye: V3, world: NestWorld): Nest[] {
  const settled = nests.map((n) => settleNest(n, eye, world));
  const kept = settled.filter((n): n is Nest => n !== null);
  return kept.length ? kept : nests.map((n) => ({ ...n }));
}
