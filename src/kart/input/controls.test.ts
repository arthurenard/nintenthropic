import { describe, expect, it } from "vitest";
import type { HandFrame, HandSource } from "../../tracking/types";
import { wheelControl } from "./control";
import { gamepadControl, shapeStick } from "./gamepad";
import { keyboardControl } from "./keyboard";
import { MODE_COLOURS, fitPicture, wheelRing } from "./preview";
import { handFrame, wheelHands, type WheelPose } from "./testHands";

// ─── Keyboard ───────────────────────────────────────────────────────────────

describe("keyboardControl", () => {
  function keys() {
    const target = new EventTarget();
    const control = keyboardControl(target);
    const fire = (type: "keydown" | "keyup", code: string, extra: object = {}) => {
      const event = Object.assign(new Event(type, { cancelable: true }), { code }, extra);
      target.dispatchEvent(event);
      return event;
    };
    let now = 1000;
    /** Samples every 1/60 s for `seconds`, returning the last input. */
    const run = (seconds: number) => {
      let input = control.sample(now);
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) input = control.sample((now += 1000 / 60));
      return input;
    };
    control.sample(now);
    return { target, control, down: (code: string) => fire("keydown", code), up: (code: string) => fire("keyup", code), run, fire };
  }

  it("is a keyboard control with no wheel", () => {
    const { control } = keys();
    expect(control.kind).toBe("keyboard");
    expect(control.wheel).toBeNull();
  });

  it("does nothing until a key is pressed", () => {
    expect(keys().run(0.5)).toEqual({ steer: 0, throttle: 0, brake: 0, drift: false, itemPresses: 0 });
  });

  it("steers with the arrows and with A and D", () => {
    for (const [left, right] of [
      ["ArrowLeft", "ArrowRight"],
      ["KeyA", "KeyD"],
    ] as const) {
      const k = keys();
      k.down(right);
      expect(k.run(1).steer).toBe(1);
      k.up(right);
      expect(k.run(1).steer).toBe(0);
      k.down(left);
      expect(k.run(1).steer).toBe(-1);
    }
  });

  it("eases the steering rather than snapping to full lock", () => {
    const k = keys();
    k.down("ArrowRight");
    const first = k.run(1 / 60).steer;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.15);
    const tenth = k.run(0.1).steer;
    expect(tenth).toBeGreaterThan(0.2);
    expect(tenth).toBeLessThan(0.6);
    expect(k.run(0.5).steer).toBe(1);
  });

  it("comes back to the centre faster than it turned, and turns through to the other side", () => {
    const k = keys();
    k.down("ArrowRight");
    k.run(1);
    k.up("ArrowRight");
    expect(k.run(0.1).steer).toBeLessThan(0.5);
    expect(k.run(0.3).steer).toBe(0);
    k.down("ArrowLeft");
    expect(k.run(0.1).steer).toBeLessThan(0);
  });

  it("holds the centre with both steering keys down", () => {
    const k = keys();
    k.down("ArrowLeft");
    k.down("ArrowRight");
    expect(k.run(0.5).steer).toBe(0);
  });

  it("gives the throttle with Up or W, and the brake with Down or S (the brake wins)", () => {
    const k = keys();
    k.down("ArrowUp");
    expect(k.run(0.1)).toMatchObject({ throttle: 1, brake: 0 });
    k.up("ArrowUp");
    k.down("KeyW");
    expect(k.run(0.1)).toMatchObject({ throttle: 1, brake: 0 });
    k.down("KeyS");
    expect(k.run(0.1)).toMatchObject({ throttle: 0, brake: 1 });
    k.up("KeyW");
    k.up("KeyS");
    k.down("ArrowDown");
    expect(k.run(0.1)).toMatchObject({ throttle: 0, brake: 1 });
  });

  it("drifts while Space is held", () => {
    const k = keys();
    expect(k.run(0.1).drift).toBe(false);
    k.down("Space");
    expect(k.run(0.1).drift).toBe(true);
    k.up("Space");
    expect(k.run(0.1).drift).toBe(false);
  });

  it("uses an item on each press of E or Shift, not while the key repeats", () => {
    const k = keys();
    k.down("KeyE");
    k.down("KeyE"); // the key repeating
    k.down("KeyE");
    expect(k.run(0.1).itemPresses).toBe(1);
    k.up("KeyE");
    k.down("ShiftLeft");
    expect(k.run(0.1).itemPresses).toBe(2);
    k.up("ShiftLeft");
    k.down("ShiftRight");
    k.up("ShiftRight");
    expect(k.run(0.1).itemPresses).toBe(3);
    // Both at once is one press.
    k.down("KeyE");
    k.down("ShiftLeft");
    expect(k.run(0.1).itemPresses).toBe(4);
  });

  it("keeps the page from scrolling on the arrows and Space, and leaves other keys alone", () => {
    const k = keys();
    expect(k.down("ArrowDown").defaultPrevented).toBe(true);
    expect(k.down("Space").defaultPrevented).toBe(true);
    expect(k.down("KeyW").defaultPrevented).toBe(false);
    expect(k.down("Tab").defaultPrevented).toBe(false);
  });

  it("forgets keys held when the window loses focus", () => {
    const k = keys();
    k.down("ArrowUp");
    k.down("Space");
    k.target.dispatchEvent(new Event("blur"));
    expect(k.run(0.1)).toMatchObject({ throttle: 0, drift: false });
  });

  it("does not take typing in a field for driving", () => {
    const field = Object.assign(new EventTarget(), { tagName: "INPUT" });
    const control = keyboardControl(field);
    field.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { code: "KeyW" }));
    expect(control.sample(0).throttle).toBe(0);
  });

  it("does not jump when sampling pauses (a hidden tab)", () => {
    const k = keys();
    k.down("ArrowRight");
    const input = k.control.sample(1000 + 60_000);
    expect(input.steer).toBeLessThan(0.36);
  });

  it("stops listening when disposed", () => {
    const k = keys();
    k.control.dispose();
    k.down("ArrowUp");
    expect(k.run(0.1).throttle).toBe(0);
  });
});

