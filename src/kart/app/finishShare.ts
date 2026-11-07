/**
 * The finish-line photos as one picture to keep or pass round (the results' Share): 1200 x 630, the size link previews
 * use, as the arcade's results card is. The track's postcard, blurred and darkened, behind; Grip Prix's badge and name,
 * the track and its laps; and the players' cards as the results lay them out (arrangePodium: the best placed the
 * biggest), each with their place, name and time stamped on it, the winner's ringed in gold. It is made only when the
 * player asks, and goes only where they send it (ui/share.ts): to the system's share sheet, or their Downloads.
 */
import { shareOrSave } from "../../ui/share";
import { layoutPodium } from "./finishPhotos";
import type { ShotCard } from "./finishGallery";
import { raceTime } from "./format";
import { paintFx, paintGraded, paintStamp } from "./photoFx/compose";
import { LOOP, lookFor, type Look } from "./photoFx/looks";
import { postcardUrl } from "./trackArt";

/** One card as the results show it: its shape, and the decoded photo (or, for a player with none, their driver's portrait). */
export interface SharedCard {
  card: ShotCard;
  aspect: number;
  image: HTMLImageElement | null;
  /** The image is their photo (else it is a portrait, standing on their colour). */
  photo: boolean;
}

export interface SharedResults {
  cards: readonly SharedCard[];
  trackId: string;
  trackName: string;
  /** "3 Laps", "Race 2 of 4" and the like: what the eyebrow says beside the track. */
  detail: string;
}

const WIDTH = 1200;
const HEIGHT = 630;
const MARGIN = 48;
const GAP = 16;
/** The cards' space: under the heading, over the footer. */
const AREA = { x: MARGIN, y: 128, width: WIDTH - 2 * MARGIN, height: 456 };

const MEDALS: Record<number, [string, string, string, string]> = {
  1: ["#fff1a8", "#ffd60a", "#f0a500", "#1b1500"],
  2: ["#f7f9fc", "#cfd6e2", "#9ba5b6", "#1a2130"],
  3: ["#ffd0a0", "#e39a5c", "#b36a2f", "#2a1503"],
};

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  image.src = url;
  return image.decode().then(
    () => image,
    () => null,
  );
}

