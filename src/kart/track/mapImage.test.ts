import { describe, expect, it } from "vitest";
import { createSimRace } from "../sim/race";
import { TRACKS } from "./tracks";
import { trackMapSvg } from "./mapImage";
import type { TrackDef } from "./geometry";

/** The few Node calls the maps need, loaded at run time so the browser-facing type check does not need Node's definitions. */
interface Node {
  mkdirSync(path: string, options: { recursive: boolean }): void;
  writeFileSync(path: string, data: string): void;
  execFileSync(file: string, args: string[], options: { stdio: string }): void;
  join(...parts: string[]): string;
  dirname(path: string): string;
  fileURLToPath(url: string): string;
}

async function node(): Promise<Node> {
  const fs = (await import("node:fs" as string)) as Pick<Node, "mkdirSync" | "writeFileSync">;
  const cp = (await import("node:child_process" as string)) as Pick<Node, "execFileSync">;
  const path = (await import("node:path" as string)) as Pick<Node, "join" | "dirname">;
  const url = (await import("node:url" as string)) as Pick<Node, "fileURLToPath">;
  return { ...fs, ...cp, ...path, ...url };
}

/** One sharp bot's first lap, seconds (for the picture's caption). */
function botLap(track: TrackDef): number {
  const r = createSimRace({ track, laps: 1, seed: 1, racers: [{ id: 0, name: "Bot", colour: "#ffffff", player: null, skill: 1 }] });
  for (let i = 0; i < 60 * 120 && r.view().phase !== "finished"; i++) r.step(new Map());
  return r.result()?.standings[0]?.time ?? 0;
}

describe("the track maps", () => {
  for (const track of TRACKS) {
    it(`draw ${track.name} top-down into src/kart/track/maps/${track.id}.svg (and a .png when rsvg-convert is about)`, async () => {
      const svg = trackMapSvg(track, { lapTime: botLap(track) });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain(track.name);
      for (const l of track.landmarks ?? []) expect(svg).toContain(l.kind);
      for (const h of track.hazards ?? []) expect(svg).toContain(h.kind);
      const n = await node();
      const out = n.join(n.dirname(n.fileURLToPath(import.meta.url)), "maps");
      n.mkdirSync(out, { recursive: true });
      const file = n.join(out, `${track.id}.svg`);
      n.writeFileSync(file, svg);
      try {
        n.execFileSync("rsvg-convert", ["-w", "1100", "-o", n.join(out, `${track.id}.png`), file], { stdio: "ignore" });
      } catch {
        // No converter here: the SVG is the map.
      }
    });
  }
});