// ─── Gamepad ────────────────────────────────────────────────────────────────

describe("gamepadControl", () => {
  const button = (value = 0, pressed = value > 0.5) => ({ pressed, touched: pressed, value });
  function pad(over: { axes?: number[]; buttons?: Record<number, number | boolean>; connected?: boolean } = {}): Gamepad {
    const buttons = Array.from({ length: 17 }, () => button());
    for (const [index, value] of Object.entries(over.buttons ?? {})) buttons[Number(index)] = typeof value === "boolean" ? button(value ? 1 : 0, value) : button(value);
    return { connected: over.connected ?? true, axes: over.axes ?? [0, 0, 0, 0], buttons, index: 0, id: "test", mapping: "standard", timestamp: 0 } as unknown as Gamepad;
  }
  const pads = (...list: (Gamepad | null)[]) => () => list;

  it("is a gamepad control with no wheel", () => {
    const control = gamepadControl(undefined, pads());
    expect(control.kind).toBe("gamepad");
    expect(control.wheel).toBeNull();
  });

  it("is idle with no pad, and with a disconnected one", () => {
    const idle = { steer: 0, throttle: 0, brake: 0, drift: false, itemPresses: 0 };
    expect(gamepadControl(undefined, pads()).sample(0)).toEqual(idle);
    expect(gamepadControl(undefined, pads(null, pad({ connected: false }))).sample(0)).toEqual(idle);
  });

  it("steers with the left stick, with a dead zone", () => {
    const steer = (x: number) => gamepadControl(undefined, pads(pad({ axes: [x, 0, 0, 0] }))).sample(0).steer;
    expect(steer(0)).toBe(0);
    expect(steer(0.1)).toBe(0);
    expect(steer(-0.14)).toBe(0);
    expect(steer(0.5)).toBeGreaterThan(0);
    expect(steer(0.5)).toBeLessThan(0.5);
    expect(steer(1)).toBe(1);
    expect(steer(-1)).toBe(-1);
    expect(steer(-0.6)).toBe(-steer(0.6));
  });

  it("shapes the stick smoothly from the dead zone to full", () => {
    let last = 0;
    for (let x = 0; x <= 1.0001; x += 0.02) {
      const value = shapeStick(x);
      expect(value).toBeGreaterThanOrEqual(last);
      expect(value - last).toBeLessThan(0.08);
      last = value;
    }
  });

  it("steers with the d-pad too", () => {
    expect(gamepadControl(undefined, pads(pad({ buttons: { 15: true } }))).sample(0).steer).toBe(1);
    expect(gamepadControl(undefined, pads(pad({ buttons: { 14: true } }))).sample(0).steer).toBe(-1);
  });

  it("takes the throttle from the right trigger and the brake from the left", () => {
    const input = gamepadControl(undefined, pads(pad({ buttons: { 7: 0.8, 6: 0.3 } }))).sample(0);
    expect(input.throttle).toBeCloseTo(0.8);
    expect(input.brake).toBeCloseTo(0.3);
    const light = gamepadControl(undefined, pads(pad({ buttons: { 7: 0.02 } }))).sample(0);
    expect(light.throttle).toBe(0);
  });

  it("drifts while A is held", () => {
    expect(gamepadControl(undefined, pads(pad({ buttons: { 0: true } }))).sample(0).drift).toBe(true);
    expect(gamepadControl(undefined, pads(pad())).sample(0).drift).toBe(false);
  });

  it("uses an item on each press of B or X, once per press", () => {
    let current = pad();
    const control = gamepadControl(undefined, () => [current]);
    expect(control.sample(0).itemPresses).toBe(0);
    current = pad({ buttons: { 1: true } });
    expect(control.sample(1).itemPresses).toBe(1);
    expect(control.sample(2).itemPresses).toBe(1); // still held
    current = pad();
    expect(control.sample(3).itemPresses).toBe(1);
    current = pad({ buttons: { 2: true } });
    expect(control.sample(4).itemPresses).toBe(2);
    current = pad({ buttons: { 1: true, 2: true } }); // both held: not a new press
    expect(control.sample(5).itemPresses).toBe(2);
  });

  it("drives the pad it is asked for, or the first one connected", () => {
    const first = pad({ axes: [1, 0, 0, 0] });
    const second = pad({ axes: [-1, 0, 0, 0] });
    expect(gamepadControl(1, pads(first, second)).sample(0).steer).toBe(-1);
    expect(gamepadControl(undefined, pads(null, first, second)).sample(0).steer).toBe(1);
    expect(gamepadControl(0, pads(null, second)).sample(0).steer).toBe(0);
  });
});

