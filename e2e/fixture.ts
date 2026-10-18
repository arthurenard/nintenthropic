/**
 * The fake camera's picture: e2e/fixtures/hand.jpg as a Y4M video, the
 * format Chrome's --use-file-for-fake-video-capture reads. The JPEG is
 * decoded by Chrome itself (no image library needed), converted to the
 * camera's I420 colour format here, and written once to a cache under
 * node_modules; Chrome loops the file, so two frames are enough.
 *
 * MediaPipe finds the hand in this picture (checked by e2e/smoke.html), which
 * is what the camera test needs to prove tracking runs end to end.
 */
import { chromium } from "@playwright/test";

/** Node's file functions, imported at run time so the type check needs no Node types. */
interface Files {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): void;
  readFileSync(path: string): { toString(encoding: "base64"): string };
  writeFileSync(path: string, data: Uint8Array): void;
}

export const ROOT = new URL("..", import.meta.url).pathname;
export const FIXTURE = `${ROOT}node_modules/.cache/super-claude-bros-e2e/hand.y4m`;
const SOURCE = `${ROOT}e2e/fixtures/hand.jpg`;
/** The picture's own 2:3 shape, with the even sides 4:2:0 needs. */
const WIDTH = 480;
const HEIGHT = 720;
const FRAMES = 2;

/** RGBA pixels to the Y, U and V planes of I420, with BT.601 studio range. */
export function toI420(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 1.5);
  const uOffset = width * height;
  const vOffset = uOffset + (width / 2) * (height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
      out[y * width + x] = Math.round(16 + 0.257 * r + 0.504 * g + 0.098 * b);
    }
  }
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const i = ((y + dy) * width + x + dx) * 4;
        r += rgba[i]!;
        g += rgba[i + 1]!;
        b += rgba[i + 2]!;
      }
      [r, g, b] = [r / 4, g / 4, b / 4];
      const at = (y / 2) * (width / 2) + x / 2;
      out[uOffset + at] = Math.round(128 - 0.148 * r - 0.291 * g + 0.439 * b);
      out[vOffset + at] = Math.round(128 + 0.439 * r - 0.368 * g - 0.071 * b);
    }
  }
  return out;
}

export async function makeFixture(): Promise<string> {
  const fs = (await import("node:fs" as string)) as Files;
  if (fs.existsSync(FIXTURE)) return FIXTURE;
  const jpeg = fs.readFileSync(SOURCE).toString("base64");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
  try {
    const page = await browser.newPage();
    const pixels = await page.evaluate(
      async ({ jpeg, width, height }) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${jpeg}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
        return btoa(binary);
      },
      { jpeg, width: WIDTH, height: HEIGHT },
    );
    const rgba = Uint8Array.from(atob(pixels), (c) => c.charCodeAt(0));
    const frame = toI420(rgba, WIDTH, HEIGHT);
    const header = new TextEncoder().encode(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`);
    const marker = new TextEncoder().encode("FRAME\n");
    const video = new Uint8Array(header.length + FRAMES * (marker.length + frame.length));
    video.set(header, 0);
    let offset = header.length;
    for (let i = 0; i < FRAMES; i++) {
      video.set(marker, offset);
      offset += marker.length;
      video.set(frame, offset);
      offset += frame.length;
    }
    fs.mkdirSync(FIXTURE.slice(0, FIXTURE.lastIndexOf("/")), { recursive: true });
    fs.writeFileSync(FIXTURE, video);
    return FIXTURE;
  } finally {
    await browser.close();
  }
}
