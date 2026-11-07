// The system info copied for a bug report: everything it needs, nothing personal.
import { describe, expect, it } from "vitest";
import { VERSION, formatSystemInfo, type SystemFacts } from "./settings";

const FACTS: SystemFacts = {
  version: "0.3.0",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
  gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)",
  tracker: { where: "worker", delegate: "GPU" },
  frames: { interval: { p50: 16.66, p95: 17.4 }, work: { p50: 4.1, p95: 6.25 } },
  latency: { p50: 38.2, p95: 51.9 },
  quality: { tier: "high", scale: 1 },
  screen: { width: 1512, height: 982, windowWidth: 1512, windowHeight: 945, pixelRatio: 2 },
};

describe("Copy System Info", () => {
  it("says the version, the browser, the graphics, the tracker, the timings and the screen", () => {
    expect(formatSystemInfo(FACTS)).toBe(
      [
        "Nintenthropic 0.3.0",
        `Browser: ${FACTS.userAgent}`,
        "Graphics: ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version) (high, 100% resolution)",
        "Hand tracking: worker, GPU",
        "Frame time: 16.7 ms p50, 17.4 ms p95 (work 4.1 ms p50, 6.3 ms p95)",
        "Camera to crosshair: 38.2 ms p50, 51.9 ms p95",
        "Screen: 1512×982, window 1512×945, pixel ratio 2",
        "",
      ].join("\n"),
    );
  });

  it("says plainly what it does not know yet", () => {
    const text = formatSystemInfo({ ...FACTS, gpu: null, tracker: null, frames: null, latency: null, quality: null });
    expect(text).toContain("Graphics: unknown\n");
    expect(text).toContain("Hand tracking: not started\n");
    expect(text).toContain("Frame time: no game played yet\n");
    expect(text).toContain("Camera to crosshair: not measured yet\n");
  });

  it("carries the version the build was made from", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
