/**
 * Harbour Lights' second pass: the drawbridge. Its leaf is the road itself (it cannot be drawn to move, a kart is on it),
 * so what moves is everything that tells you where it is in its cycle: two stone gate towers with a footbridge between
 * them, three signal lamps hung over the middle of the road (red while the leaf is down, amber and a bell before it goes
 * up, green while it is raised and the pad ahead launches a kart) and a counterweight on each tower that drops as the leaf
 * rises. All of it keeps the race clock, the sim's own (track/tracks.ts, DRAWBRIDGE: sim/air.ts, `arcLive`).
 */
import { DRAWBRIDGE } from "../../../track/tracks";
import { MeshBuilder, rgb, scaleRgb, type Rgb } from "./kit";
import type { LandmarkSpec, MovingPart } from "./types";

const STONE = rgb("#8d8f9a");
const STONE_D = rgb("#565866");
const IRON = rgb("#2e303a");
const GOLD = rgb("#e0b040");

/** 0 while the leaf is down, 1 while it is up, easing over the eighth of a cycle either side. */
const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
export function leafRaised(race: number): number {
  const u = ((((race / DRAWBRIDGE.period) % 1) + 1) % 1);
  const ease = 0.06;
  return smooth((u - (DRAWBRIDGE.from - ease)) / ease) * (1 - smooth((u - DRAWBRIDGE.to) / ease));
}

/** Where the signals are: "up" (green), "warn" (amber, blinking: the leaf is about to rise) or "down" (red). */
export function bridgeSignal(race: number): "up" | "warn" | "down" {
  const u = ((((race / DRAWBRIDGE.period) % 1) + 1) % 1);
  if (u >= DRAWBRIDGE.from && u < DRAWBRIDGE.to) return "up";
  if (u >= DRAWBRIDGE.from - 0.16 && u < DRAWBRIDGE.from) return "warn";
  return "down";
}

