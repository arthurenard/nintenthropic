/**
 * The repair drone: a small white maintenance drone with cold-gas
 * thrusters, docked on the platform outside. From the third pass it works:
 * it flies to the most damaged pane and mends it with a little blue weld,
 * then the next, and goes home when the glass is whole. It is not debris:
 * shot, it is knocked spinning away for twelve seconds and mends nothing.
 *
 * The rules keep its errand and its timing; the world flies it between the
 * dock and each pane's work spot along the art's path.
 */
import type { Glass } from "./panes";
import { DRONE_FLIGHT, DRONE_KNOCKED, DRONE_SETUP, DRONE_SWITCH, INTEGRITY_MAX } from "./tuning";

export type DroneState = "docked" | "flying" | "setting" | "mending" | "returning" | "knocked";
/** Where it is or is going: the dock, or a pane's work spot. */
export type Anchor = "dock" | number;

/** From one pane to the next it has less far to go than from the dock. */
const HOP = 0.6;

export class Drone {
  state: DroneState = "docked";
  from: Anchor = "dock";
  to: Anchor = "dock";
  /** 0..1 along the way from `from` to `to` (flying, returning). */
  progress = 1;
  /** Seconds left of setting up, or of being knocked away. */
  timer = 0;
  private flight = DRONE_FLIGHT;
  /** Shot this pass (for Good Neighbour). */
  hitThisPass = false;
  /** Times shot this game. */
  hits = 0;
  /** It has flown out at least once (its tip's moment). */
  launched = false;

  /** The pane it is mending, or null. */
  get pane(): number | null {
    return this.state === "mending" || this.state === "setting" ? (this.to as number) : null;
  }

  /** It is off its errands, knocked away. */
  get knocked(): boolean {
    return this.state === "knocked";
  }

  /**
   * Time passes. `working`: the drone is on duty (from the third pass).
   * `rate`: integrity a second it mends. Returns what happened this step.
   */
  update(dt: number, glass: Glass, working: boolean, rate: number): "launch" | "arrive" | "done" | "home" | "back" | null {
    switch (this.state) {
      case "knocked":
        this.timer -= dt;
        if (this.timer > 0) return null;
        // Back from its tumble: straight to work if there is any, else home.
        this.from = "dock";
        this.progress = 0;
        {
          const worst = working ? glass.worst() : null;
          this.to = worst ?? "dock";
          this.state = worst === null ? "returning" : "flying";
        }
        this.flight = DRONE_FLIGHT;
        return "back";
      case "docked": {
        const worst = working ? glass.worst() : null;
        if (worst === null) return null;
        this.fly("dock", worst, DRONE_FLIGHT);
        const first = !this.launched;
        this.launched = true;
        return first ? "launch" : null;
      }
      case "flying":
      case "returning":
        this.progress = Math.min(1, this.progress + dt / this.flight);
        if (this.progress < 1) return null;
        if (this.state === "returning") {
          this.state = "docked";
          this.from = this.to = "dock";
          return "home";
        }
        this.state = "setting";
        this.timer = DRONE_SETUP;
        return "arrive";
      case "setting":
        this.timer -= dt;
        if (this.timer <= 0) this.state = "mending";
        return null;
      case "mending": {
        const pane = this.to as number;
        glass.mend(pane, rate * dt);
        const here = glass.integrity[pane] ?? INTEGRITY_MAX;
        const worst = glass.worst();
        const worse = worst !== null && worst !== pane && (glass.integrity[worst] ?? INTEGRITY_MAX) < here - DRONE_SWITCH;
        if (here < INTEGRITY_MAX && !worse && glass.failed !== pane) return null;
        if (worst !== null && worst !== pane && working) this.fly(pane, worst, DRONE_FLIGHT * HOP);
        else this.fly(pane, "dock", DRONE_FLIGHT);
        return "done";
      }
    }
  }

  private fly(from: Anchor, to: Anchor, seconds: number): void {
    this.from = from;
    this.to = to;
    this.progress = 0;
    this.flight = seconds;
    this.state = to === "dock" ? "returning" : "flying";
  }

  /** Shot: knocked spinning away. */
  shot(): void {
    this.hits++;
    this.hitThisPass = true;
    this.state = "knocked";
    this.timer = DRONE_KNOCKED;
  }

  reset(): void {
    this.state = "docked";
    this.from = this.to = "dock";
    this.progress = 1;
    this.timer = 0;
    this.hitThisPass = false;
    this.hits = 0;
    this.launched = false;
  }
}
