/**
 * Where the art puts the planet and the sun (art/orbit/orbitlib/world.py),
 * in three's axes, for the placeholders' `planet` and `sun` nodes: a
 * 6371 km world 420 km below, its centre a little ahead of straight down so
 * its limb crosses the view a third of the way from the top with a slight
 * roll, and the baked sun up on the left and ahead.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import { viewAxes } from "../rules/layout";

export const R_KM = 6371;
export const ALT_KM = 420;
export const LIMB_ABOVE_CENTRE_DEG = 11;
export const HORIZON_ROLL_DEG = -4;
/** The part of the planet under the station at the start, and the view's heading over it. */
export const SUBPOINT: readonly [number, number] = [-146, 12];
export const HEADING_DEG = 60;
/** The baked sun: above the station's horizontal, and round from the view (+ right). */
export const SUN_ELEV_DEG = 30;
export const SUN_AZ_DEG = -62;

const RAD = Math.PI / 180;

function rotateAbout(v: Vector3, axis: Vector3, angle: number): Vector3 {
  return v.clone().applyAxisAngle(axis.clone().normalize(), angle);
}

/** Unit vector from the eye toward the planet's centre. */
export function nadir(): Vector3 {
  const { up, forward } = viewAxes();
  const f = new Vector3(forward.x, forward.y, forward.z);
  const downInView = new Vector3(up.x, up.y, up.z).negate();
  const dip = Math.asin(R_KM / (R_KM + ALT_KM)) / RAD;
  const ang = (dip - LIMB_ABOVE_CENTRE_DEG) * RAD;
  const n = f.clone().multiplyScalar(Math.cos(ang)).addScaledVector(downInView, Math.sin(ang));
  return rotateAbout(n, f, HORIZON_ROLL_DEG * RAD).normalize();
}

/** The station's frame: up (away from the planet), the view's heading along its horizontal, and right. */
export function stationFrame(towardCentre: Vector3): { up: Vector3; heading: Vector3; right: Vector3 } {
  const { forward } = viewAxes();
  const up = towardCentre.clone().normalize().negate();
  const f = new Vector3(forward.x, forward.y, forward.z);
  const heading = f.clone().addScaledVector(up, -f.dot(up)).normalize();
  const right = heading.clone().cross(up).normalize();
  return { up, heading, right };
}

/** A direction from its elevation above the station's horizontal and azimuth from the heading (+ right). */
export function fromStation(frame: { up: Vector3; heading: Vector3; right: Vector3 }, elevation: number, azimuth: number): Vector3 {
  return frame.heading
    .clone()
    .multiplyScalar(Math.cos(azimuth))
    .addScaledVector(frame.right, Math.sin(azimuth))
    .multiplyScalar(Math.cos(elevation))
    .addScaledVector(frame.up, Math.sin(elevation))
    .normalize();
}

/** Toward the sun, as baked. */
export function sunDirection(): Vector3 {
  return fromStation(stationFrame(nadir()), SUN_ELEV_DEG * RAD, SUN_AZ_DEG * RAD);
}

/** A direction on the planet (three's sphere axes: y north, x longitude 0, −z 90° E). */
export function lonLat(lonDeg: number, latDeg: number): Vector3 {
  const lon = lonDeg * RAD;
  const lat = latDeg * RAD;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

/**
 * The planet's turn (its frame to the world): the ground at SUBPOINT under
 * the station, the heading over it along the view's horizontal direction.
 */
export function planetRotation(): Quaternion {
  const [lon, lat] = SUBPOINT;
  const upP = lonLat(lon, lat);
  const eastP = new Vector3(0, 1, 0).cross(upP).normalize();
  const northP = upP.clone().cross(eastP).normalize();
  const h = HEADING_DEG * RAD;
  const fwdP = northP.clone().multiplyScalar(Math.cos(h)).addScaledVector(eastP, Math.sin(h));
  const sideP = fwdP.clone().cross(upP);
  const frame = stationFrame(nadir());
  const sideW = frame.heading.clone().cross(frame.up);
  const A = new Matrix4().makeBasis(fwdP, sideP, upP);
  const B = new Matrix4().makeBasis(frame.heading, sideW, frame.up);
  return new Quaternion().setFromRotationMatrix(B.multiply(A.transpose()));
}

/** The planet's centre, metres from the eye. */
export function planetCentre(): Vector3 {
  return nadir().multiplyScalar((R_KM + ALT_KM) * 1000);
}
