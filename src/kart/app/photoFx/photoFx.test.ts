import { describe, expect, it } from "vitest";
import { TRACKS } from "../../track/tracks";
import { clipExtension, shareName } from "../finishShare";
import { stampText } from "./compose";
import { drawFx } from "./effects";
import { flourishFor, LOOKS, LOOP, lookFor } from "./looks";

/** A canvas context that only writes down what it is asked to do (numbers rounded), to compare frames. */
function recorder(): { context: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const gradient = { addColorStop: (...a: unknown[]) => void log.push(`stop ${a.join(",").replace(/\d+\.\d{3,}/g, (n) => Number(n).toFixed(1))}`) };
  const context = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === "createLinearGradient" || name === "createRadialGradient") return (...a: number[]) => (log.push(`${name} ${a.map((n) => n.toFixed(1))}`), gradient);
        return (...a: unknown[]) => void log.push(`${name} ${a.map((n) => (typeof n === "number" ? n.toFixed(1) : String(n)))}`);
      },
      set: (_t, name: string, value: unknown) => {
        log.push(`${name}=${typeof value === "number" ? value.toFixed(2) : String(value).replace(/\d+\.\d{3,}/g, (n) => Number(n).toFixed(1))}`);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { context, log };
}

function frame(trackId: string, t: number, place = 4, field = 4): string[] {
  const r = recorder();
  drawFx(r.context, 320, 240, t, lookFor(trackId), flourishFor(place, field), place);
  return r.log;
}

describe("the look of a track's photos", () => {
  it("every track has its own look, named for the track, with effects and a peak inside the loop", () => {
    for (const track of TRACKS) {
      const look = LOOKS[track.id];
      expect(look, track.id).toBeDefined();
      expect(look!.id).toBe(track.id);
      expect(look!.name).toBe(track.name);
      expect(look!.effects.length).toBeGreaterThanOrEqual(2);
      expect(look!.peak).toBeGreaterThan(0);
      expect(look!.peak).toBeLessThan(LOOP);
    }
    expect(Object.keys(LOOKS).length).toBe(TRACKS.length);
  });

  it("gives each track its own colour filter and effects, and a plain look to an unknown track", () => {
    expect(new Set(TRACKS.map((t) => LOOKS[t.id]!.filter)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(TRACKS.map((t) => LOOKS[t.id]!.effects.join())).size).toBe(TRACKS.length);
    expect(lookFor("no-such-track").id).toBe("");
    expect(lookFor(undefined).effects.length).toBeGreaterThan(0);
  });

  it("the fireworks are over the harbour and the fair, the snow on the glacier, the embers in the volcano", () => {
    expect(LOOKS["harbour-lights"]!.effects).toContain("fireworks");
    expect(LOOKS["fun-fair"]!.effects).toContain("fireworks");
    expect(LOOKS["glacier-pass"]!.effects).toContain("snow");
    expect(LOOKS["volcano-rush"]!.effects).toContain("embers");
    expect(LOOKS["starlight-ribbon"]!.effects).toContain("shooting");
  });
});

describe("what sits over a card by place", () => {
  it("crowns the winner (alone too), sparkles for second and third, a rain cloud for the last of three or more", () => {
    expect(flourishFor(1, 1)).toBe("crown");
    expect(flourishFor(1, 8)).toBe("crown");
    expect(flourishFor(2, 8)).toBe("sparkle");
    expect(flourishFor(3, 3)).toBe("sparkle");
    expect(flourishFor(8, 8)).toBe("cloud");
    expect(flourishFor(4, 4)).toBe("cloud");
    expect(flourishFor(4, 8)).toBeNull();
    expect(flourishFor(2, 2)).toBe("sparkle");
  });
});

describe("the effects", () => {
  it("draw the same frame for the same moment, and every effect loops within LOOP seconds", () => {
    for (const track of TRACKS) {
      const a = frame(track.id, 1.3);
      expect(a.length, track.id).toBeGreaterThan(5);
      expect(frame(track.id, 1.3), track.id).toEqual(a);
      expect(frame(track.id, 1.3 + LOOP), track.id).toEqual(a);
    }
  });

  it("move: a moment later is a different frame", () => {
    for (const track of TRACKS) expect(frame(track.id, 0.4), track.id).not.toEqual(frame(track.id, 0.9));
  });

  it("the flourishes draw too, each looping", () => {
    for (const place of [1, 2, 3, 4]) {
      const a = frame("meadow-loop", 0.7, place, 4);
      expect(frame("meadow-loop", 0.7 + LOOP, place, 4)).toEqual(a);
      expect(a).not.toEqual(frame("meadow-loop", 0.7, 5, 8));
    }
  });
});

describe("the shared files", () => {
  it("are named nintenthropic-grip-prix-<track> with the type's extension", () => {
    expect(shareName("Harbour Lights", "png")).toBe("nintenthropic-grip-prix-harbour-lights.png");
    expect(shareName("Five Finger Circuit", "mp4")).toBe("nintenthropic-grip-prix-five-finger-circuit.mp4");
    expect(shareName("Fun Fair", "webm")).toBe("nintenthropic-grip-prix-fun-fair.webm");
  });

  it("take the clip's extension from the recorded type", () => {
    expect(clipExtension("video/mp4;codecs=avc1")).toBe("mp4");
    expect(clipExtension("video/mp4")).toBe("mp4");
    expect(clipExtension("video/webm;codecs=vp9")).toBe("webm");
  });

  it("stamp a card with its track and place", () => {
    expect(stampText(lookFor("canyon-run"), "2nd")).toBe("Canyon Run · 2nd");
  });
});
