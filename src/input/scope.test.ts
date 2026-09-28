import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FaceFrame, FaceReading, HandFrame, HandSource } from "../tracking/types";
import { HandInput } from "./handInput";
import { boxMapping } from "./homography";
import { MouseInput, RELOAD_MOMENT, TouchInput } from "./pointer";
import { EYE_SCOPE, EyeScope, ScopeControl, scopeKeys } from "./scope";
import { asCameraSees, makeHand } from "./synthetic";

/** Fifteen face readings a second: every other frame of a 30 fps camera. */
const EVERY = 1000 / 15;
const open: FaceReading = { blinkLeft: 0.06, blinkRight: 0.08 };
const wink: FaceReading = { blinkLeft: 0.82, blinkRight: 0.21 };
const blink: FaceReading = { blinkLeft: 0.93, blinkRight: 0.91 };

/** Reads `face` for `ms` from `from`, a reading every EVERY ms; returns when it ended. */
function hold(eye: EyeScope, face: FaceReading | null, from: number, ms: number): number {
  let t = from;
  for (; t < from + ms; t += EVERY) eye.read(face, t);
  return t;
}

describe("closing one eye to scope", () => {
  it("scopes once one eye has stayed shut for 180 ms, either eye", () => {
    for (const shut of [wink, { blinkLeft: 0.1, blinkRight: 0.7 }]) {
      const eye = new EyeScope();
      let t = hold(eye, open, 0, 500);
      eye.read(shut, t);
      const closed = t;
      expect(eye.active(t)).toBe(false);
      while (t - closed < EYE_SCOPE.hold) {
        t += EVERY;
        eye.read(shut, t);
        if (t - closed < EYE_SCOPE.hold) expect(eye.active(t)).toBe(false);
      }
      expect(eye.active(t)).toBe(true);
    }
  });

  it("never scopes for a blink, however hard", () => {
    const eye = new EyeScope();
    let t = hold(eye, open, 0, 300);
    for (let i = 0; i < 20; i++) {
      // A blink: both eyes shut for a tenth to a seventh of a second, every so often.
      t = hold(eye, blink, t, 100 + (i % 3) * 25);
      expect(eye.active(t)).toBe(false);
      t = hold(eye, open, t, 400);
    }
  });

  it("starts the hold again when the eye opens past the threshold on the way", () => {
    const eye = new EyeScope();
    let t = hold(eye, wink, 0, 140);
    t = hold(eye, { blinkLeft: 0.5, blinkRight: 0.2 }, t, EVERY);
    t = hold(eye, wink, t, 140);
    expect(eye.active(t)).toBe(false);
    t = hold(eye, wink, t, 100);
    expect(eye.active(t)).toBe(true);
  });

  it("stays scoped as the eye eases open a little, and lets go below 0.30", () => {
    const eye = new EyeScope();
    let t = hold(eye, wink, 0, 400);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, { blinkLeft: 0.42, blinkRight: 0.2 }, t, 600);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, { blinkLeft: 0.33, blinkRight: 0.2 }, t, 300);
    expect(eye.active(t)).toBe(true);
    eye.read({ blinkLeft: 0.28, blinkRight: 0.2 }, t);
    expect(eye.active(t)).toBe(false);
  });

  it("waits 200 ms for a face it lost, then lets the scope go", () => {
    const eye = new EyeScope();
    let t = hold(eye, wink, 0, 400);
    // A moment without a face (a turn of the head): still scoped.
    t = hold(eye, null, t, 150);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, wink, t, 100);
    expect(eye.active(t)).toBe(true);
    // Gone for longer: no longer.
    t = hold(eye, null, t, 300);
    expect(eye.active(t)).toBe(false);
    // And a face back with the eye still shut must hold for 180 ms again.
    eye.read(wink, t);
    expect(eye.active(t)).toBe(false);
  });

  it("lets go when the readings stop coming", () => {
    const eye = new EyeScope();
    const t = hold(eye, wink, 0, 400);
    expect(eye.active(t)).toBe(true);
    expect(eye.active(t + EYE_SCOPE.stale + 1)).toBe(false);
  });
});

