import { describe, expect, it } from "vitest";
import { designLayout, designLanes, designPanes, frameSpots, neighbourPane, paneById, viewAxes, viewDir, VIEW_FOV_DEG } from "./layout";
import { dot, length, normalize, sub } from "./vec";

/** Where a world direction lands in the art's 16:9 view, in NDC (−1..1). */
function ndc(p: { x: number; y: number; z: number }): { x: number; y: number } {
  const { right, up, forward } = viewAxes();
  const z = dot(p, forward);
  const t = Math.tan((VIEW_FOV_DEG * Math.PI) / 360);
  return { x: dot(p, right) / (z * t * (16 / 9)), y: dot(p, up) / (z * t) };
}

describe("the cupola as designed", () => {
  const panes = designPanes();

  it("has seven panes, the centre one straight ahead", () => {
    expect(panes.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const centre = paneById(designLayout(), 0)!;
    expect(dot(normalize(centre.center), viewAxes().forward)).toBeGreaterThan(0.999);
    // An 80 cm window a metre and a half out.
    expect(centre.radius).toBeGreaterThan(0.38);
    expect(centre.radius).toBeLessThan(0.41);
    expect(length(centre.center)).toBeGreaterThan(1.5);
    expect(length(centre.center)).toBeLessThan(1.6);
  });

  it("points every pane outward, away from the eye", () => {
    for (const p of panes) expect(dot(normalize(p.center), p.normal), `pane ${p.id}`).toBeGreaterThan(0.3);
  });

  it("puts each side window where its name says, as the player sees it", () => {
    const at = (id: number) => ndc(panes.find((p) => p.id === id)!.center);
    expect(at(1).x).toBeLessThan(0);
    expect(at(1).y).toBeGreaterThan(0);
    expect(at(2).x).toBeGreaterThan(0);
    expect(at(2).y).toBeGreaterThan(0);
    expect(at(3).x).toBeGreaterThan(0.3);
    expect(Math.abs(at(3).y)).toBeLessThan(0.2);
    expect(at(4).x).toBeGreaterThan(0);
    expect(at(4).y).toBeLessThan(0);
    expect(at(5).x).toBeLessThan(0);
    expect(at(5).y).toBeLessThan(0);
    expect(at(6).x).toBeLessThan(-0.3);
  });

  it("gives the trapezoids four corners in the pane's plane", () => {
    for (const p of panes.filter((x) => x.id > 0)) {
      expect(p.corners).toHaveLength(4);
      for (const c of p.corners) expect(Math.abs(dot(sub(c, p.center), p.normal))).toBeLessThan(1e-6);
      expect(p.radius).toBeGreaterThan(0.2);
      expect(p.radius).toBeLessThan(0.45);
    }
  });

  it("finds the metal between neighbouring windows", () => {
    const spots = frameSpots(panes);
    expect(spots).toHaveLength(12);
    for (const s of spots) {
      expect(length(s)).toBeGreaterThan(1);
      expect(length(s)).toBeLessThan(2);
    }
  });

  it("names a neighbour for a second pane", () => {
    const layout = designLayout();
    const n = neighbourPane(layout, 0, paneById(layout, 3)!.center);
    expect(n?.id).toBe(3);
  });
});

describe("the lanes", () => {
  it("begin 80 to 120 m out, inside the view", () => {
    const lanes = designLanes();
    expect(lanes).toHaveLength(16);
    for (const l of lanes) {
      expect(length(l)).toBeGreaterThanOrEqual(79.9);
      expect(length(l)).toBeLessThanOrEqual(120.1);
      const p = ndc(l);
      expect(Math.abs(p.x)).toBeLessThan(0.95);
      expect(Math.abs(p.y)).toBeLessThan(0.8);
    }
  });

  it("are the same every time", () => {
    expect(designLanes()).toEqual(designLanes());
  });

  it("look where the view looks", () => {
    const d = viewDir(0, 0);
    expect(dot(d, viewAxes().forward)).toBeCloseTo(1, 6);
  });
});
