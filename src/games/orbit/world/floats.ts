/**
 * The things adrift on tethers inside the cupola (the art's `float.<n>`: a
 * camera, a pen, a checklist card, a plush planet), each turning slowly
 * about its tether's anchor - the node's origin - as weightless things do.
 * When a pane fails they are pulled toward it, hard, to the ends of their
 * cords.
 */
import { Box3, Matrix4, Quaternion, Vector3, type Object3D } from "three";

interface Float {
  node: Object3D;
  rest: Quaternion;
  axis: Vector3;
  rate: number;
  phase: number;
  amount: number;
  /** Which way it hangs from the anchor, in its own frame. */
  hang: Vector3;
}

/** The middle of what hangs from a node, in the node's own frame. */
function hangOf(node: Object3D): Vector3 {
  node.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(node.matrixWorld).invert();
  // Its own mesh (the art's floats are one each, cord and all) and anything under it.
  const box = new Box3().setFromObject(node, true).applyMatrix4(inverse);
  const c = box.isEmpty() ? new Vector3(0, -1, 0) : box.getCenter(new Vector3());
  if (c.lengthSq() < 1e-6) c.set(0, -1, 0);
  return c.normalize();
}

const q = new Quaternion();
const q2 = new Quaternion();
const down = new Vector3();
const toward = new Vector3();

export class Floats {
  private readonly floats: Float[];
  private time = 0;
  /** The pull toward a failed pane: 0 none .. 1 at the end of the cords. */
  private rush = 0;
  private readonly rushAt = new Vector3();
  /** Settings.reducedMotion: barely moving. */
  reducedMotion = false;

  constructor(nodes: readonly Object3D[], random: () => number) {
    this.floats = nodes.map((node) => ({
      node,
      rest: node.quaternion.clone(),
      axis: new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      rate: 0.35 + random() * 0.3,
      phase: random() * Math.PI * 2,
      amount: 0.08 + random() * 0.08,
      hang: hangOf(node),
    }));
  }

  /** A pane gave way here (world): everything loose goes toward it. */
  decompress(at: Vector3): void {
    this.rushAt.copy(at);
    this.rush = 1;
  }

  update(dt: number): void {
    this.time += dt;
    const k = this.reducedMotion ? 0.3 : 1;
    for (const f of this.floats) {
      const swing = Math.sin(this.time * f.rate + f.phase) * f.amount * k;
      q.setFromAxisAngle(f.axis, swing);
      f.node.quaternion.copy(f.rest).premultiply(q);
      if (this.rush > 0.001) {
        // The cord (the node's own down, from the anchor) turned toward the breach.
        const anchor = f.node.getWorldPosition(new Vector3());
        down.copy(f.hang).applyQuaternion(f.node.getWorldQuaternion(q2)).normalize();
        toward.copy(this.rushAt).sub(anchor).normalize();
        q.setFromUnitVectors(down, toward);
        q2.identity().slerp(q, this.rush * 0.9);
        // A turn in the world, made in the parent's frame.
        const parent = f.node.parent ? f.node.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
        q2.premultiply(parent.clone().invert()).multiply(parent);
        f.node.quaternion.premultiply(q2);
      }
    }
    this.rush = Math.max(0, this.rush - dt * 0.12);
  }

  reset(): void {
    this.rush = 0;
    for (const f of this.floats) f.node.quaternion.copy(f.rest);
  }
}