describe("the scope's buttons", () => {
  it("held: scoping while any is down", () => {
    const scope = new ScopeControl("hold");
    expect(scope.active(0)).toBe(false);
    scope.press("key");
    scope.press("mouse");
    scope.release("key");
    expect(scope.active(0)).toBe(true);
    scope.release("mouse");
    expect(scope.active(0)).toBe(false);
  });

  it("toggled: each press turns it on or off, and a key's repeat is not a press", () => {
    const scope = new ScopeControl("toggle");
    scope.press("key");
    scope.release("key");
    expect(scope.active(0)).toBe(true);
    scope.press("key");
    scope.press("key");
    scope.release("key");
    expect(scope.active(0)).toBe(false);
    scope.press("touch");
    scope.release("touch");
    expect(scope.active(0)).toBe(true);
  });

  it("with the eye, either scopes; without Close One Eye, only the buttons do", () => {
    const eye = new EyeScope();
    const scope = new ScopeControl("hold", eye);
    const t = hold(eye, wink, 0, 400);
    expect(scope.active(t)).toBe(true);
    scope.useEye = false;
    expect(scope.active(t)).toBe(false);
    scope.press("mouse");
    expect(scope.active(t)).toBe(true);
  });

  it("lets everything go on a reset (a pause): nothing held comes back by itself", () => {
    const eye = new EyeScope();
    const scope = new ScopeControl("toggle", eye);
    let changes = 0;
    scope.onChange = () => changes++;
    scope.press("key");
    hold(eye, wink, 0, 400);
    scope.reset();
    expect(scope.active(400)).toBe(false);
    expect(changes).toBe(2);
  });
});

// --- the inputs, with just enough of a page to run them -------------------------------------

class FakeElement extends EventTarget {
  closest(): Element | null {
    return null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1000, height: 500 } as DOMRect;
  }
}

/** A page event with the fields the inputs read. */
function event(type: string, fields: Record<string, unknown>): Event {
  const e = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(e, key, { value });
  return e;
}

const saved: Record<string, unknown> = {};
beforeEach(() => {
  for (const name of ["window", "Element"]) saved[name] = (globalThis as Record<string, unknown>)[name];
  Object.assign(globalThis, { window: new EventTarget(), Element: FakeElement });
});
afterEach(() => Object.assign(globalThis, saved));

function mouse(scope: ScopeControl | null) {
  const stage = new FakeElement();
  const input = new MouseInput(stage as unknown as HTMLElement, scope);
  const press = (buttons: number, x = 500, y = 250, t = 0) => {
    const target = stage;
    stage.dispatchEvent(event("pointermove", { pointerType: "mouse", buttons, clientX: x, clientY: y, timeStamp: t, target }));
  };
  const down = (buttons: number, t = 0) => stage.dispatchEvent(event("pointerdown", { pointerType: "mouse", buttons, clientX: 500, clientY: 250, timeStamp: t, target: stage }));
  const up = (buttons: number) => (window as unknown as EventTarget).dispatchEvent(event("pointerup", { pointerType: "mouse", buttons, target: stage }));
  return { input, press, down, up };
}

