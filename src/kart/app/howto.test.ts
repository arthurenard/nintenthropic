import { describe, expect, it } from "vitest";
import { IDLE_INPUT, type ControlKind, type WheelStatus } from "../contract";
import { heldMoves, howToDrive } from "./howto";

const wheel = (over: Partial<WheelStatus>): WheelStatus => ({
  hands: 2,
  left: null,
  right: null,
  angle: 0,
  steer: 0,
  grip: "fists",
  mode: "drive",
  levelled: true,
  ...over,
});

describe("how to drive", () => {
  it("has the same six moves, in the same order, for hands, keys and pads", () => {
    for (const kind of ["wheel", "keyboard", "gamepad"] as ControlKind[]) {
      const how = howToDrive(kind);
      expect(how.moves.map((move) => move.id)).toEqual(["steer", "go", "brake", "drift", "item", "honk"]);
      expect(how.title).toBe("How to Drive");
      // Every card shows something: an icon for hands, caps for keys and pads.
      for (const move of how.moves) expect(kind === "wheel" ? move.icon : move.keys?.length).toBeTruthy();
    }
  });

  it("speaks the voice: Title Case titles, short sentence lines", () => {
    for (const kind of ["wheel", "keyboard", "gamepad"] as ControlKind[]) {
      for (const move of howToDrive(kind).moves) {
        for (const word of move.title.split(" ")) if (!["and", "an", "to"].includes(word)) expect(word[0]).toBe(word[0]!.toUpperCase());
        expect(move.line.length).toBeLessThanOrEqual(64);
        expect(move.line.endsWith(".")).toBe(true);
      }
    }
  });

  it("lights the hands' moves from the wheel: fists go, open hands brake, or drift when turned", () => {
    expect([...heldMoves("wheel", IDLE_INPUT, wheel({}))]).toEqual(["go"]);
    expect([...heldMoves("wheel", IDLE_INPUT, wheel({ steer: 0.6 }))].sort()).toEqual(["go", "steer"]);
    expect([...heldMoves("wheel", IDLE_INPUT, wheel({ mode: "brake", grip: "open" }))]).toEqual(["brake"]);
    expect([...heldMoves("wheel", IDLE_INPUT, wheel({ mode: "brake", grip: "open", steer: -0.5 }))].sort()).toEqual(["drift", "steer"]);
    // A hand out of view lights nothing.
    expect(heldMoves("wheel", IDLE_INPUT, wheel({ hands: 1 })).size).toBe(0);
    expect(heldMoves("wheel", IDLE_INPUT, null).size).toBe(0);
  });

  it("lights the keys' and pads' moves from the input", () => {
    expect(heldMoves("keyboard", IDLE_INPUT, null).size).toBe(0);
    expect([...heldMoves("keyboard", { ...IDLE_INPUT, steer: -1, throttle: 1 }, null)].sort()).toEqual(["go", "steer"]);
    expect([...heldMoves("gamepad", { ...IDLE_INPUT, brake: 0.4, drift: true }, null)].sort()).toEqual(["brake", "drift"]);
  });
});
