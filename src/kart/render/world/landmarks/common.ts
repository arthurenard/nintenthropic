/**
 * What every world shares: the rubber duck. Every Nintenthropic game hides one, and
 * every Grip Prix track has it somewhere off the racing line (`duck` in the
 * track). It is a classic yellow bath duck, three metres long, bobbing and
 * looking about; in some worlds it has dressed for the weather.
 */
import { duckAt, resetDuck } from "./duckFlight";
import { MeshBuilder, ramp, rgb, scaleRgb } from "./kit";
import type { HazardSpec, LandmarkContext, LandmarkModel, LandmarkSpec } from "./types";

const ORANGE = rgb("#ff8a1c");

function duck(ctx: LandmarkContext): LandmarkModel {
  // In the coloured light of dusk, lava and neon a yellow duck turns orange: lift it so it still reads as the classic yellow.
  const k = ctx.night ? 1.4 : 1;
  const YELLOW = scaleRgb(rgb("#ffd92e"), k);
  const YELLOW_DARK = scaleRgb(rgb("#e9a400"), k);
  const lit = new MeshBuilder();
  const glass = new MeshBuilder();
  const body = ramp(YELLOW_DARK, YELLOW);
  // Body, chest, tail and wings.
  lit.blob(0, 1.1, 0, 1.2, 0.95, 1.55, body, 1);
  lit.blob(0, 1.25, 0.85, 0.95, 0.8, 0.9, ramp(scaleRgb(YELLOW, 0.9), YELLOW), 1);
  lit.blob(0, 1.85, -1.45, 0.38, 0.55, 0.55, ramp(YELLOW_DARK, YELLOW), 0);
  for (const s of [-1, 1]) lit.blob(s * 1.08, 1.25, -0.15, 0.22, 0.58, 0.95, ramp(scaleRgb(YELLOW_DARK, 0.92), scaleRgb(YELLOW, 0.96)), 0, s * 0.1);
  // Head, beak, eyes.
  lit.blob(0, 2.45, 0.95, 0.82, 0.8, 0.8, ramp(YELLOW_DARK, YELLOW), 1);
  lit.blob(0, 2.28, 1.85, 0.55, 0.17, 0.72, ramp(scaleRgb(ORANGE, 0.85), ORANGE), 0);
  lit.blob(0, 2.12, 1.78, 0.5, 0.12, 0.62, scaleRgb(ORANGE, 0.7), 0);
  for (const s of [-1, 1]) {
    lit.blob(s * 0.42, 2.62, 1.5, 0.13, 0.15, 0.13, [0.02, 0.02, 0.03], 0);
    lit.blob(s * 0.4, 2.68, 1.6, 0.04, 0.05, 0.04, [4, 4, 4], 0);
    // A flush of cheek.
    lit.blob(s * 0.62, 2.35, 1.42, 0.14, 0.1, 0.1, rgb("#ffb347"), 0);
  }

  // What it wears, by world.
  switch (ctx.theme) {
    case "snow": {
      const red = rgb("#e8453c");
      const white = rgb("#ffffff");
      for (let i = 0; i < 6; i++) lit.blob(Math.sin(i * 1.1) * 0.15, 1.82, 0.3, 0.8, 0.2, 0.8, i % 2 ? white : red, 0, 0);
      lit.blob(0, 2.95, 0.85, 0.55, 0.42, 0.55, red, 1);
      lit.blob(0, 3.4, 0.85, 0.17, 0.17, 0.17, white, 0);
      break;
    }
    case "palm": {
      const black = [0.02, 0.02, 0.04] as const;
      lit.box(0, 2.66, 1.46, 1.05, 0.09, 0.07, black);
      for (const s of [-1, 1]) lit.blob(s * 0.42, 2.64, 1.5, 0.3, 0.2, 0.08, [0.03, 0.04, 0.1], 0);
      break;
    }
    case "space": {
      // An astronaut's helmet: a glass bubble round the head and a white collar.
      glass.blob(0, 2.45, 0.9, 1.5, 1.45, 1.5, rgb("#bfe4ff"), 1);
      lit.blob(0, 1.78, 0.75, 1.15, 0.2, 1.15, rgb("#f4f6fb"), 0);
      lit.blob(0, 1.8, 0.75, 0.9, 0.12, 0.9, rgb("#ff8a1c"), 0);
      break;
    }
    case "canyon": {
      const brown = rgb("#8b5a2b");
      lit.blob(0, 3.0, 0.9, 1.25, 0.1, 1.25, ramp(scaleRgb(brown, 0.8), brown), 0);
      lit.blob(0, 3.3, 0.9, 0.55, 0.35, 0.55, ramp(scaleRgb(brown, 0.85), brown), 1);
      break;
    }
    case "harbour": {
      const white = rgb("#f4f6fb");
      lit.blob(0, 3.0, 0.88, 0.7, 0.33, 0.7, white, 1);
      lit.blob(0, 2.85, 1.35, 0.6, 0.08, 0.4, rgb("#1d2a5a"), 0);
      break;
    }
    case "funfair": {
      const pink = rgb("#ff3d7f");
      for (const s of [-1, 1]) lit.blob(s * 0.4, 1.72, 1.1, 0.4, 0.3, 0.2, pink, 0);
      lit.blob(0, 1.72, 1.1, 0.14, 0.14, 0.14, scaleRgb(pink, 0.8), 0);
      break;
    }
    case "volcano": {
      // A towel wound on its head, in a hot spring.
      lit.blob(0, 3.0, 0.9, 0.82, 0.38, 0.82, rgb("#ffffff"), 1);
      lit.blob(0, 3.1, 0.9, 0.55, 0.15, 0.55, rgb("#4aa3ff"), 0);
      break;
    }
    default:
      break;
  }

  return {
    lit,
    glass: glass.empty ? undefined : glass,
    // It bobs on the water of the world and turns its head about; in space it drifts.
    moving: [
      {
        lit,
        glass: glass.empty ? undefined : glass,
        pivot: [0, 1, 0],
        update(t, part) {
          // Found by a kart: it squeaks and flies off, and paddles back later (duckFlight.ts).
          const day = duckAt(t);
          if (day) {
            part.visible = day.visible;
            part.position.set(day.x, day.y, day.z);
            part.rotation.set(day.pitch, day.yaw, day.roll);
            part.scale.set(1, day.squash, 1);
            return;
          }
          part.visible = true;
          part.scale.set(1, 1, 1);
          part.position.x = part.position.z = 0;
          const space = ctx.theme === "space";
          part.position.y = Math.sin(t * (space ? 0.9 : 1.7)) * (space ? 0.45 : 0.11);
          part.rotation.z = Math.sin(t * 1.15) * (space ? 0.12 : 0.05);
          part.rotation.x = Math.sin(t * 0.8 + 1) * (space ? 0.1 : 0.03);
          part.rotation.y = Math.sin(t * 0.45) * 0.35;
        },
      },
    ],
  };
}

export const LANDMARKS: Record<string, LandmarkSpec> = {
  "rubber-duck": {
    footprint: 2,
    build: (ctx) => {
      // A new world: the duck is home.
      resetDuck();
      const model = duck(ctx);
      // The duck lives in its moving part; the static model is left empty so it is not drawn twice.
      return { ...model, lit: new MeshBuilder(), glass: undefined };
    },
  },
};

export const HAZARDS: Record<string, HazardSpec> = {};
