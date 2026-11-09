/**
 * Cameras for players sharing one: Y4M videos of fists held like wheels in some columns of the picture and none in
 * the others, for Chrome's fake camera (--use-file-for-fake-video-capture), made like e2e/fixture.ts's picture of a
 * hand from the same photo (e2e/fixtures/hand.jpg, no one's own face): a plain wall and,
 * in each occupied column, the photo's one hand held up as big as the column lets it.
 *
 * Columns are the camera's own, left to right (the player sees the picture mirrored: the camera's right column is
 * the first seat's, on the left of the screen). "alone-right" is one player in the camera's right column with the
 * left empty, which a player sitting alone in the left seat of the mirrored picture makes; "pair" is both.
 * "two-players" is two players holding their fists like a wheel, drawn as e2e/crowd.js draws them (the photo's hand and
 * its mirror, a tenth of the picture wide, in a blurred room), for counting the players (Auto, e2e/seats.spec.ts): a
 * short loop of the wheels rocking, since MediaPipe finds the photo's fist held still in two pictures of three at best
 * (e2e/tracker.html, ?players=2&still=0.15: 1.2 hands a picture of 4; rocking, 3.7).
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

/** Players holding their fists like a wheel, side by side. */
export const CROWD_CAMERAS = { "two-players": 2 } as const;

export type SeatsCamera = keyof typeof SEATS_CAMERAS;
export type CrowdCamera = keyof typeof CROWD_CAMERAS;

export const seatsFixture = (name: SeatsCamera | CrowdCamera): string => `${ROOT}node_modules/.cache/super-claude-bros-e2e/seats-${name}.y4m`;

const WIDTH = 1280;
const HEIGHT = 720;
const FRAMES = 3;
/** The rocking wheels' loop: one rock to and fro. */
const CROWD_FRAMES = 16;

/** Makes the videos that are not made yet. */
export async function makeSeatsFixtures(): Promise<void> {
  const fs = (await import("node:fs" as string)) as Files;
  const wanted = ([...Object.keys(SEATS_CAMERAS), ...Object.keys(CROWD_CAMERAS)] as (SeatsCamera | CrowdCamera)[]).filter((name) => !fs.existsSync(seatsFixture(name)));
  if (!wanted.length) return;
  const jpeg = fs.readFileSync(`${ROOT}e2e/fixtures/hand.jpg`).toString("base64");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
  try {
    const page = await browser.newPage();
    for (const name of wanted) {
      const columns: readonly boolean[] = name in SEATS_CAMERAS ? SEATS_CAMERAS[name as SeatsCamera] : [];
      const crowd = name in CROWD_CAMERAS ? CROWD_CAMERAS[name as CrowdCamera] : 0;
      const frames = await page.evaluate(
        async ({ jpeg, width, height, columns, crowd, loop }) => {
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
          const pixels = (): string => {
            const data = context.getImageData(0, 0, width, height).data;
            let binary = "";
            for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
            return btoa(binary);
          };
          // Players' fists as e2e/crowd.js draws them: in a room (the photo, blurred), each player's two fists the photo's
          // hand and its mirror, a tenth of the picture wide (the fist is 250 of the photo's 427 pixels) and a hand-span
          // and a half apart, each wheel rocking.
          if (crowd > 0) {
            const room = document.createElement("canvas");
            room.width = width;
            room.height = height;
            const r = room.getContext("2d")!;
            r.filter = "blur(24px) brightness(0.7)";
            r.drawImage(image, -40, -40, width + 80, height + 80);
            const fist = width / 10;
            const size = fist / 250;
            const made: string[] = [];
            for (let frame = 0; frame < loop; frame++) {
              context.drawImage(room, 0, 0);
              for (let i = 0; i < crowd; i++) {
                const angle = 0.2 * Math.sin((2 * Math.PI * frame) / loop + i * 1.7);
                const half = 1.75 * fist;
                const cx = ((i + 0.5) / crowd) * width;
                for (const side of [-1, 1]) {
                  context.save();
                  context.translate(cx + side * half * Math.cos(angle), 0.6 * height + side * half * Math.sin(angle));
                  context.rotate(angle);
                  if (side < 0) context.scale(-1, 1);
                  context.drawImage(image, (-image.width / 2) * size, (-image.height / 2) * size, image.width * size, image.height * size);
                  context.restore();
                }
              }
              made.push(pixels());
            }
            return made;
          }
          // The photo of one hand, as big as it can be in its column: MediaPipe finds this hand only when it is large (a
          // fist a fifth of the picture's width), and finds no two of them side by side, so each player holds one.
          const scale = (0.8 * height) / image.height;
          columns.forEach((occupied, i) => {
            if (!occupied) return;
            const cx = ((i + 0.5) / columns.length) * width;
            context.drawImage(image, cx - (image.width * scale) / 2, 0.1 * height, image.width * scale, image.height * scale);
          });
          return [pixels()];
        },
        { jpeg, width: WIDTH, height: HEIGHT, columns, crowd, loop: CROWD_FRAMES },
      );
      // A still picture is shown a few times over; a loop, once each.
      const pictures = frames.map((one) => toI420(Uint8Array.from(atob(one), (c) => c.charCodeAt(0)), WIDTH, HEIGHT));
      const sequence = pictures.length > 1 ? pictures : Array.from({ length: FRAMES }, () => pictures[0]!);
      const header = new TextEncoder().encode(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`);
      const marker = new TextEncoder().encode("FRAME\n");
      const video = new Uint8Array(header.length + sequence.reduce((sum, frame) => sum + marker.length + frame.length, 0));
      video.set(header, 0);
      let offset = header.length;
      for (const frame of sequence) {
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
