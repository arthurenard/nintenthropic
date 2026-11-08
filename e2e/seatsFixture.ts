/**
 * Cameras for players sharing one: Y4M videos of fists held like wheels in some columns of the picture and none in
 * the others, for Chrome's fake camera (--use-file-for-fake-video-capture), made like e2e/fixture.ts's picture of a
 * hand from the same photo (e2e/fixtures/hand.jpg, no one's own face): a plain wall and,
 * in each occupied column, the photo's one hand held up as big as the column lets it.
 *
 * Columns are the camera's own, left to right (the player sees the picture mirrored: the camera's right column is
 * the first seat's, on the left of the screen). "alone-right" is one player in the camera's right column with the
 * left empty, which a player sitting alone in the left seat of the mirrored picture makes; "pair" is both.
 */
import { chromium } from "@playwright/test";
import { ROOT, toI420 } from "./fixture";

/** Node's file functions, imported at run time so the type check needs no Node types. */
interface Files {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): void;
  readFileSync(path: string): { toString(encoding: "base64"): string };
  writeFileSync(path: string, data: Uint8Array): void;
}

/** Which of two columns of the camera's picture have a player in them (left to right, as the camera sees). */
export const SEATS_CAMERAS = {
  "alone-left": [true, false],
  "alone-right": [false, true],
  pair: [true, true],
} as const;

export type SeatsCamera = keyof typeof SEATS_CAMERAS;

export const seatsFixture = (name: SeatsCamera): string => `${ROOT}node_modules/.cache/super-claude-bros-e2e/seats-${name}.y4m`;

const WIDTH = 1280;
const HEIGHT = 720;
const FRAMES = 3;

/** Makes the videos that are not made yet. */
export async function makeSeatsFixtures(): Promise<void> {
  const fs = (await import("node:fs" as string)) as Files;
  const wanted = (Object.keys(SEATS_CAMERAS) as SeatsCamera[]).filter((name) => !fs.existsSync(seatsFixture(name)));
  if (!wanted.length) return;
  const jpeg = fs.readFileSync(`${ROOT}e2e/fixtures/hand.jpg`).toString("base64");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
  try {
    const page = await browser.newPage();
    for (const name of wanted) {
      const columns: readonly boolean[] = SEATS_CAMERAS[name];
      const pixels = await page.evaluate(
        async ({ jpeg, width, height, columns }) => {
          const image = new Image();
          image.src = `data:image/jpeg;base64,${jpeg}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d")!;
          // A plain wall: the photo behind the hand confuses the detector when it is not the only one in the picture.
          context.fillStyle = "#c9a98a";
          context.fillRect(0, 0, width, height);
          // The photo of one hand, as big as it can be in its column: MediaPipe finds this hand only when it is large (a
          // fist a fifth of the picture's width), and finds no two of them side by side, so each player holds one.
          const scale = (0.8 * height) / image.height;
          columns.forEach((occupied, i) => {
            if (!occupied) return;
            const cx = ((i + 0.5) / columns.length) * width;
            context.drawImage(image, cx - (image.width * scale) / 2, 0.1 * height, image.width * scale, image.height * scale);
          });
          const data = context.getImageData(0, 0, width, height).data;
          let binary = "";
          for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
          return btoa(binary);
        },
        { jpeg, width: WIDTH, height: HEIGHT, columns },
      );
      const frame = toI420(Uint8Array.from(atob(pixels), (c) => c.charCodeAt(0)), WIDTH, HEIGHT);
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
      const path = seatsFixture(name);
      fs.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      fs.writeFileSync(path, video);
    }
  } finally {
    await browser.close();
  }
}
