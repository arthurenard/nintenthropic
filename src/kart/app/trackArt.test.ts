import { describe, expect, it } from "vitest";
import { CUPS, TRACKS } from "../track/tracks";
import { OUTLINE_AREA, THEME_COLOURS, cupOfTrack, postcardUrl, trackOutline } from "./trackArt";

/** The numbers in an outline's path, in pairs. */
const points = (d: string): [number, number][] => [...d.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("a track's own picture", () => {
  it("is drawn for every track, closed, inside the area it is given", () => {
    for (const track of TRACKS) {
      const outline = trackOutline(track);
      expect(outline.d.startsWith("M"), track.id).toBe(true);
      expect(outline.d.endsWith("Z"), track.id).toBe(true);
      const all = points(outline.d);
      expect(all.length, track.id).toBeGreaterThan(40);
      for (const [x, y] of all) {
        expect(x, track.id).toBeGreaterThanOrEqual(OUTLINE_AREA.x);
        expect(x, track.id).toBeLessThanOrEqual(OUTLINE_AREA.x + OUTLINE_AREA.width);
        expect(y, track.id).toBeGreaterThanOrEqual(OUTLINE_AREA.y);
        expect(y, track.id).toBeLessThanOrEqual(OUTLINE_AREA.y + OUTLINE_AREA.height);
      }
    }
  });

  it("fills its area along its longer side, clear of the edges by the padding", () => {
    for (const track of TRACKS) {
      const all = points(trackOutline(track, 10).d);
      const xs = all.map(([x]) => x);
      const ys = all.map(([, y]) => y);
      const wide = Math.max(...xs) - Math.min(...xs);
      const high = Math.max(...ys) - Math.min(...ys);
      // One of the two fills the room that is left once the padding is taken off.
      const fitsWidth = Math.abs(wide - (OUTLINE_AREA.width - 20)) < 1.5;
      const fitsHeight = Math.abs(high - (OUTLINE_AREA.height - 20)) < 1.5;
      expect(fitsWidth || fitsHeight, track.id).toBe(true);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 0.1);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(OUTLINE_AREA.y + 10 - 0.1);
    }
  });

  it("puts the start line on the road, and is the same every time", () => {
    for (const track of TRACKS) {
      const outline = trackOutline(track);
      const near = Math.min(...points(outline.d).map(([x, y]) => Math.hypot(x - outline.start.x, y - outline.start.y)));
      expect(near, track.id).toBeLessThan(2);
      expect(trackOutline(track)).toBe(trackOutline(track));
    }
  });

  it("is seen from above, the way the minimap sees it: north (+z) up the card and +x to the left", () => {
    // The Meadow Loop's start straight runs north from the start line: its picture starts low and goes up.
    const outline = trackOutline(TRACKS[0]!);
    const all = points(outline.d);
    expect(all[10]![1]).toBeLessThan(all[0]![1]);
    // And the world's +x is on the card's left: the loop's far end (x = 280) is its left-most part.
    const leftmost = all.reduce((best, p) => (p[0] < best[0] ? p : best));
    expect(leftmost[0]).toBeLessThan(outline.start.x);
  });
});

describe("the colours and the cups", () => {
  it("name a sky and a ground for every world the tracks are in", () => {
    for (const track of TRACKS) expect(THEME_COLOURS[track.theme], track.theme).toHaveLength(2);
  });

  it("know which cup a track is in, and which race of it; the secret track is in none", () => {
    for (const cup of CUPS) cup.tracks.forEach((id, i) => expect(cupOfTrack(id)).toEqual({ cup: cup.name, race: i + 1 }));
    expect(cupOfTrack("five-finger-circuit")).toBeNull();
  });

  it("find a postcard by the track's id, where the art agent renders them", () => {
    expect(postcardUrl("meadow-loop")).toBe("assets/kart/tracks/meadow-loop.webp");
  });
});
