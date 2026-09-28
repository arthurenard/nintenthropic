import { Box3, Sphere, Vector3, type Object3D } from "three";
import { chromeKeepOut, fitFraming, WEAPON_DOCK, type Framing, type Sight } from "../../../engine/world/framing";
import type { RoadLayout } from "./road";

/** How a sitting cat's middle sits above its spot. */
const CAT_MIDDLE = 0.18;

/**
 * The radio is a wide screen's secret: behind the diner's window at the
 * right edge of the road's view (Route 9's is 32.6° right), on screen from
 * about 3:2. A narrower window leaves it out rather than widening the
 * whole view for it (which would still not reach it).
 */
export const RADIO_ASPECT = 1.5;

/** A point the play framing must show, from a window this wide on (all, if unset). */
export type NightSight = Sight & { minAspect?: number };

/** A secret's place, the narrowest window it must be on screen in, and how far inside the edges it must stay. */
export interface SecretSpot {
  at: Vector3;
  minAspect?: number;
  margin?: number;
}

/** The cat keeps well inside the view: a hand pointing at the very edge of the screen is on its way off it (a reload). */
const CAT_MARGIN = 0.04;

/**
 * Every place the fight happens, as points the play framing must show: the
 * head and chest of one of the dead at each place at the barricade, where
 * each lane brings them into plain view, the survivors' runs, and the
 * secrets - the sign's letters, the moon, the booth, the radio, the duck,
 * the scarecrow, each of the cat's perches and the drive-in's lamp (on
 * screen, if not necessarily clear of the chrome). In the eye's own space.
 */
export function playSights(road: RoadLayout): NightSight[] {
  const eye = road.eye;
  const toCamera = road.eyeQuaternion.clone().invert();
  const out: NightSight[] = [];
  const v = new Vector3();
  const add = (x: number, y: number, z: number, clear: boolean, margin?: number, minAspect?: number) => {
    v.set(x, y, z).sub(eye).applyQuaternion(toCamera);
    const sight: NightSight = { x: v.x, y: v.y, z: v.z, clear };
    if (margin !== undefined) sight.margin = margin;
    if (minAspect !== undefined) sight.minAspect = minAspect;
    out.push(sight);
  };
  const figure = (p: { x: number; y: number; z: number }) => {
    const dx = eye.x - p.x;
    const dz = eye.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len;
    const sz = dx / len;
    for (const s of [-1, 1]) {
      add(p.x + sx * 0.28 * s, p.y + 1.72, p.z + sz * 0.28 * s, true);
      add(p.x + sx * 0.4 * s, p.y + 1.2, p.z + sz * 0.4 * s, true);
    }
  };
  for (const s of road.slots) figure(s.pos);
  for (const lane of road.lanes) {
    // Past the corn, the bus's door, the fence: from where the lane is in view.
    const from = lane.id === "corn" ? lane.points.length - 2 : 1;
    for (let i = Math.max(0, from); i < lane.points.length; i++) {
      const p = lane.points[i];
      if (p && Math.hypot(p.x - eye.x, p.z - eye.z) < 60) figure(p);
    }
  }
  for (const path of road.survivorPaths) for (const p of path) add(p.x, p.y + 1.6, p.z, false);
  for (const { at, minAspect, margin } of secretSpots(road)) add(at.x, at.y, at.z, false, margin ?? 0.01, minAspect);
  // The whole of the moon's disc, not only its middle: a moon cut by the
  // edge of a wide window does not look like something to shoot.
  const disc = road.secrets.moonDisc;
  if (disc) {
    disc.updateWorldMatrix(true, true);
    const sphere = new Box3().setFromObject(disc).getBoundingSphere(new Sphere());
    v.copy(sphere.center).sub(eye).applyQuaternion(toCamera);
    const r = sphere.radius * 0.75;
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) out.push({ x: v.x + dx, y: v.y + dy, z: v.z, clear: false, margin: 0.01 });
  }
  return out;
}

/** Where each secret is, in the world: what has to be on screen to be found. */
export function secretSpots(road: RoadLayout): SecretSpot[] {
  const s = road.secrets;
  const out: SecretSpot[] = [];
  const box = new Box3();
  // The middle of what is drawn, wherever the art put the node's origin (the scarecrow's is at the foot of its post).
  const center = (o: Object3D | null, minAspect?: number) => {
    if (!o) return;
    o.updateWorldMatrix(true, true);
    box.setFromObject(o);
    const at = box.isEmpty() ? o.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
    out.push(minAspect === undefined ? { at } : { at, minAspect });
  };
  for (const node of s.sign.values()) center(node);
  for (const node of [s.moonDisc, s.boothLight, s.duck, s.scarecrow, s.driveInLamp]) center(node);
  center(s.radio, RADIO_ASPECT);
  for (const p of s.catSpots) out.push({ at: new Vector3(p.x, p.y + CAT_MIDDLE, p.z), margin: CAT_MARGIN });
  return out;
}

const RAD = Math.PI / 180;

/**
 * How far above the top of the road's own view (the aim check's, the art's
 * lens) the play's may reach before it shows what hangs over the player:
 * on Route 9 the canopy over the barricade, a dark band along the top of
 * the picture.
 */
const CEILING = 1.25;

/** The play's framing for a window: the tightest that shows the whole fight, with the chrome kept clear of anything to shoot. */
export function playFraming(sights: readonly NightSight[], width: number, height: number, roadFov: number, checkFov: number, hand: boolean): Framing {
  const aspect = width / Math.max(1, height);
  const shown = sights.filter((s) => s.minAspect === undefined || aspect >= s.minAspect);
  const options = {
    minFov: 30,
    maxFov: Math.max(roadFov, checkFov),
    minPitch: -1 * RAD,
    maxPitch: 6 * RAD,
    // A little higher than the road's own lens, to take in the far road.
    preferPitch: 1 * RAD,
    slack: 1,
    marginX: 0.02,
    marginY: 0.02,
    keepOut: chromeKeepOut(width, height, hand, { dock: WEAPON_DOCK.magazine }),
  };
  const framing = fitFraming(shown, aspect, options);
  // Tipped up past the art's own view, the top of the picture shows the
  // canopy overhead: then as low as the fight allows.
  const ceiling = (roadFov / 2 + CEILING) * RAD;
  const top = framing.pitch + (framing.fov * RAD) / 2;
  if (top <= ceiling) return framing;
  return fitFraming(shown, aspect, { ...options, preferPitch: Math.max(options.minPitch, ceiling - (framing.fov * RAD) / 2) });
}