/** What the shared files are called: nintenthropic-grip-prix-<track>.png (or .mp4 / .webm for the clip). */
export function shareName(trackName: string, ext: "png" | "mp4" | "webm"): string {
  const slug = `grip prix ${trackName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `nintenthropic-${slug}.${ext}`;
}

/** The shared picture, ready to draw at any moment of the effects' loop: the still parts are drawn once. */
export interface ShareScene {
  canvas: HTMLCanvasElement;
  /** Draws the picture with the effects at `t` seconds into their loop. */
  draw(t: number): void;
  /** The moment the still picture freezes on: the effects at their best. */
  peak: number;
}

/** The results' photos as a scene: the backdrop and heading drawn once, the cards (graded, with effects) on every draw. */
export async function makeScene(results: SharedResults): Promise<ShareScene> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d")!;
  const look = lookFor(results.trackId);
  const [postcard, badge, wordmark] = await Promise.all([loadImage(postcardUrl(results.trackId)), loadImage("assets/kart/icon.png"), loadImage("assets/brand/wordmark.png")]);

  // The still parts, once: the track's light behind it all (the menus' sky where there is no postcard), the heading, the footer.
  const back = document.createElement("canvas");
  back.width = WIDTH;
  back.height = HEIGHT;
  const still = back.getContext("2d")!;
  const sky = still.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#1649a8");
  sky.addColorStop(1, "#0a1f4a");
  still.fillStyle = sky;
  still.fillRect(0, 0, WIDTH, HEIGHT);
  if (postcard) {
    still.save();
    still.filter = "blur(22px) saturate(1.2)";
    const scale = Math.max((WIDTH + 80) / postcard.naturalWidth, (HEIGHT + 80) / postcard.naturalHeight);
    const w = postcard.naturalWidth * scale;
    const h = postcard.naturalHeight * scale;
    still.drawImage(postcard, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    still.restore();
  }
  still.fillStyle = "rgba(4, 12, 32, 0.56)";
  still.fillRect(0, 0, WIDTH, HEIGHT);

  const font = getComputedStyle(document.body).fontFamily;
  const textOn =
    (target: CanvasRenderingContext2D): Text =>
    (words, x, y, size, weight, colour, align = "left", tracking = 0) => {
      target.font = `${weight} ${size}px ${font}`;
      target.fillStyle = colour;
      target.textAlign = align;
      target.letterSpacing = `${tracking}px`;
      target.fillText(words, x, y);
      target.letterSpacing = "0px";
      target.textAlign = "left";
      return target.measureText(words).width;
    };
  const stillText = textOn(still);
  const text = textOn(context);

  // The heading: the badge and the name on the left, the track on the right.
  let x = MARGIN;
  if (badge) {
    still.save();
    roundRect(still, MARGIN, 40, 52, 52, 13);
    still.clip();
    still.drawImage(badge, MARGIN, 40, 52, 52);
    still.restore();
    x += 66;
  }
  stillText("Grip Prix", x, 79, 36, 800, "#fff", "left", -0.6);
  stillText(results.trackName, WIDTH - MARGIN, 70, 26, 700, "#fff", "right", -0.3);
  stillText(results.detail.toUpperCase(), WIDTH - MARGIN, 96, 15, 600, "rgba(235,235,245,0.7)", "right", 1.1);
  // The footer: the logo, or its name where the logo did not load.
  if (wordmark && wordmark.naturalWidth > 0) {
    const h = 26;
    const w = (wordmark.naturalWidth / wordmark.naturalHeight) * h;
    still.globalAlpha = 0.85;
    still.drawImage(wordmark, WIDTH - MARGIN - w, HEIGHT - 16 - h, w, h);
    still.globalAlpha = 1;
  } else {
    stillText("Nintenthropic", WIDTH - MARGIN, HEIGHT - 18, 17, 700, "rgba(235,235,245,0.6)", "right", -0.2);
  }

  // The cards, as the results lay them out, in the middle of their space.
  const laid = layoutPodium(
    results.cards.map((shared) => shared.aspect),
    AREA.width,
    AREA.height,
    GAP,
  );
  const left = AREA.x + (AREA.width - laid.width) / 2;
  const top = AREA.y + (AREA.height - laid.height) / 2;
  const field = Math.max(0, ...results.cards.map((shared) => shared.card.field ?? 0));
  const draw = (t: number) => {
    context.drawImage(back, 0, 0);
    laid.boxes.forEach((box, i) => drawCard(context, results.cards[i]!, left + box.x, top + box.y, box.w, box.h, i === 0 && laid.boxes.length > 1, text, look, field, t, font));
  };
  return { canvas, draw, peak: look.peak };
}

/** The results' photos as one picture: the effects frozen on their best frame (or at `t`). */
export async function drawPhotoCard(results: SharedResults, t?: number): Promise<HTMLCanvasElement> {
  const scene = await makeScene(results);
  scene.draw(t ?? scene.peak);
  return scene.canvas;
}

type Text = (words: string, x: number, y: number, size: number, weight: number, colour: string, align?: CanvasTextAlign, tracking?: number) => number;

function drawCard(context: CanvasRenderingContext2D, shared: SharedCard, x: number, y: number, w: number, h: number, lead: boolean, text: Text, look: Look, field: number, t: number, font: string): void {
  const { card, image, photo } = shared;
  const radius = Math.min(22, h * 0.1);
  context.save();
  roundRect(context, x, y, w, h, radius);
  context.clip();
  // A portrait stands on its player's colour, deepened.
  const ground = context.createLinearGradient(x, y, x + w * 0.4, y + h);
  ground.addColorStop(0, card.colour);
  ground.addColorStop(1, "#0a1a3e");
  context.fillStyle = ground;
  context.fillRect(x, y, w, h);
  if (!photo) {
    context.fillStyle = "rgba(10, 26, 62, 0.5)";
    context.fillRect(x, y, w, h);
  }
  if (image) {
    if (photo) {
      paintGraded(context, image, x, y, w, h, look);
    } else {
      const size = h * 0.86;
      context.drawImage(image, x + (w - size) / 2, y + h - size, size, size);
    }
  }
  paintFx(context, x, y, w, h, t, look, card.place, card.field ?? field);
  // The stamp: a shade at the foot, the medal, the name, the time.
  const shade = context.createLinearGradient(0, y + h * 0.55, 0, y + h);
  shade.addColorStop(0, "rgba(3, 10, 28, 0)");
  shade.addColorStop(1, "rgba(3, 10, 28, 0.74)");
  context.fillStyle = shade;
  context.fillRect(x, y + h * 0.55, w, h * 0.45);
  const size = lead ? 24 : h < 150 ? 15 : 18;
  const pad = lead ? 18 : 12;
  const base = y + h - pad - size * 0.32;
  const medalW = size * 2.3;
  const medalH = size * 1.5;
  const medalY = base - size * 1.08;
  const medal = MEDALS[card.place];
  if (medal) {
    const fill = context.createLinearGradient(x + pad, medalY, x + pad + medalW, medalY + medalH);
    fill.addColorStop(0, medal[0]);
    fill.addColorStop(0.5, medal[1]);
    fill.addColorStop(1, medal[2]);
    context.fillStyle = fill;
  } else {
    context.fillStyle = "rgba(255, 255, 255, 0.18)";
  }
  roundRect(context, x + pad, medalY, medalW, medalH, medalH / 2);
  context.fill();
  text(card.placeLabel, x + pad + medalW / 2, base, size * 0.8, 750, medal ? medal[3] : "#fff", "center");
  const time = raceTime(card.time);
  const timeWidth = text(time, x + w - pad, base, size, 600, "rgba(255,255,255,0.9)", "right");
  // The name, cut short with an ellipsis where the card is narrow.
  const room = w - pad * 2 - medalW - timeWidth - size * 1.2;
  context.font = `${lead ? 700 : 650} ${size}px ${getComputedStyle(document.body).fontFamily}`;
  let name = card.name;
  while (name.length > 1 && context.measureText(name).width > room) name = name.slice(0, -1);
  if (name !== card.name) name = `${name.slice(0, -1)}…`;
  if (room > size) text(name, x + pad + medalW + size * 0.55, base, size, lead ? 700 : 650, "#fff");
  paintStamp(context, x, y, w, h, look, card.placeLabel, font);
  context.restore();
  // The edge: a hairline, gold round the winner.
  context.save();
  roundRect(context, x + 0.75, y + 0.75, w - 1.5, h - 1.5, radius);
  context.lineWidth = card.place === 1 ? 2.5 : 1.5;
  context.strokeStyle = card.place === 1 ? "rgba(255, 214, 10, 0.9)" : "rgba(255, 255, 255, 0.18)";
  context.stroke();
  context.restore();
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
}

/** Makes the picture and shares or saves it. */
export async function sharePhotos(results: SharedResults): Promise<void> {
  const canvas = await drawPhotoCard(results);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  await shareOrSave(blob, shareName(results.trackName, "png"), "Nintenthropic · Grip Prix");
}

/** The video types to try, best first: mp4 where the browser makes it (Safari, newer Chrome), else webm. */
const CLIP_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

/** The clip type this browser can record, or null (no recorder, or no canvas stream): the clip is not offered then. */
export function clipType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  return CLIP_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** The file extension for a recorded type. */
export const clipExtension = (type: string): "mp4" | "webm" => (type.startsWith("video/mp4") ? "mp4" : "webm");

/** Records the scene's effects for one LOOP, as the browser's best video type; null where it cannot (or fails). */
export async function recordClip(scene: ShareScene, type: string): Promise<Blob | null> {
  const FPS = 30;
  let stream: MediaStream;
  let recorder: MediaRecorder;
  try {
    stream = scene.canvas.captureStream(FPS);
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => event.data.size > 0 && chunks.push(event.data));
  const done = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.addEventListener("error", () => resolve(), { once: true });
  });
  const from = scene.peak - 0.6;
  const frameAt = (seconds: number) => scene.draw((from + seconds + LOOP) % LOOP);
  frameAt(0);
  try {
    recorder.start(250);
  } catch {
    return null;
  }
  const start = performance.now();
  // Timed by a timer, not by animation frames: a hidden tab stops those, and the recording must still end.
  let hidden = false;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (document.hidden) hidden = true;
      const t = (performance.now() - start) / 1000;
      if (hidden || t >= LOOP) {
        clearInterval(timer);
        resolve();
      } else {
        frameAt(t);
      }
    }, 1000 / FPS);
  });
  const stopped = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  if (recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      stopped();
      return null;
    }
  }
  // A recorder that never says it stopped must not hold the share buttons for ever.
  await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
  stopped();
  // Without the codecs in its type, so the share sheet takes it as a plain mp4 or webm.
  return !hidden && chunks.length ? new Blob(chunks, { type: type.split(";")[0] }) : null;
}

/** Records the short looping clip and shares or saves it; false where this browser cannot (the picture is still offered). */
export async function shareClip(results: SharedResults): Promise<boolean> {
  const type = clipType();
  if (!type) return false;
  const scene = await makeScene(results);
  const blob = await recordClip(scene, type);
  if (!blob) return false;
  await shareOrSave(blob, shareName(results.trackName, clipExtension(type)), "Nintenthropic · Grip Prix");
  return true;
}
