/**
 * The Test Range's entry: shown in the arcade of a dev or test build with
 * ?range=1 (src/app/testHooks.ts), never in production. ?weapon=cylinder,
 * magazine (the default) or heat picks the gun the HUD shows.
 */
import type { Game, GameEntry } from "../../engine/types";
import type { RangeWeapon } from "./game";

export const TEST_RANGE: GameEntry = {
  id: "test-range",
  title: "Test Range",
  blurb: "Targets, a clock and a scope: the platform, tested.",
  about: "Nine targets and a minute. Close one eye, hold Shift or the right mouse button to look through the scope.",
  poster: "assets/range/poster.webp",
  backdrop: {
    sky: [
      ["#10141c", 0],
      ["#1d2430", 0.55],
      ["#2a2f38", 1],
    ],
    glow: { x: 0.5, y: 0.55, width: 0.6, height: 0.5, stops: [["rgba(242, 239, 232, 0.25)", 0], ["rgba(242, 239, 232, 0)", 1]] },
  },
  uses: { scope: true, eye: true },
  stage: { minAspect: 1.25, maxAspect: 2.2 },
  async create(): Promise<Game> {
    const { TestRange } = await import("./game");
    const weapon = new URLSearchParams(location.search).get("weapon");
    return new TestRange(weapon === "cylinder" || weapon === "heat" || weapon === "magazine" ? { weapon: weapon as RangeWeapon } : {});
  },
};
