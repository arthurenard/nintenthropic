import type { BufferGeometry, Object3D } from "three";
import type { Emote } from "../../contract";
import type { Character } from "../../characters";
import type { V3 } from "../world/builder";

export type Species = Character["species"];

/** What the rig tells a bit that moves on its own. */
export interface BitState {
  time: number;
  /** 0..1: how happy (a cheer, a finish). */
  happy: number;
  /** 0..1: how dizzy. */
  dizzy: number;
  steer: number;
  lean: number;
}

/** A part that moves by itself (a tail, an antenna): its geometry is built round its pivot. */
export interface Bit {
  geo: BufferGeometry;
  at: V3;
  on: "torso" | "head";
  move?(o: Object3D, s: BitState): void;
}

export interface DriverBuild {
  torso: BufferGeometry;
  head: BufferGeometry;
  /** An arm along +z from the shoulder; both sides use it unless `armR` is given. */
  arm: BufferGeometry;
  /** The other (right, -x) arm, when the two are modelled apart. */
  armR?: BufferGeometry;
  /** Where the left shoulder is (the right is its mirror), when the model says; else (shoulder, SHOULDER_Y, SHOULDER_Z). */
  shoulderAt?: V3;
  bits: Bit[];
  /** The shoulders' distance from the middle. */
  shoulder: number;
  /** Where the head sits (HEAD_AT by default). */
  headAt?: V3;
  /** How high above the head's centre the dizzy stars circle. */
  crown: number;
}

/** What a driver is asked to show on one frame. */
export interface DriverMotion {
  time: number;
  /** -1..1 */
  steer: number;
  lean: number;
  /** Radians the driver has twirled in a trick. */
  twirl: number;
  emote?: Emote | null;
  finished?: boolean;
  dizzy?: boolean;
  /** -1..1: glancing back over a shoulder (+ the left one, +x) at a kart close behind. */
  lookBack?: number;
  /** 0..1: how much at rest (on the grid, stopped): the driver breathes and looks about. */
  rest?: number;
  /** 0..1: how shut the eyes are, at least (a blink's own timing is the driver's). */
  shut?: number;
  /** The head's size, as a multiple (1 when absent). */
  headScale?: number;
}
