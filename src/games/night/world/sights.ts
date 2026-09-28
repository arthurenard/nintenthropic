import { Box3, Sphere, Vector3, type Object3D } from "three";
import { chromeKeepOut, fitFraming, WEAPON_DOCK, type Framing, type Sight } from "../../../engine/world/framing";
import type { RoadLayout } from "./road";

/** How a sitting cat's middle sits above its spot. */
const CAT_MIDDLE = 0.18;

/**
 * Every place the fight happens, as points the play framing must show: the
 * head and chest of one of the dead at each place at the barricade, where
 * each lane brings them into plain view, the survivors' runs, and the
 * secrets - the sign's letters, the moon, the booth, the radio, the duck,
 * the scarecrow, each of the cat's perches and the drive-in's lamp (on
 * screen, if not necessarily clear of the chrome). In the eye's own space.
 */
export function playSights(road: RoadLayout): Sight[] {
  const eye = road.eye;
  const toCamera = road.eyeQuaternion.clone().invert();
  const out: Sight[] = [];
  const v = new Vector3();
  const add = (x: number, y: number, z: number, clear: boolean, margin?: number) => {
    v.set(x, y, z).sub(eye).applyQuaternion(toCamera);
    out.push(margin === undefined ? { x: v.x, y: v.y, z: v.z, clear } : { x: v.x, y: v.y, z: v.z, clear, margin });
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
  for (const p of secretSpots(road)) add(p.x, p.y, p.z, false, 0.01);
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
export function secretSpots(road: RoadLayout): Vector3[] {
  const s = road.secrets;
  const out: Vector3[] = [];
  const box = new Box3();
  // The middle of what is drawn, wherever the art put the node's origin (the scarecrow's is at the foot of its post).
  const center = (o: Object3D | null) => {
    if (!o) return;
    o.updateWorldMatrix(true, true);
    box.setFromObject(o);
    out.push(box.isEmpty() ? o.getWorldPosition(new Vector3()) : box.getCenter(new Vector3()));
  };
  for (const node of s.sign.values()) center(node);
  for (const node of [s.moonDisc, s.boothLight, s.radio, s.duck, s.scarecrow, s.driveInLamp]) center(node);
  for (const p of s.catSpots) out.push(new Vector3(p.x, p.y + CAT_MIDDLE, p.z));
  return out;
}

/** The play's framing for a window: the tightest that shows the whole fight, with the chrome kept clear of anything to shoot. */
export function playFraming(sights: readonly Sight[], width: number, height: number, roadFov: number, checkFov: number, hand: boolean): Framing {
  return fitFraming(sights, width / Math.max(1, height), {
    minFov: 30,
    maxFov: Math.max(roadFov, checkFov),
    minPitch: (-1 * Math.PI) / 180,
    maxPitch: (6 * Math.PI) / 180,
    preferPitch: (2.5 * Math.PI) / 180,
    slack: 1,
    marginX: 0.02,
    marginY: 0.02,
    keepOut: chromeKeepOut(width, height, hand, { dock: WEAPON_DOCK.magazine }),
  });
}
