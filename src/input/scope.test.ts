import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FaceFrame, FaceReading, HandFrame, HandSource } from "../tracking/types";
import { HandInput } from "./handInput";
import { boxMapping } from "./homography";
import { MouseInput, RELOAD_MOMENT, TouchInput } from "./pointer";
import { EYE_SCOPE, EyeScope, ScopeControl, scopeKeys, scopeMouse, type EyeProfile } from "./scope";
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

/** An eye that has had a moment to see its player's open face. */
function ready(profile: EyeProfile | null = null, face: FaceReading = open): { eye: EyeScope; t: number } {
  const eye = new EyeScope(EYE_SCOPE, profile);
  return { eye, t: hold(eye, face, 0, 600) };
}

describe("closing one eye to scope", () => {
  it("scopes once one eye has stayed shut for a quarter of a second, either eye", () => {
    for (const shut of [wink, { blinkLeft: 0.1, blinkRight: 0.7 }]) {
      const { eye, t: start } = ready();
      let t = start;
      eye.read(shut, t);
      const closed = t;
      expect(eye.active(t)).toBe(false);
      while (t - closed < EYE_SCOPE.hold) {
        t += EVERY;
        eye.read(shut, t);
        if (t - closed < EYE_SCOPE.hold - EVERY) expect(eye.active(t)).toBe(false);
      }
      t = hold(eye, shut, t, EVERY);
      expect(eye.active(t)).toBe(true);
    }
  });

  it("never scopes for a blink, however hard or slow", () => {
    const { eye, t: start } = ready();
    let t = start;
    for (let i = 0; i < 20; i++) {
      // A blink: both eyes shut for a tenth to nearly half a second, every so often.
      t = hold(eye, blink, t, 100 + (i % 5) * 80);
      expect(eye.active(t)).toBe(false);
      t = hold(eye, open, t, 400);
    }
  });

  it("scopes for both eyes squeezed shut only after a long hold, and never for a look down", () => {
    const { eye, t: start } = ready();
    let t = hold(eye, blink, start, EYE_SCOPE.holdBoth - 2 * EVERY);
    expect(eye.active(t)).toBe(false);
    t = hold(eye, blink, t, 3 * EVERY);
    expect(eye.active(t)).toBe(true);
    // Looking down at the lower screen raises both eyes, and it stays raised: not a squeeze.
    const down = ready();
    const t2 = hold(down.eye, { blinkLeft: 0.46, blinkRight: 0.44 }, down.t, 5000);
    expect(down.eye.active(t2)).toBe(false);
  });

  it("starts the hold again when the eye opens past the threshold on the way", () => {
    const { eye, t: start } = ready();
    let t = hold(eye, wink, start, 200);
    t = hold(eye, { blinkLeft: 0.15, blinkRight: 0.1 }, t, EVERY);
    t = hold(eye, wink, t, 200);
    expect(eye.active(t)).toBe(false);
    t = hold(eye, wink, t, 150);
    expect(eye.active(t)).toBe(true);
  });

  it("stays scoped as the eye eases open a little, and lets go once it has been open for a moment", () => {
    const { eye, t: start } = ready();
    let t = hold(eye, wink, start, 400);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, { blinkLeft: 0.42, blinkRight: 0.2 }, t, 600);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, { blinkLeft: 0.3, blinkRight: 0.2 }, t, 300);
    expect(eye.active(t)).toBe(true);
    // One reading that falls open is noise; the eye staying open is not.
    eye.read(open, t);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, wink, t + EVERY, 200);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, open, t, EYE_SCOPE.release + 2 * EVERY);
    expect(eye.active(t)).toBe(false);
  });

  it("lets go when the readings stop coming", () => {
    const { eye, t: start } = ready();
    const t = hold(eye, wink, start, 400);
    expect(eye.active(t)).toBe(true);
    expect(eye.active(t + EYE_SCOPE.stale + 1)).toBe(false);
  });
});

