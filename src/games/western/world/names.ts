import { Object3D, PropertyBinding } from "three";

/**
 * Names in the asset contract (docs/WEB_ARCHITECTURE.md) have dots in them:
 * `cover.saloon_door.hidden`, `shoulder.L`, `var.hat.bowler`. Three.js's glTF
 * loader strips those dots from `Object3D.name` — animation bindings use dots
 * as separators — and keeps the original in `userData.name`. Everything in
 * High Noon looks nodes up by that original name, and the procedural
 * placeholders store their names the same way, so real files and
 * placeholders are read by the same code.
 */
export function contractName(o: Object3D): string {
  const original = o.userData["name"];
  return typeof original === "string" ? original : o.name;
}

/** Name a node the way GLTFLoader would have. */
export function nameNode<T extends Object3D>(o: T, name: string): T {
  o.name = PropertyBinding.sanitizeNodeName(name);
  o.userData["name"] = name;
  return o;
}

export function findNode(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((o) => {
    if (!found && contractName(o) === name) found = o;
  });
  return found;
}

/** Every node whose contract name starts with `prefix`, keyed by the rest of the name. */
export function nodesWithPrefix(root: Object3D, prefix: string): Map<string, Object3D> {
  const out = new Map<string, Object3D>();
  root.traverse((o) => {
    const n = contractName(o);
    if (n.startsWith(prefix)) out.set(n.slice(prefix.length), o);
  });
  return out;
}

/** An extras value as a string, looking at the node and then its ancestors. */
export function extraString(o: Object3D | null, key: string): string | undefined {
  for (let n = o; n; n = n.parent) {
    const v = n.userData[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

export function extraNumber(o: Object3D, key: string): number | undefined {
  const v = o.userData[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
