/**
 * Where things are, as an ear sees them. On one screen there are up to four
 * local karts, each with a place in the stereo field (the left viewport sounds
 * from the left), and everything else in the race is heard from the nearest
 * local kart: louder when close, darker when far, and to the left or right of
 * it by where it lies.
 */
import type { KartView, RacerSetup, ThingView } from "../contract";

/** A kart this screen shows, and where its sounds sit in the stereo field (-1 left .. 1 right). */
export interface LocalKart {
  kart: number;
  pan: number;
}

/**
 * The stereo places for the karts a screen shows, given in the viewports'
 * reading order (the order of ``Session.views()``): one viewport sounds from
 * the centre, two from left and right, three as a left, a right and a lower
 * middle, four as a 2 x 2 (left, right, left, right).
 */
export function localKarts(views: readonly number[]): LocalKart[] {
  const pans: Record<number, readonly number[]> = {
    1: [0],
    2: [-0.5, 0.5],
    3: [-0.55, 0.55, 0],
    4: [-0.55, 0.55, -0.55, 0.55],
  };
  const row = pans[Math.min(4, Math.max(1, views.length))]!;
  return views.slice(0, 4).map((kart, i) => ({ kart, pan: row[i]! }));
}

export interface Scene {
  locals: readonly LocalKart[];
  karts: ReadonlyMap<number, KartView>;
  /** Laps in this race. */
  laps: number;
  /** Who drives each kart (the grid), for the sounds that are a driver's own: Dabble's horn is a quack. */
  racers?: readonly Pick<RacerSetup, "id" | "character">[];
}

/** The nearest local kart to a place, and how the place sounds from there. */
export interface Listener {
  local: LocalKart;
  /** Metres. */
  distance: number;
  /** -1..1: where in the stereo field a sound from that place sits. */
  pan: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** The nearest local kart to (x, z), or null when this screen shows none. */
export function listenerAt(scene: Scene, x: number, z: number): Listener | null {
  let best: Listener | null = null;
  for (const local of scene.locals) {
    const k = scene.karts.get(local.kart);
    if (!k) continue;
    const dx = x - k.x;
    const dz = z - k.z;
    const distance = Math.hypot(dx, dz);
    if (best && distance >= best.distance) continue;
    // The kart's right is (-cos h, sin h): a place beside it is to one ear, ahead or behind it is centred.
    const lateral = (dx * -Math.cos(k.heading) + dz * Math.sin(k.heading)) / (distance + 6);
    best = { local, distance, pan: clamp(local.pan * 0.5 + lateral * 0.7, -1, 1) };
  }
  return best;
}

/** Is this one of the karts the screen shows? */
export function localOf(scene: Scene, kart: number): LocalKart | undefined {
  return scene.locals.find((l) => l.kart === kart);
}

/**
 * How a sound from kart ``id`` is heard: the player's own at full level in
 * its own place; another kart's from the nearest local kart.
 */
export function hearKart(scene: Scene, id: number): Listener | null {
  const own = localOf(scene, id);
  if (own) return { local: own, distance: 0, pan: own.pan };
  const k = scene.karts.get(id);
  return k ? listenerAt(scene, k.x, k.z) : null;
}

export function hearThing(scene: Scene, thing: ThingView): Listener | null {
  return listenerAt(scene, thing.x, thing.z);
}

/** 1 close, falling to 0 at ``radius`` metres: how much of a sound from another kart reaches the listener. */
export function falloff(distance: number, radius: number): number {
  if (distance <= 0) return 1;
  if (distance >= radius) return 0;
  return 1 - Math.pow(distance / radius, 1.5);
}