describe("the hand across the face", () => {
  it("keeps the scope while the face is missing, however long it takes to aim", () => {
    const { eye, t: start } = ready();
    let t = hold(eye, wink, start, 400);
    expect(eye.active(t)).toBe(true);
    // The finger pistol is raised across the face: the landmarker finds none, for seconds.
    t = hold(eye, null, t, 6000);
    expect(eye.active(t)).toBe(true);
    expect(eye.view(t).held).toBe(true);
    expect(eye.view(t).seen).toBe(false);
  });

  it("lets go the moment the face is seen again with the eye open", () => {
    const { eye, t: start } = ready();
    let t = hold(eye, wink, start, 400);
    t = hold(eye, null, t, 3000);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, open, t, EYE_SCOPE.release + 2 * EVERY);
    expect(eye.active(t)).toBe(false);
    // ... but a face that comes back with the eye still shut keeps it.
    const again = ready();
    let u = hold(again.eye, wink, again.t, 400);
    u = hold(again.eye, null, u, 2000);
    u = hold(again.eye, wink, u, 600);
    expect(again.eye.active(u)).toBe(true);
  });

  it("lets go in the end if the face never comes back", () => {
    const { eye, t: start } = ready();
    let t = hold(eye, wink, start, 400);
    t = hold(eye, null, t, EYE_SCOPE.occlusion - 500);
    expect(eye.active(t)).toBe(true);
    t = hold(eye, null, t, 1500);
    expect(eye.active(t)).toBe(false);
  });

  it("does not scope on a face it cannot see, but waits a moment for one lost while an eye closes", () => {
    const { eye, t: start } = ready();
    // Nothing seen, however long: nothing to scope.
    const t = hold(eye, null, start, 3000);
    expect(eye.active(t)).toBe(false);
    // The face flickers away for a frame or two in the middle of a wink: the hold goes on.
    const flicker = ready();
    let u = hold(flicker.eye, wink, flicker.t, 100);
    u = hold(flicker.eye, null, u, 2 * EVERY);
    u = hold(flicker.eye, wink, u, 2 * EVERY);
    expect(flicker.eye.active(u)).toBe(true);
    // ... and a face lost for longer starts the hold afresh.
    const lost = ready();
    let v = hold(lost.eye, wink, lost.t, 120);
    v = hold(lost.eye, null, v, 600);
    v = hold(lost.eye, wink, v, 120);
    expect(lost.eye.active(v)).toBe(false);
  });
});

