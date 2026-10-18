/**
 * A plain follow-the-track driver, for a kart whose player has left.
 *
 * The real sim takes such a kart over itself (`Race.handOver`) and drives it
 * as one of its own bots. A race without `handOver`, such as the net's
 * stand-in (fakeRace.ts), cannot, so for those the host drives the kart
 * itself, through the same `step(inputs)` a player's kart takes: aim at
 * a point a little way down the centre line, slow for the bends ahead, use an
 * item when one is held. It is not the sim's racing line, drift or rubber
 * band; it keeps the kart going and on the road, which is all a seat left
 * empty needs.
 */
import type { DriveInput, KartView } from "../contract";
import type { TrackGeometry } from "../track/geometry";
import { clamp, wrapAngle } from "./util";

/** The kart's own yaw rate at full lock, radians a second (docs/GRIP_PRIX.md: up to ~2.2). */
const MAX_YAW = 2.2;
/** Sideways grip we trust a bend to give, m/s²: the speed a bend allows is √(this / curvature). */
const GRIP = 11;
const TOP = 24;
/** Ticks to wait between item uses, so a handful of items are not thrown away at once. */
const ITEM_GAP = 90;

export class Autopilot {
  private s: number | undefined;
  private presses: number;
  private wait = 0;

  /** `itemPresses` is where the driver's count stood, so the sim sees no phantom press. */
  constructor(
    private geometry: TrackGeometry,
    itemPresses: number,
  ) {
    this.presses = itemPresses;
  }

  drive(kart: KartView): DriveInput {
    const g = this.geometry;
    const here = g.project(kart.x, kart.z, this.s);
    this.s = here.s;

    // Aim a little way ahead: further when faster, so the line stays smooth.
    const speed = Math.max(0, kart.speed);
    const look = clamp(speed * 0.55 + 5, 7, 28);
    const target = g.point(here.s + look, 0);
    const error = wrapAngle(Math.atan2(target.x - kart.x, target.z - kart.z) - kart.heading);
    // Pure pursuit: the turn that would arc onto the target, as a share of full lock. Steering right is negative error.
    const yaw = (2 * Math.sin(error) * Math.max(speed, 4)) / look;
    const steer = clamp(-yaw / MAX_YAW, -1, 1);

    // The slowest bend in the next 70 m sets the speed we can carry now.
    let curve = 0;
    for (let ahead = 5; ahead <= 70; ahead += 5) curve = Math.max(curve, Math.abs(g.at(here.s + ahead).curvature));
    const off = Math.abs(here.offset) > here.sample.width / 2 + 1 || Math.abs(error) > 1.2;
    const allowed = off ? 9 : clamp(Math.sqrt(GRIP / Math.max(curve, 1e-3)), 9, TOP);

    const throttle = speed < allowed ? 1 : 0;
    const brake = speed > allowed * 1.15 ? clamp((speed - allowed) / 6, 0, 1) : 0;

    if (this.wait > 0) this.wait--;
    if (kart.item !== null && !kart.rolling && this.wait === 0) {
      this.presses++;
      this.wait = ITEM_GAP;
    }
    return { steer, throttle, brake, drift: false, itemPresses: this.presses };
  }
}
