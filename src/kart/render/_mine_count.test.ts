import { describe, it } from "vitest";
import { Mesh, MeshBasicMaterial, MeshLambertMaterial, type Object3D } from "three";
import { LANDMARKS as K, HAZARDS as KH } from "./world/landmarks/kitchen";
import { LANDMARKS as M } from "./world/landmarks/meadow";
import { LANDMARKS as H, HAZARDS as HH } from "./world/landmarks/harbour";

describe("count", () => {
  it("counts", () => {
    const lines: string[] = [];
    for (const [theme, set] of [["kitchen", K], ["meadow", M], ["harbour", H]] as const) {
      for (const [name, spec] of Object.entries(set)) {
        let n = 0;
        const t0 = performance.now();
        const model = spec.build({ rnd: (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(), theme: theme as never, night: theme === "harbour", scale: 1, span: spec.defaultSpan ?? 0, halfWidth: 7 });
        const dt = performance.now() - t0;
        const parts = [model.lit, model.glow, model.glass].map((b) => (b ? b.triangles : 0));
        for (const m of model.moving ?? []) for (const b of [m.lit, m.glow, m.glass]) if (b) n += b.triangles;
        // check for NaN
        let bad = 0;
        for (const b of [model.lit, model.glow, model.glass]) if (b) for (const v of b.position) if (!Number.isFinite(v)) bad++;
        lines.push(`${theme}/${name}: lit ${parts[0]} glow ${parts[1]} glass ${parts[2]} moving ${n} halos ${(model.halos ?? []).length} nan ${bad} ${dt.toFixed(0)}ms`);
      }
    }
    const lit = new MeshLambertMaterial();
    const glow = new MeshBasicMaterial();
    for (const [theme, set] of [["kitchen", KH], ["harbour", HH]] as const) {
      for (const [name, spec] of Object.entries(set)) {
        const model = spec.build({ rnd: Math.random, theme: theme as never, night: false, lit, glow });
        let tris = 0;
        model.root.traverse((o: Object3D) => {
          const g = (o as Mesh).geometry;
          if (g) tris += g.getAttribute("position").count / 3;
        });
        model.update({ time: 1, travel: 3, speed: 4, cycle: 0.3, height: 0, active: true, heading: 1 });
        lines.push(`${theme}/hazard:${name}: ${tris} tris`);
      }
    }
    (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write("\n" + lines.join("\n") + "\n");
  });
});
