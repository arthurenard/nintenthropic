/**
 * Driving with a gamepad (the standard layout, which every browser maps the
 * common pads to):
 *
 *   left stick (or the d-pad)   steer
 *   right trigger               throttle
 *   left trigger                brake, and back up if held at a standstill
 *   A                           drift, held
 *   B or X                      use the item
 *   Y                           honk
 */
import type { DriveInput, DriverControl } from "../contract";

/** Stick travel that does nothing: a resting stick is never exactly centred. */
const DEAD_ZONE = 0.15;
/** The stick's travel beyond the dead zone, to this power: gentle near the centre like the wheel. */
const CURVE = 1.4;
/** A trigger pressed less than this is not pressed. */
const TRIGGER_FLOOR = 0.05;

const BUTTON = { drift: 0, itemB: 1, itemX: 2, horn: 3, brake: 6, throttle: 7, up: 12, down: 13, left: 14, right: 15 } as const;

type Pads = () => readonly (Gamepad | null)[];

const browserPads: Pads = () => (typeof navigator !== "undefined" && typeof navigator.getGamepads === "function" ? navigator.getGamepads() : []);

/** The stick's reading shaped: dead zone taken off, the rest stretched to full, then curved. */
export function shapeStick(raw: number): number {
  const size = Math.abs(raw);
  if (!(size > DEAD_ZONE)) return 0;
  return Math.sign(raw) * Math.pow(Math.min(1, (size - DEAD_ZONE) / (1 - DEAD_ZONE)), CURVE);
}

/**
 * `index` picks a pad (its slot in navigator.getGamepads()); without it the
 * first one connected drives. `pads` is for tests.
 */
export function gamepadControl(index?: number, pads: Pads = browserPads): DriverControl {
  let presses = 0;
  let itemWasDown = false;
  let hornWasDown = false;
  let horns = 0;

  return {
    kind: "gamepad",
    wheel: null,
    sample(): DriveInput {
      const list = pads();
      const pad = index === undefined ? list.find((candidate) => candidate?.connected) : list[index];
      if (!pad?.connected) {
        itemWasDown = false;
        hornWasDown = false;
        return { steer: 0, throttle: 0, brake: 0, drift: false, itemPresses: presses, horn: horns };
      }
      const button = (i: number) => pad.buttons[i];
      const value = (i: number) => {
        const b = button(i);
        return b ? (b.value > 0 ? b.value : b.pressed ? 1 : 0) : 0;
      };
      const pressed = (i: number) => button(i)?.pressed === true;
      const dpad = (pressed(BUTTON.right) ? 1 : 0) - (pressed(BUTTON.left) ? 1 : 0);
      const itemDown = pressed(BUTTON.itemB) || pressed(BUTTON.itemX);
      if (itemDown && !itemWasDown) presses++;
      itemWasDown = itemDown;
      const hornDown = pressed(BUTTON.horn);
      if (hornDown && !hornWasDown) horns++;
      hornWasDown = hornDown;
      const trigger = (i: number) => {
        const v = value(i);
        return v < TRIGGER_FLOOR ? 0 : Math.min(1, v);
      };
      const brake = trigger(BUTTON.brake);
      return {
        steer: dpad !== 0 ? dpad : shapeStick(pad.axes[0] ?? 0),
        throttle: trigger(BUTTON.throttle),
        brake,
        drift: pressed(BUTTON.drift),
        itemPresses: presses,
        horn: horns,
      };
    },
    dispose() {
      // Nothing is listening: the pad is read when asked.
    },
  };
}
