/**
 * The rules' view of the valley and everyone in it: plain data, no
 * three.js, so the stages can be played and tested without a renderer.
 * The world (src/games/ridge/world/) reads the valley's art into a Plan and
 * shows what the rules decide.
 */
import type { V3 } from "../../../engine/rules/raymath";

export type { V3 };

/** Where a sentry stands, from the art's `post.<id>` nodes. */
export interface Post {
  id: string;
  kind: "sentry" | "tower" | "gunner" | "guard" | "mortar";
  at: V3;
  /** The way he faces, radians about Y (0 faces +Z, toward the ridge). */
  heading: number;
  /** How the note names the place ("the checkpoint", "the watchtower"). */
  place: string;
}

/** A counter-sniper's nest, from `sniper.<n>` with its `exposed` and `hidden` spots. */
export interface Nest {
  id: string;
  exposed: V3;
  hidden: V3;
  heading: number;
  place: string;
}

/** The valley as the rules need it: where people stand and go. Metres, the player's eye at `eye`. */
export interface Plan {
  eye: V3;
  posts: Post[];
  /** The road's centreline in the convoy's direction of travel, over the bridge. */
  road: V3[];
  /** A point on the line the convoy must not cross (the bridge). */
  bridge: V3;
  /** The patrol's beat along the road. */
  patrol: V3[];
  /** The dam road: its first point where the officer's jeep waits, its last the tunnel. */
  dam: V3[];
  farmer: V3[];
  cyclist: V3[];
  shepherd: V3[];
  /** The cheese's way down the lane to the river. */
  cheese: V3[];
  nests: Nest[];
  cows: V3[];
  sheep: V3[];
  goatLedges: V3[];
  /** The eagle's circuit, and the rock by the player's scope where it lands. */
  eagle: V3[];
  eagleRock: V3;
  /** The rubber duck's way down the river. */
  duck: V3[];
  /** Where children play by the chapel. */
  chapel: V3;
  /** The farm, where the dog runs. */
  farm: V3;
}

export type Side = "hostile" | "civilian" | "animal";

export type HostileRole = "sentry" | "tower" | "guard" | "gunner" | "patrol" | "driver" | "trooper" | "officer" | "sniper" | "mortar";
export type CivilianRole = "farmer" | "cyclist" | "shepherd" | "child";
export type AnimalKind = "cow" | "sheep" | "goat" | "eagle" | "dog" | "duck";
export type Role = HostileRole | CivilianRole | AnimalKind;

/**
 * What someone is doing, as the world shows it: each is a clip (or a pose)
 * on their rig. The rules change it; the world crossfades when it changes.
 */
export type Activity =
  | "idle"
  | "smoke"
  | "binoculars"
  | "walk"
  | "patrol_walk"
  | "run"
  | "crouch"
  | "prone"
  | "prone_aim"
  | "aim"
  | "fire"
  | "wound"
  | "dying"
  | "dead"
  | "dismount"
  | "drive"
  | "cycle"
  | "wave"
  | "panic"
  | "duck"
  | "hidden"
  | "graze"
  | "look_up"
  | "stand"
  | "hop"
  | "bleat"
  | "glide"
  | "flap"
  | "land"
  | "perched"
  | "float";

export type HitPart = "head" | "body" | "limb";

export type VehicleKind = "truck" | "jeep";

/** Where the round landed, as the world's ray casts worked it out. */
export type ShotTarget =
  | { kind: "actor"; id: number; part: HitPart }
  | { kind: "engine"; vehicle: number }
  | { kind: "vehicle"; vehicle: number }
  | { kind: "secret"; secret: SecretId }
  | { kind: "plate"; id: string }
  | { kind: "scenery" }
  | { kind: "none" };

export type SecretId = "bell" | "goat" | "cheese" | "yeti" | "siren" | "eagle" | "duck" | "echo";

/** One round's end: what it hit, where, and how far from the player. */
export interface Landing {
  target: ShotTarget;
  point: V3;
  /** Metres from the eye. */
  range: number;
}

/** Why a run ended. */
export type Ending =
  | { kind: "fell"; by: HostileRole; place: string }
  | { kind: "convoy" }
  | { kind: "officer" };
