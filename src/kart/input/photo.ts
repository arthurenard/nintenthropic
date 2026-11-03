/**
 * The finish-line photo: a still of the camera the wheel reads, taken as a player's kart crosses the line, for the
 * results. Mirrored, as the player sees themself in the wheel's picture; a player sharing the camera gets their own
 * column of it (their `Seat`), and one picture or column of an awkward shape is cut round the hands the wheel sees.
 *
 * The still is taken at once (`grabPhoto` draws the video's current frame into a small canvas, about what drawing the
 * corner picture costs) and made into a JPEG afterwards, off the race's frame (`encodePhoto`): small enough to send to
 * the room (MAX_PHOTO_CHARS). Nothing here keeps or sends it.
 *
 * The geometry (photoCrop, photoSize) is plain functions, tested without a DOM.
 */
import { MAX_PHOTO_CHARS } from "../contract";
import { seatZone, type Seat } from "./wheel";

/** How narrow and how wide a photo may be (its width over its height): a crowd's narrow column is cut to 3:4 round its player. */
export const PHOTO_ASPECT = { min: 3 / 4, max: 16 / 9 } as const;
/** The photo's longest side, pixels, and the most pixels it has: enough for a card on the results, small enough to send. */
export const PHOTO_SIDE = 480;
export const PHOTO_PIXELS = 140_000;
/**
 * A photo cut shorter than its column (a crowd's) puts the hands this far down it: the face is above the wheel. With no
 * hands seen it is cut from a little above the middle, where heads are.
 */
const HANDS_DOWN = 0.62;
const NO_HANDS_TOP = 0.35;

/** A region of the camera's own (unmirrored) picture, in its pixels. */
export interface PhotoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A hand where the wheel sees it: the palm's centre in the mirrored picture, 0..1 (x right, y down), as WheelHand. */
export interface PhotoHand {
  x: number;
  y: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The part of a `width` x `height` camera picture that is one player's photo: their column of it (`seat`) or the whole
 * picture, cut to between PHOTO_ASPECT.min and .max round their `hands` (centred on them across a picture too wide, with
 * them below the middle of a column too narrow) or, with none seen, round the middle. In the camera's own pixels: the
 * leftmost column the player sees is the camera's rightmost.
 */
export function photoCrop(width: number, height: number, seat: Seat | null, hands: readonly PhotoHand[] = []): PhotoCrop {
  const [from, to] = seat ? seatZone(seat) : [0, 1];
  // In the mirrored picture's pixels first: x across (from the player's left), y down.
  const zone = { x: from * width, width: (to - from) * width, height };
  let x = zone.x;
  let y = 0;
  let w = zone.width;
  let h = zone.height;
  const seen = hands.length > 0;
  const handX = seen ? (hands.reduce((sum, hand) => sum + hand.x, 0) / hands.length) * width : 0;
  const handY = seen ? (hands.reduce((sum, hand) => sum + hand.y, 0) / hands.length) * height : 0;
  if (w / h < PHOTO_ASPECT.min) {
    h = w / PHOTO_ASPECT.min;
    y = clamp(seen ? handY - h * HANDS_DOWN : (height - h) * NO_HANDS_TOP, 0, height - h);
  } else if (w / h > PHOTO_ASPECT.max) {
    w = h * PHOTO_ASPECT.max;
    x = clamp(seen ? handX - w / 2 : zone.x + (zone.width - w) / 2, zone.x, zone.x + zone.width - w);
  }
  // Mirrored back into the camera's own picture.
  const left = Math.round(width - (x + w));
  const top = Math.round(y);
  return { x: left, y: top, width: Math.min(width - left, Math.round(w)), height: Math.min(height - top, Math.round(h)) };
}

/**
 * The photo's size in pixels for a crop: its shape, its longest side at most PHOTO_SIDE and its area at most
 * PHOTO_PIXELS, never larger than the crop.
 */
export function photoSize(crop: Pick<PhotoCrop, "width" | "height">): { width: number; height: number } {
  const scale = Math.min(1, PHOTO_SIDE / Math.max(crop.width, crop.height), Math.sqrt(PHOTO_PIXELS / (crop.width * crop.height)));
  return { width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)) };
}

/**
 * The camera's picture now, as one player's photo: their part of it (photoCrop), mirrored, in a canvas of photoSize.
 * Null while the video has no picture. Taken at once, so the moment is the one asked for.
 */
export function grabPhoto(video: HTMLVideoElement, seat: Seat | null, hands: readonly PhotoHand[] = []): HTMLCanvasElement | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  // HAVE_CURRENT_DATA: there is a frame to draw.
  if (!width || !height || video.readyState < 2) return null;
  const crop = photoCrop(width, height, seat, hands);
  const size = photoSize(crop);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  // As in a mirror, the way the wheel's picture shows the player.
  context.translate(size.width, 0);
  context.scale(-1, 1);
  try {
    context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  } catch {
    return null;
  }
  return canvas;
}

/** The qualities tried, best first, and the sizes after them: a busy picture that will not fit is made smaller. */
const QUALITIES = [0.8, 0.66, 0.52] as const;
const SHRINKS = [0.75, 0.5] as const;
const LOWEST = 0.52;

function toDataUrl(canvas: HTMLCanvasElement, quality: number): Promise<string | null> {
  return new Promise((resolve) => {
    // toBlob makes the JPEG away from the page's thread where the browser can; toDataURL would stop the race to.
    canvas.toBlob(
      (blob) => {
        if (!blob) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function shrunk(canvas: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  const context = small.getContext("2d");
  if (context) {
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, 0, 0, small.width, small.height);
  }
  return small;
}

/** A grabbed photo as a JPEG data URL of at most `maxChars` (lower quality, then smaller, until it fits), or null. */
export async function encodePhoto(canvas: HTMLCanvasElement, maxChars = MAX_PHOTO_CHARS): Promise<string | null> {
  for (const quality of QUALITIES) {
    const url = await toDataUrl(canvas, quality);
    if (url && url.startsWith("data:image/jpeg") && url.length <= maxChars) return url;
  }
  for (const scale of SHRINKS) {
    const url = await toDataUrl(shrunk(canvas, scale), LOWEST);
    if (url && url.startsWith("data:image/jpeg") && url.length <= maxChars) return url;
  }
  return null;
}