describe("the mouse in a game with a scope", () => {
  it("scopes with the right button held, instead of reloading", () => {
    const scope = new ScopeControl("hold");
    const { input, down, up } = mouse(scope);
    down(2, 10);
    let aim = input.sample(20);
    expect(aim.scope).toBe(true);
    expect(aim.offscreen).toBe(false);
    up(0);
    aim = input.sample(30);
    expect(aim.scope).toBe(false);
  });

  it("fires with the left button while the right is held (a chord comes as a move)", () => {
    const scope = new ScopeControl("hold");
    const { input, down, press, up } = mouse(scope);
    down(2);
    press(3, 600, 300);
    const aim = input.sample(10);
    expect(aim.fired).toBe(true);
    expect(aim.scope).toBe(true);
    expect(aim.x).toBeCloseTo(0.6);
    press(2);
    up(0);
    expect(input.sample(20).scope).toBe(false);
  });

  it("still reloads with the right button in a game without one", () => {
    const { input, down, up } = mouse(null);
    down(2, 100);
    up(0);
    const aim = input.sample(100 + RELOAD_MOMENT / 2);
    expect(aim.offscreen).toBe(true);
    expect(aim.scope).toBe(false);
    expect(input.sample(100 + RELOAD_MOMENT + 1).offscreen).toBe(false);
  });

  it("scopes with Shift, held or toggled", () => {
    const scope = new ScopeControl("hold");
    const { input } = mouse(scope);
    const stop = scopeKeys(scope, window as unknown as Window);
    const key = (type: string, repeat = false) => (window as unknown as EventTarget).dispatchEvent(event(type, { key: "Shift", repeat }));
    key("keydown");
    key("keydown", true);
    expect(input.sample(0).scope).toBe(true);
    key("keyup");
    expect(input.sample(0).scope).toBe(false);
    scope.mode = "toggle";
    key("keydown");
    key("keyup");
    expect(input.sample(0).scope).toBe(true);
    // A window that loses focus never hears the key come up: it is let go.
    scope.mode = "hold";
    scope.reset();
    key("keydown");
    (window as unknown as EventTarget).dispatchEvent(new Event("blur"));
    expect(input.sample(0).scope).toBe(false);
    stop();
    key("keydown");
    expect(input.sample(0).scope).toBe(false);
  });

  it("lets the scope go over a pause", () => {
    const scope = new ScopeControl("toggle");
    const { input, down, up } = mouse(scope);
    down(2);
    up(0);
    expect(input.sample(0).scope).toBe(true);
    input.reset();
    expect(input.sample(0).scope).toBe(false);
  });
});

describe("the touch screen's Scope button", () => {
  it("is not a second finger: a tap on the stage while a thumb holds Scope fires", () => {
    const scope = new ScopeControl("hold");
    const stage = new FakeElement();
    const input = new TouchInput(stage as unknown as HTMLElement, scope);
    const button = new FakeElement();
    button.closest = () => button as unknown as Element;
    const thumb = { target: button, clientX: 30, clientY: 470 };
    const finger = { target: stage, clientX: 700, clientY: 200 };
    scope.press("touch");
    stage.dispatchEvent(event("touchstart", { target: stage, touches: [thumb, finger], changedTouches: [finger], timeStamp: 5 }));
    const aim = input.sample(10);
    expect(aim.fired).toBe(true);
    expect(aim.offscreen).toBe(false);
    expect(aim.scope).toBe(true);
    expect(aim.x).toBeCloseTo(0.7);
  });
});

describe("the hand in a game that reads the eye", () => {
  class Camera implements HandSource {
    private readonly hands = new Set<(frame: HandFrame) => void>();
    private readonly faces = new Set<(face: FaceFrame) => void>();
    subscribe(listener: (frame: HandFrame) => void) {
      this.hands.add(listener);
      return () => this.hands.delete(listener);
    }
    subscribeFace(listener: (face: FaceFrame) => void) {
      this.faces.add(listener);
      return () => this.faces.delete(listener);
    }
    latest() {
      return null;
    }
    frame(at: number, eyes: FaceReading | null | undefined) {
      const hand: HandFrame = { landmarks: asCameraSees(makeHand({ thumbDegrees: 20 })), handedness: "Right", capturedAt: at, sequence: at };
      for (const l of this.hands) l(hand);
      if (eyes !== undefined) for (const l of this.faces) l({ eyes, capturedAt: at });
    }
  }

  it("scopes on the eye read from the same camera frames, and lets it go when the eye opens", () => {
    const camera = new Camera();
    const scope = new ScopeControl("hold", new EyeScope());
    const input = new HandInput(camera, () => ({ width: 1440, height: 900 }), boxMapping([0.2, 0.2], [0.8, 0.8]), scope);
    let t = 0;
    // A 30 fps camera, the face read on every other frame.
    const run = (eyes: FaceReading, ms: number) => {
      for (const end = t + ms; t < end; t += 1000 / 30) camera.frame(t, (Math.round(t / (1000 / 30)) % 2 === 0 ? eyes : undefined));
    };
    run(open, 300);
    expect(input.sample(t).scope).toBe(false);
    run(wink, 300);
    expect(input.sample(t).scope).toBe(true);
    run(open, 100);
    expect(input.sample(t).scope).toBe(false);
    input.dispose();
  });
});
