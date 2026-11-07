import { appendFileSync } from "node:fs";
import { it } from "vitest";
import { trackById } from "../track/tracks";
import { trackStats, botField } from "./trackStats";
import { createSimRace } from "./race";
import { GO_TICK } from "./kart";
const log = (...a: unknown[]) => appendFileSync("/private/tmp/claude-501/-Users-arthurenard-Developer-Handy/d18cfbe0-3cc8-4b21-b42c-935d881c3da7/scratchpad/diag.txt", a.join(" ") + "\n");
for (const id of (process.env.DIAG ?? "kitchen-rally,harbour-lights,meadow-loop").split(",")) {
  it("diag " + id, { timeout: 200000 }, () => {
    const track = trackById(id);
    const s = trackStats(track, { seed: 1 });
    log(id, JSON.stringify(s));
    const r = createSimRace({ track, laps: 3, seed: 1, racers: botField() });
    const still: number[] = new Array(8).fill(0);
    const where = new Map<string, number>();
    const falls = new Map<string, number>();
    while (r.tick < GO_TICK + 60 * 200 && r.view().phase !== "finished") {
      r.step(new Map());
      const v = r.view();
      for (const e of v.events) if (e.type === "fall") { const k = v.karts[e.kart]!; const key = `lp=${k.lapProgress.toFixed(3)} route=${(k as any).route}`; falls.set(key, (falls.get(key) ?? 0) + 1); }
      if (v.phase !== "racing") continue;
      for (const k of v.karts) {
        const sitting = k.finished === null && k.rescue === 0 && k.spin === 0 && k.hop === 0 && Math.abs(k.speed) < 1.5;
        still[k.id] = sitting ? still[k.id]! + 1 : 0;
        if (still[k.id] === 60) { const key = `lp=${k.lapProgress.toFixed(3)} route=${(k as any).route} x=${k.x.toFixed(0)} z=${k.z.toFixed(0)}`; where.set(key, (where.get(key) ?? 0) + 1); }
      }
    }
    log(id, "stalls", JSON.stringify([...where]));
    log(id, "falls", JSON.stringify([...falls]));
  });
}
