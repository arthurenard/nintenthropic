/**
 * Where a game's aim-check targets are on the screen, as the platform's aim
 * check asks for them (CalibrationStage.targets).
 */
import { Vector3, type PerspectiveCamera } from "three";
import type { CalibrationTarget } from "../types";

const ndc = new Vector3();
const toTarget = new Vector3();

/**
 * Put `target` where `centre` is in `camera`'s view, in viewport fractions,
 * with a zone `half` metres round its centre: as a fraction of the view's
 * smaller side, and never under the 3.5% the aim score is measured against.
 * False, and the target left as it was, if it is behind the eye. The camera's
 * matrices must be current.
 */
export function placeTarget(target: CalibrationTarget, camera: PerspectiveCamera, centre: Vector3, half: number): boolean {
  ndc.copy(centre).project(camera);
  if (ndc.z > 1) return false;
  target.x = (ndc.x + 1) / 2;
  target.y = (1 - ndc.y) / 2;
  const minSide = Math.min(1, camera.aspect);
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const distance = toTarget.copy(centre).sub(camera.position).length();
  target.radius = Math.max(0.035, half / (distance * 2 * tanHalf * minSide));
  return true;
}