describe("every player's own eyes", () => {
  it("scopes on a wink that reads low, which a fixed 0.55 never would", () => {
    const { eye, t: start } = ready();
    const t = hold(eye, { blinkLeft: 0.46, blinkRight: 0.12 }, start, 500);
    expect(eye.active(t)).toBe(true);
  });

  it("does not scope on a squint or a half-closed eye", () => {
    const { eye, t: start } = ready();
    const t = hold(eye, { blinkLeft: 0.27, blinkRight: 0.08 }, start, 3000);
    expect(eye.active(t)).toBe(false);
  });

  it("does not scope on what both eyes do together - a squint, a look down, a laugh - or on an eye only a little ahead of the other", () => {
    for (const natural of [
      { blinkLeft: 0.42, blinkRight: 0.4 }, // a squint
      { blinkLeft: 0.5, blinkRight: 0.46 }, // a look down
      { blinkLeft: 0.6, blinkRight: 0.56 }, // a laugh
      { blinkLeft: 0.53, blinkRight: 0.33 }, // a look down with the head turned a little: one eye ahead by 0.2
    ]) {
      const { eye, t: start } = ready();
      expect(eye.active(hold(eye, natural, start, 6000))).toBe(false);
    }
  });

  it("asks a player whose open eyes read high for no less than one whose read low", () => {
    // Narrow eyes: open reads 0.25. An eye that rises by 0.22 (the head turned) is not a wink, as on any face...
    const { eye, t: start } = ready(null, { blinkLeft: 0.25, blinkRight: 0.28 });
    let t = hold(eye, { blinkLeft: 0.47, blinkRight: 0.28 }, start, 3000);
    expect(eye.active(t)).toBe(false);
    // ... and a wink is.
    t = hold(eye, { blinkLeft: 0.8, blinkRight: 0.3 }, t, 500);
    expect(eye.active(t)).toBe(true);
  });

  it("finds the open level of a player whose open eyes read high, and scopes on a rise above that", () => {
    // Glasses, or narrow eyes: open reads 0.35.
    const { eye, t: start } = ready(null, { blinkLeft: 0.35, blinkRight: 0.33 });
    let t = hold(eye, { blinkLeft: 0.37, blinkRight: 0.34 }, start, 4000);
    expect(eye.active(t)).toBe(false);
    t = hold(eye, { blinkLeft: 0.9, blinkRight: 0.4 }, t, 500);
    expect(eye.active(t)).toBe(true);
    // Open again: the open level is still theirs, and the scope lets go.
    t = hold(eye, { blinkLeft: 0.36, blinkRight: 0.34 }, t, 400);
    expect(eye.active(t)).toBe(false);
  });

  it("follows an open level that drifts (the light changes) without scoping", () => {
    const { eye, t: start } = ready();
    let t = start;
    for (let level = 0.06; level <= 0.3; level += 0.01) t = hold(eye, { blinkLeft: level, blinkRight: level + 0.02 }, t, 1200);
    expect(eye.active(t)).toBe(false);
    // And at the new level, a wink still scopes.
    t = hold(eye, { blinkLeft: 0.86, blinkRight: 0.33 }, t, 500);
    expect(eye.active(t)).toBe(true);
  });

  it("learns how far this player's eye shuts from a scope held, and keeps it for next time", () => {
    const { eye, t: start } = ready();
    const learned: EyeProfile[] = [];
    eye.onLearn = (profile) => learned.push(profile);
    // A short scope teaches nothing.
    let t = hold(eye, { blinkLeft: 0.5, blinkRight: 0.1 }, start, 450);
    t = hold(eye, open, t, 400);
    expect(learned).toHaveLength(0);
    // A held one does.
    t = hold(eye, { blinkLeft: 0.52, blinkRight: 0.1 }, t, 2000);
    t = hold(eye, open, t, 400);
    expect(learned).toHaveLength(1);
    expect(learned[0]!.closed).toBeGreaterThan(0.5);
    expect(learned[0]!.closed).toBeLessThan(0.6);
    expect(learned[0]!.open).toBeLessThan(0.15);
    expect(eye.profile).toEqual(learned[0]);
  });

  it("starts from a kept profile: a weak wink scopes only because the player's eye is known", () => {
    const weak: FaceReading = { blinkLeft: 0.3, blinkRight: 0.07 };
    const stranger = ready();
    expect(stranger.eye.active(hold(stranger.eye, weak, stranger.t, 1500))).toBe(false);
    const known = ready({ open: 0.06, closed: 0.34 });
    expect(known.eye.active(hold(known.eye, weak, known.t, 600))).toBe(true);
  });
});