// ─── The wheel as a control ─────────────────────────────────────────────────

describe("wheelControl", () => {
  class Source implements HandSource {
    private readonly listeners = new Set<(frame: HandFrame) => void>();
    newest: HandFrame | null = null;
    subscribe(listener: (frame: HandFrame) => void) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    latest() {
      return this.newest;
    }
    emit(frame: HandFrame) {
      this.newest = frame;
      for (const listener of this.listeners) listener(frame);
    }
    get listening() {
      return this.listeners.size;
    }
  }

  function setup(options: Parameters<typeof wheelControl>[1] = {}) {
    const source = new Source();
    let now = 5000;
    const control = wheelControl(source, { now: () => now, ...options });
    const hold = (seconds: number, pose: WheelPose | null) => {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 30) {
        now += 1000 / 30;
        source.emit(handFrame(pose ? wheelHands(pose) : [], now));
      }
    };
    return { source, control, hold, clock: () => now };
  }

  it("is a wheel control, with the wheel's status", () => {
    const { control, hold } = setup();
    expect(control.kind).toBe("wheel");
    expect(control.wheel.mode).toBe("lost");
    hold(1, { angle: 25 });
    expect(control.wheel).toMatchObject({ hands: 2, mode: "drive", grip: "fists" });
    expect(control.wheel.angle).toBeCloseTo(25, 0);
    const input = control.sample(0);
    expect(input.steer).toBeGreaterThan(0.4);
    expect(input.throttle).toBe(1);
  });

  it("is on its own clock: the `now` it is given for a tick does not matter", () => {
    const { control, hold } = setup();
    hold(1, { angle: 25 });
    expect(control.sample(0).steer).toBeCloseTo(control.sample(123456789).steer, 6);
  });

  it("gives hands that stop arriving a clock to be lost on", () => {
    const { control, hold, source } = setup();
    hold(1, { angle: 25 });
    expect(source.listening).toBe(1);
    hold(1, null);
    expect(control.wheel.mode).toBe("lost");
  });

  it("changes the Steering setting live", () => {
    const { control, hold } = setup();
    hold(1, { angle: 30 });
    const normal = control.sample(0).steer;
    control.steering = "quick";
    expect(control.steering).toBe("quick");
    expect(control.sample(0).steer).toBeGreaterThan(normal);
  });

  it("sets and keeps the level", () => {
    const { control, hold } = setup();
    expect(control.levelled).toBe(false);
    expect(control.setLevel()).toBe(false);
    hold(1, { angle: 8 });
    expect(control.setLevel()).toBe(true);
    expect(control.levelled).toBe(true);
    expect(control.level).toBeCloseTo(8, 0);
    hold(0.5, { angle: 8 });
    expect(control.wheel.angle).toBeCloseTo(0, 0);
    expect(control.wheel.levelled).toBe(true);
    const kept = control.level;
    control.resetLevel();
    expect(control.levelled).toBe(false);
    control.level = kept;
    expect(control.levelled).toBe(true);
  });

  it("levels by itself when held steady, and reports the progress", () => {
    const { control, hold } = setup();
    let done = false;
    control.startAutoLevel(() => (done = true));
    hold(0.5, { angle: 4 });
    expect(control.levelProgress).toBeGreaterThan(0.3);
    hold(1, { angle: 4 });
    expect(done).toBe(true);
    expect(control.levelProgress).toBe(1);
    expect(control.level).toBeCloseTo(4, 0);
  });

  it("takes the picture's shape from a function when it is given one", () => {
    let aspect = 16 / 9;
    const source = new Source();
    let now = 0;
    const control = wheelControl(source, { now: () => now, aspect: () => aspect });
    aspect = 3 / 2;
    for (let i = 0; i < 40; i++) {
      now += 33;
      source.emit(handFrame(wheelHands({ angle: 30, aspect: 3 / 2 }), now, { aspect: 3 / 2 }));
    }
    expect(control.wheel.angle).toBeCloseTo(30, 0);
    expect(control.reader.aspect).toBeCloseTo(3 / 2);
  });

  it("reads the two halves of one camera as two controls", () => {
    const source = new Source();
    let now = 0;
    const one = wheelControl(source, { now: () => now, half: "left" });
    const two = wheelControl(source, { now: () => now, half: "right" });
    for (let i = 0; i < 40; i++) {
      now += 33;
      const hands = [...wheelHands({ angle: 15, centre: [0.25, 0.45], span: 0.3 }), ...wheelHands({ angle: -15, centre: [0.75, 0.45], span: 0.3 })];
      source.emit(handFrame(hands, now));
    }
    expect(one.wheel.angle).toBeCloseTo(15, 0);
    expect(two.wheel.angle).toBeCloseTo(-15, 0);
  });

  it("stops listening when disposed", () => {
    const { control, source } = setup();
    expect(source.listening).toBe(1);
    control.dispose();
    expect(source.listening).toBe(0);
  });
});