const drawbridge: LandmarkSpec = {
  footprint: 8,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const X = 23;
    const TOP = 22;
    // The two gate towers: a stone shaft in courses, a darker plinth, a parapet and a pitched slate cap, windows that glow.
    for (const s of [-1, 1]) {
      const x = s * X;
      lit.box(x, 1.0, -16, 6.4, 2.0, 6.4, STONE_D);
      lit.box(x, TOP / 2 + 1, -16, 5.2, TOP, 5.2, { bottom: scaleRgb(STONE, 0.7), top: STONE });
      for (let y = 4; y < TOP; y += 3.2) lit.box(x, y, -16, 5.5, 0.22, 5.5, STONE_D);
      lit.box(x, TOP + 1.3, -16, 6.4, 0.9, 6.4, STONE_D);
      for (const dx of [-2.5, 0, 2.5]) for (const dz of [-2.5, 0, 2.5]) if (Math.abs(dx) + Math.abs(dz) > 0) lit.box(x + dx, TOP + 2.2, -16 + dz, 1.1, 1.0, 1.1, STONE);
      lit.spire(x, TOP + 1.7, -16, 3.3, 4.2, rgb("#3c4558"), 4);
      for (const y of [8, 14.5]) {
        glow.box(x - s * 2.62, y, -16 + 0.0, 0.1, 1.9, 1.1, [2.6, 1.9, 0.9]);
        lit.box(x - s * 2.6, y, -16, 0.12, 2.3, 1.5, IRON);
      }
      // A pulley wheel at the top for the cable, on a small bracket.
      lit.box(x + s * 2.9, TOP - 1.2, -16, 0.8, 0.8, 1.6, IRON);
      lit.post(x + s * 3.3, TOP - 2.0, -16, 0.15, 1.5, IRON, 6);
    }
    // The footbridge between the towers' tops, over the road (well above a kart and its camera), with railings.
    lit.box(0, TOP - 0.6, -16, 2 * X, 1.0, 3.0, { bottom: scaleRgb(STONE_D, 0.9), top: STONE });
    lit.box(0, TOP + 0.2, -16 - 1.4, 2 * X, 0.14, 0.14, IRON);
    lit.box(0, TOP + 0.2, -16 + 1.4, 2 * X, 0.14, 0.14, IRON);
    for (let x = -X + 4; x < X - 3; x += 4.2) {
      lit.box(x, TOP - 0.1, -16 - 1.4, 0.12, 1.2, 0.12, IRON);
      lit.box(x, TOP - 0.1, -16 + 1.4, 0.12, 1.2, 0.12, IRON);
    }
    // The signal box hung from the footbridge over the middle of the road: three lamps in hoods, facing the oncoming kart.
    lit.box(0, TOP - 3.2, -14.5, 4.4, 5.0, 1.0, IRON);
    lit.box(0, TOP - 0.7, -15.2, 0.3, 1.4, 0.3, IRON);
    const lamps: { y: number; colour: Rgb; dark: Rgb }[] = [
      { y: TOP - 1.4, colour: [3.0, 0.35, 0.25], dark: rgb("#3a1010") },
      { y: TOP - 3.2, colour: [3.2, 1.9, 0.2], dark: rgb("#3a2a08") },
      { y: TOP - 5.0, colour: [0.3, 3.0, 0.9], dark: rgb("#0c3016") },
    ];
    for (const l of lamps) {
      lit.blob(0, l.y, -13.95, 0.95, 0.95, 0.3, l.dark, 1);
      lit.box(0, l.y + 0.95, -13.9, 1.9, 0.18, 0.7, IRON);
    }
    // The bell on a bracket under the footbridge.
    lit.box(7, TOP - 1.6, -14.6, 0.2, 2.2, 0.2, IRON);
    lit.box(7, TOP - 2.7, -14.6, 1.2, 0.2, 1.2, IRON);
    lit.blob(7, TOP - 3.4, -14.6, 0.55, 0.65, 0.55, GOLD, 1);
    // The leaf's hinges at the near bank and the road's rail ends: two stone bollards and a chain barrier post either side.
    for (const s of [-1, 1]) {
      lit.post(s * 12.5, 0, 2, 0.5, 1.3, STONE_D, 8);
      lit.post(s * 12.5, 1.3, 2, 0.55, 0.22, GOLD, 8);
    }

    const parts: MovingPart[] = [];
    // Each lamp's light: only the one for the signal's state shows (amber blinks).
    lamps.forEach((l, i) => {
      const g = new MeshBuilder();
      g.blob(0, l.y, -13.8, 0.75, 0.75, 0.25, l.colour, 1);
      parts.push({
        glow: g,
        pivot: [0, l.y, -13.8],
        update(_t, part, race = 0) {
          const state = bridgeSignal(race);
          const on = i === 0 ? state === "down" : i === 1 ? state === "warn" && Math.sin(race * 9) > -0.1 : state === "up";
          part.scale.setScalar(on ? 1 : 0.0001);
        },
      });
    });
    // The counterweights: a concrete block on each tower's outer face, on a cable from the pulley, lowest when the leaf is highest.
    // Both blocks are one moving part (they go together), and the cables are fixed.
    const blocks = new MeshBuilder();
    for (const s of [-1, 1]) {
      const wx = s * (X + 3.3);
      blocks.box(wx, 0, -16, 2.2, 4.2, 2.6, { bottom: scaleRgb(STONE_D, 0.9), top: scaleRgb(STONE, 0.95) });
      blocks.box(wx, 1.9, -16, 2.4, 0.3, 2.8, IRON);
      blocks.box(wx, 0, -16 - 1.31, 1.6, 0.5, 0.06, rgb("#e8c030"));
      lit.box(wx, (TOP - 2 + 7) / 2, -16, 0.14, TOP - 2 - 7, 0.14, IRON);
    }
    parts.push({
      lit: blocks,
      pivot: [0, 0, -16],
      update(_t, part, race = 0) {
        part.position.y = 15 - 9.5 * leafRaised(race);
      },
    });
    return { lit, glow, moving: parts };
  },
};

export const LANDMARKS: Record<string, LandmarkSpec> = { drawbridge };
