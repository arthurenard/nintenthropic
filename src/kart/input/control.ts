/**
 * The wheel as a DriverControl: a WheelReader plugged into the tracker (or any
 * HandSource) and the game's tick.
 */
import type { HandSource } from "../../tracking/types";
import type { DriveInput, DriverControl, WheelStatus } from "../contract";
import { WheelReader, type Steering, type WheelOptions } from "./wheel";

export interface WheelControlOptions extends Omit<WheelOptions, "aspect"> {
  /**
   * The picture's width over its height, or a function that says it (the
   * camera may not be open yet): a wheel's angle is wrong on a stretched
   * picture. Default 16:9.
   */
  aspect?: number | (() => number);
  /** The clock frames and ticks are timed on, ms; performance.now by default. Tests give their own. */
  now?: () => number;
}

/** A wheel player's control, with what the wheel check screen needs on top of a DriverControl. */
export interface WheelControl extends DriverControl {
  readonly kind: "wheel";
  /** What the camera sees of the wheel right now. */
  readonly wheel: WheelStatus;
  readonly reader: WheelReader;
  /** Settings, Steering: changes the very next tick. */
  steering: Steering;
  /** The level offset in degrees, to be kept between visits and given back with this setter. */
  level: number;
  readonly levelled: boolean;
  /** Takes the wheel as it is now for level; false when both hands are not in view. */
  setLevel(): boolean;
  resetLevel(): void;
  /** Sets the level once the wheel has been held level and still for a second; `levelProgress` says how far along. */
  startAutoLevel(done?: () => void): void;
  cancelAutoLevel(): void;
  readonly levelProgress: number;
  /** Fingers out on each hand (0..4) as last read, for tuning with real hands. */
  readonly fingers: { left: number | null; right: number | null };
}

/**
 * Drives with both hands, read from `source` (the tracker, which must be
 * looking for two hands, or four for two players on one camera).
 *
 * The control runs on its own clock (`options.now`, performance.now by
 * default) rather than the `now` sample() is given: the camera's frames
 * arrive on that clock, and hands that have gone out of the picture are
 * noticed by it.
 */
export function wheelControl(source: HandSource, options: WheelControlOptions = {}): WheelControl {
  const { aspect, now, ...rest } = options;
  const clock = now ?? (() => performance.now());
  const reader = new WheelReader({ ...rest, aspect: typeof aspect === "number" ? aspect : undefined });
  const keepAspect = () => {
    if (typeof aspect !== "function") return;
    const value = aspect();
    if (Number.isFinite(value) && value > 0) reader.aspect = value;
  };
  keepAspect();
  const stop = source.subscribe((frame) => {
    keepAspect();
    reader.push(frame, clock());
  });
  return {
    kind: "wheel",
    reader,
    sample(): DriveInput {
      keepAspect();
      return reader.sample(clock()).input;
    },
    get wheel(): WheelStatus {
      keepAspect();
      return reader.sample(clock()).status;
    },
    get steering() {
      return reader.steering;
    },
    set steering(steering: Steering) {
      reader.steering = steering;
    },
    get level() {
      return reader.level;
    },
    set level(degrees: number) {
      reader.level = degrees;
    },
    get levelled() {
      return reader.levelled;
    },
    setLevel: () => reader.setLevel(),
    resetLevel: () => reader.resetLevel(),
    startAutoLevel: (done) => reader.startAutoLevel(done),
    cancelAutoLevel: () => reader.cancelAutoLevel(),
    get levelProgress() {
      return reader.levelProgress;
    },
    get fingers() {
      return reader.fingers;
    },
    dispose() {
      stop();
    },
  };
}