// ─── The picture's geometry ─────────────────────────────────────────────────

describe("the preview's geometry", () => {
  it("fits a canvas of the picture's own shape exactly", () => {
    const fit = fitPicture(800, 450, 16 / 9);
    expect(fit.scale).toBeCloseTo(450);
    expect(fit.dest).toEqual({ x: 0, y: 0, width: 800, height: 450 });
    expect(fit.point(0, 0)).toEqual([0, 0]);
    expect(fit.point(1, 1)[0]).toBeCloseTo(800);
    expect(fit.point(0.5, 0.5)).toEqual([400, 225]);
    expect(fit.source(1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("fills a taller canvas by cropping the sides, keeping the middle where it was", () => {
    const fit = fitPicture(400, 450, 16 / 9);
    expect(fit.scale).toBeCloseTo(450);
    expect(fit.dest.x).toBeCloseTo(-200);
    expect(fit.point(0.5, 0.5)[0]).toBeCloseTo(200);
    expect(fit.point(0.5, 0.5)[1]).toBeCloseTo(225);
  });

  it("fills a wider canvas by cropping the top and bottom", () => {
    const fit = fitPicture(800, 300, 16 / 9);
    expect(fit.scale).toBeCloseTo(450);
    expect(fit.dest.y).toBeCloseTo(-75);
    expect(fit.point(0.5, 0.5)[1]).toBeCloseTo(150);
  });

  it("shows a half of the picture for two on one camera: the left half is the left of the mirrored picture", () => {
    const left = fitPicture(400, 450, 16 / 9, "left");
    expect(left.point(0.25, 0.5)[0]).toBeCloseTo(200);
    expect(left.point(0, 0)[0]).toBeCloseTo(0);
    expect(left.point(0.5, 0)[0]).toBeCloseTo(400);
    // The mirrored left half is the camera's right half.
    expect(left.source(1280, 720)).toEqual({ x: 640, y: 0, width: 640, height: 720 });
    const right = fitPicture(400, 450, 16 / 9, "right");
    expect(right.point(0.75, 0.5)[0]).toBeCloseTo(200);
    expect(right.point(0.5, 0)[0]).toBeCloseTo(0);
    expect(right.source(1280, 720)).toEqual({ x: 0, y: 0, width: 640, height: 720 });
  });

  it("puts the ring through both palms, turned with them", () => {
    expect(wheelRing([100, 200], [300, 200])).toEqual({ x: 200, y: 200, radius: 100, turn: 0 });
    const turned = wheelRing([100, 100], [300, 300]);
    expect(turned.x).toBe(200);
    expect(turned.y).toBe(200);
    expect(turned.radius).toBeCloseTo(Math.hypot(200, 200) / 2);
    expect(turned.turn).toBeCloseTo(Math.PI / 4); // the right hand lower: clockwise
    expect(wheelRing([100, 300], [300, 100]).turn).toBeCloseTo(-Math.PI / 4);
  });

  it("colours the modes with Handy's green, amber and red", () => {
    expect(MODE_COLOURS).toEqual({ drive: "#30D158", brake: "#FF9F0A", lost: "#FF453A" });
  });
});
