/**
 * The race as a fight: the bots and a scripted player round the tracks,
 * counted by packStats.ts. `PACK_REPORT=1` prints every track and seed.
 */
import { describe, expect, it } from "vitest";
import { TRACKS } from "../track/tracks";
import { meanStats, packStats, type PackOptions, type PackStats } from "./packStats";

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const REPORT = ENV.PACK_REPORT === "1";

function row(name: string, s: PackStats): string {
  const f = (v: number, d = 1) => v.toFixed(d).padStart(6);
  return (
    `${name.padEnd(22)}${f(s.overtakesPerLap)}${f(s.cleanPerLap)}${f(s.leadChanges)}${f(s.playerPasses)}${f(s.spread, 0)}${f(s.nearPlayer)}` +
    `${f(s.fightShare, 2)}${f(s.bumpsPerKartLap, 2)}${f(s.hitsPerKartLap, 2)}${f(s.playerPlace)}${f(s.finishSpread)}${f(s.lineVariety, 2)}${f(s.lapTimeSpread, 2)}`
  );
}
const HEAD = `${"".padEnd(22)}${["pass/l", "clean", "lead", "you", "spread", "near", "fight", "bump", "hits", "place", "finish", "line", "lapsd"].map((h) => h.padStart(6)).join("")}`;

describe.runIf(REPORT)("the pack, reported", () => {
  const seeds = (ENV.PACK_SEEDS ?? "1,2,3,4").split(",").map(Number);
  const runs: { name: string; options: PackOptions }[] = [
    { name: "sharp player, back", options: { player: 1 } },
    { name: "middling player, back", options: { player: 0.55 } },
    { name: "eight bots", options: { player: null, bots: 8 } },
  ];
  for (const { name, options } of runs) {
    it(name, { timeout: 600000 }, () => {
      const lines = [`\n${name}\n${HEAD}`];
      const all: PackStats[] = [];
      for (const track of TRACKS) {
        const each = seeds.map((seed) => packStats(track, { ...options, seed }));
        all.push(...each);
        lines.push(row(track.id, meanStats(each)));
      }
      const mean = meanStats(all);
      lines.push(row("ALL", mean));
      const places = all.map((s) => s.playerPlace);
      if (options.player !== null) lines.push(`player places: ${places.join(" ")} (wins ${places.filter((p) => p === 1).length}/${places.length})`);
      console.log(lines.join("\n"));
      expect(all.every((s) => s.finished)).toBe(true);
    });
  }
});