describe("what the eye shows the player", () => {
  it("says whether a face is seen, how near the eye is to scoping, and when it is held on faith", () => {
    const eye = new EyeScope();
    expect(eye.view(0)).toMatchObject({ seen: false, closing: 0, scoped: false, held: false });
    let t = hold(eye, open, 0, 500);
    expect(eye.view(t)).toMatchObject({ seen: true, scoped: false });
    expect(eye.view(t).closing).toBeLessThan(0.2);
    // Halfway shut: part of the way there.
    t = hold(eye, { blinkLeft: 0.22, blinkRight: 0.08 }, t, 100);
    const half = eye.view(t).closing;
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.9);
    t = hold(eye, wink, t, 500);
    expect(eye.view(t)).toMatchObject({ seen: true, scoped: true, closing: 1, held: false });
    expect(eye.view(t).left).toBeCloseTo(0.82);
    expect(eye.view(t).threshold).toBeGreaterThan(0.2);
    expect(eye.view(t).threshold).toBeLessThan(0.55);
    // The face is lost: scoped still, held, and no longer seen.
    t = hold(eye, null, t, 1000);
    expect(eye.view(t)).toMatchObject({ seen: false, scoped: true, held: true });
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
    const { eye, t: start } = ready();
    const scope = new ScopeControl("hold", eye);
    const t = hold(eye, wink, start, 400);
    expect(scope.active(t)).toBe(true);
    expect(scope.eyeView(t)?.scoped).toBe(true);
    scope.useEye = false;
    expect(scope.active(t)).toBe(false);
    expect(scope.eyeView(t)).toBeNull();
    scope.press("mouse");
    expect(scope.active(t)).toBe(true);
  });

  it("lets everything go on a reset (a pause): nothing held comes back by itself", () => {
    const { eye, t: start } = ready();
    const scope = new ScopeControl("toggle", eye);
    let changes = 0;
    scope.onChange = () => changes++;
    scope.press("key");
    const t = hold(eye, wink, start, 400);
    scope.reset();
    expect(scope.active(t)).toBe(false);
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
    frame(at: number, eyes: FaceReading | null | undefined, hand = true) {
      const frame: HandFrame = { landmarks: hand ? asCameraSees(makeHand({ thumbDegrees: 20 })) : null, handedness: hand ? "Right" : null, capturedAt: at, sequence: at };
      for (const l of this.hands) l(frame);
      if (eyes !== undefined) for (const l of this.faces) l({ eyes, capturedAt: at });
    }
  }

  function player() {
    const camera = new Camera();
    const scope = new ScopeControl("hold", new EyeScope());
    const input = new HandInput(camera, () => ({ width: 1440, height: 900 }), boxMapping([0.2, 0.2], [0.8, 0.8]), scope);
    let t = 0;
    // A 30 fps camera, the face read on every other frame.
    const run = (eyes: FaceReading | null, ms: number, hand = true) => {
      for (const end = t + ms; t < end; t += 1000 / 30) camera.frame(t, Math.round(t / (1000 / 30)) % 2 === 0 ? eyes : undefined, hand);
    };
    return { input, scope, run, now: () => t };
  }

  it("scopes on the eye read from the same camera frames, and lets it go when the eye opens", () => {
    const { input, run, now } = player();
    run(open, 300);
    expect(input.sample(now()).scope).toBe(false);
    run(wink, 400);
    expect(input.sample(now()).scope).toBe(true);
    run(open, 300);
    expect(input.sample(now()).scope).toBe(false);
    input.dispose();
  });

  it("keeps the scope while the hand hides the face, and lets go when the face is open again", () => {
    const { input, run, now } = player();
    run(open, 300);
    run(wink, 400);
    expect(input.sample(now()).scope).toBe(true);
    // The pistol across the face: the camera sees the hand, the landmarker no face.
    run(null, 3000);
    expect(input.sample(now()).scope).toBe(true);
    run(open, 300);
    expect(input.sample(now()).scope).toBe(false);
    input.dispose();
  });

  it("scopes with Shift or the right button with the hand, tracked or not", () => {
    const { input, scope, run, now } = player();
    const stage = new FakeElement();
    const window_ = window as unknown as EventTarget;
    const stopKeys = scopeKeys(scope, window as unknown as Window);
    const stopMouse = scopeMouse(scope, stage as unknown as HTMLElement, window as unknown as Window);
    run(open, 300);
    expect(input.sample(now()).scope).toBe(false);
    // Shift, with the hand in view.
    window_.dispatchEvent(event("keydown", { key: "Shift", repeat: false }));
    expect(input.sample(now()).scope).toBe(true);
    window_.dispatchEvent(event("keyup", { key: "Shift" }));
    expect(input.sample(now()).scope).toBe(false);
    // The right button, with the hand lost: the aim is not tracked, the scope is still asked for.
    run(open, 600, false);
    const down = event("pointerdown", { pointerType: "mouse", buttons: 2, target: stage });
    stage.dispatchEvent(down);
    expect(input.sample(now()).scope).toBe(true);
    expect(input.sample(now()).tracking).toBe(false);
    // A left click on its own is not the scope; the right button coming up lets go.
    window_.dispatchEvent(event("pointerup", { pointerType: "mouse", buttons: 0, target: stage }));
    expect(input.sample(now()).scope).toBe(false);
    // The browser's menu stays shut on the stage.
    const menu = event("contextmenu", { target: stage });
    stage.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    stopKeys();
    stopMouse();
    input.dispose();
  });

  it("ignores the right button on the page's own controls, and a touch", () => {
    const { scope } = player();
    const stage = new FakeElement();
    const control = new FakeElement();
    control.closest = () => control as unknown as Element;
    Object.assign(globalThis, { Element: FakeElement });
    const stop = scopeMouse(scope, stage as unknown as HTMLElement, window as unknown as Window);
    stage.dispatchEvent(event("pointerdown", { pointerType: "mouse", buttons: 2, target: control }));
    expect(scope.buttons).toBe(false);
    stage.dispatchEvent(event("pointerdown", { pointerType: "touch", buttons: 2, target: stage }));
    expect(scope.buttons).toBe(false);
    stop();
  });
});
