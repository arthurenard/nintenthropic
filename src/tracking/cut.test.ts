import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A stand-in for a browser's canvases and frames, with one knob: whether a VideoFrame cut to the picture's white
 * half is read as that half (Chrome) or as the whole picture, whose first pixel is black (Safari).
 */
function browser(cuts: { draw: boolean; upload: boolean }) {
  class Frame {
    closed = false;
    constructor(
      readonly source: unknown,
      readonly init: { visibleRect?: unknown },
    ) {}
    close(): void {
      this.closed = true;
    }
  }
  const frames: Frame[] = [];
  class Canvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext(kind: string): unknown {
      if (kind === "2d") {
        let drawn: Frame | null = null;
        return {
          fillRect() {},
          set fillStyle(_: string) {},
          drawImage(frame: Frame) {
            drawn = frame;
          },
          getImageData: () => ({ data: [drawn && cuts.draw ? 255 : 0, 0, 0, 255] }),
        };
      }
      if (kind !== "webgl2") return null;
      let uploaded: Frame | null = null;
      return {
        TEXTURE_2D: 1, TEXTURE_MIN_FILTER: 2, TEXTURE_MAG_FILTER: 3, TEXTURE_WRAP_S: 4, TEXTURE_WRAP_T: 5, NEAREST: 6, CLAMP_TO_EDGE: 7,
        RGBA: 8, UNSIGNED_BYTE: 9, FRAMEBUFFER: 10, COLOR_ATTACHMENT0: 11,
        createTexture: () => ({}),
        bindTexture() {},
        texParameteri() {},
        texImage2D: (_t: number, _l: number, _i: number, _f: number, _y: number, frame: Frame) => (uploaded = frame),
        createFramebuffer: () => ({}),
        bindFramebuffer() {},
        framebufferTexture2D() {},
        readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, pixel: Uint8Array) => {
          pixel[0] = uploaded && cuts.upload ? 255 : 0;
        },
        deleteFramebuffer() {},
        deleteTexture() {},
      };
    }
  }
  vi.stubGlobal("OffscreenCanvas", Canvas);
  vi.stubGlobal(
    "VideoFrame",
    class extends Frame {
      constructor(source: unknown, init: { visibleRect?: unknown }) {
        super(source, init);
        frames.push(this);
      }
    },
  );
  return frames;
}

describe("asking the browser whether it cuts a VideoFrame to its visibleRect", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const ask = async () => (await import("./cut")).framesHonourCut();

  it("says yes when both drawImage and a texture upload give the cut column (Chrome)", async () => {
    const frames = browser({ draw: true, upload: true });
    expect(await ask()).toBe(true);
    // The probe's frame is cut to the right half of its picture, and let go of.
    expect(frames).toHaveLength(1);
    expect(frames[0]!.init.visibleRect).toEqual({ x: 2, y: 0, width: 2, height: 2 });
    expect(frames[0]!.closed).toBe(true);
  });

  it("says no when the browser reads the whole picture (Safari), by either way of reading", async () => {
    browser({ draw: false, upload: false });
    expect(await ask()).toBe(false);
    vi.resetModules();
    browser({ draw: true, upload: false });
    expect(await ask()).toBe(false);
    vi.resetModules();
    browser({ draw: false, upload: true });
    expect(await ask()).toBe(false);
  });

  it("says no where the probe cannot run, so the workers cut: right everywhere, only dearer", async () => {
    // No VideoFrame or OffscreenCanvas here at all.
    expect(await ask()).toBe(false);
  });

  it("asks once", async () => {
    const frames = browser({ draw: true, upload: true });
    const { framesHonourCut } = await import("./cut");
    framesHonourCut();
    framesHonourCut();
    expect(frames).toHaveLength(1);
  });
});
