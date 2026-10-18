/**
 * What every game reads the same way from the named nodes of its art (the
 * asset contract, docs/WEB_ARCHITECTURE.md): where the player's eye is, and
 * what a mesh is made of for a bullet.
 */
import { Quaternion, Vector3, type Mesh, type Object3D, type PerspectiveCamera } from "three";
import { contractName, extraNumber, extraString, findNode } from "./names";

/** The player's eye: where it stands, which way it looks, and its lens's vertical field of view in degrees. */
export interface Eye {
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

/**
 * The player's eye as the art puts it: `camera.player`, a glTF camera (the
 * loader makes it a PerspectiveCamera) or an empty with `fov` extras
 * (`fov_deg` and `yfov` are read too). Art without one has the eye at
 * `position`, looking down −Z through a lens of `fov` degrees.
 */
export function readEye(root: Object3D, position: Vector3, fov: number): Eye {
  const node = findNode(root, "camera.player");
  if (!node) return { position, quaternion: new Quaternion(), fov };
  let cam: PerspectiveCamera | null = null;
  node.traverse((o) => {
    if (!cam && (o as PerspectiveCamera).isPerspectiveCamera) cam = o as PerspectiveCamera;
  });
  const extra = extraNumber(node, "fov") ?? extraNumber(node, "fov_deg") ?? extraNumber(node, "yfov");
  const lens = extra ?? (cam ? (cam as PerspectiveCamera).fov : fov);
  return { position: node.getWorldPosition(new Vector3()), quaternion: node.getWorldQuaternion(new Quaternion()), fov: lens };
}

/**
 * What a mesh is made of, for a bullet: the `surface` its extras name (or an
 * ancestor's), else its material's, if that is one of `surfaces`. Art that
 * names neither is guessed at from its name and its material's, lower-cased
 * (`guess`), so an early export still plays sensibly.
 */
export function surfaceFromArt<S extends string>(o: Object3D | null, surfaces: readonly S[], guess: (name: string) => S): S {
  const named = extraString(o, "surface");
  if (named && (surfaces as readonly string[]).includes(named)) return named as S;
  const mat = (o as Mesh | null)?.material;
  const m = Array.isArray(mat) ? mat[0] : mat;
  const fromMaterial = m?.userData?.["surface"];
  if (typeof fromMaterial === "string" && (surfaces as readonly string[]).includes(fromMaterial)) return fromMaterial as S;
  return guess(`${o ? contractName(o) : ""} ${m?.name ?? ""}`.toLowerCase());
}
