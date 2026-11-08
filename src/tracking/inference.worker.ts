/**
 * The hand landmarker - and, for a game that reads the eye, the face
 * landmarker - off the page's thread.
 *
 * Reading a hand takes 10-40 ms a frame, and on the page's own thread every
 * one of those milliseconds is a millisecond the game cannot draw in: at 30
 * camera frames a second it cost the render loop two frames out of every
 * four. Here it runs beside the game instead, on its own WebGL context.
 *
 * The face is read on the same frame after the hand, and its result sent
 * after the hand's: the aim never waits for the eye.
 *
 * Players sharing a camera are each read by a worker of their own (tracker.ts,
 * lanes), handed their column of the picture. Asked to ("try", adapt.ts), a
 * worker makes a landmarker on the other delegate beside its own, reads frames
 * with each in turn, and keeps the quicker.
 *
 * A landmarker whose GPU went (Chrome restarted its GPU's process) finds
 * nothing from then on, without a word: it is noticed after the frame it
 * failed on and made again (gpu.ts, rebuild).
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { HandLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker, eyesFrom, type Fileset } from "./face";
import { GpuWatch } from "./gpu";
import type { FromWorker, ToWorker } from "./protocol";
import { seenHands } from "./hands";
import { gpuName, isSoftwareGpu } from "../engine/tier";
import { TileSchedule, joinTiles, tileRects } from "./tiles";
import type { FaceReading, SeenHand } from "./types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let landmarker: HandLandmarker | null = null;
/**
 * Players sharing a camera: one more landmarker for each tile after the first
 * (see tiles.ts), each reading its own tile of the picture. Empty otherwise.
 */
let more: HandLandmarker[] = [];
const tileCanvases: OffscreenCanvas[] = [];
let schedule: TileSchedule | null = null;
let face: FaceLandmarker | null = null;
/**
 * Where the runtime's files are on the site, for a face landmarker added
 * later (each landmarker starts its own copy of the runtime; by then the
 * browser has the files cached).
 */
let later: Fileset | null = null;
let prefer: "GPU" | "CPU" = "GPU";
/** The delegate the hand's landmarker runs on. */
let delegate: "GPU" | "CPU" = "CPU";
/** Makes another hand landmarker like the first, on a delegate (for a try of the other one). */
let makeAnother: ((delegate: "GPU" | "CPU") => Promise<HandLandmarker>) | null = null;
/** The contexts of the landmarkers reading on the GPU, asked after every frame (gpu.ts). */
const gpu = new GpuWatch();
/** The face's model, kept to make the face landmarker again should its GPU go. */
let faceModel: ArrayBuffer | null = null;
/** Landmarkers being made again, their GPU gone (until they are, what they read is answered with nothing found). */
let rebuilding = false;
/** How often the GPU has gone under this worker: once, the landmarkers go back to it; again, they read on the CPU. */
let losses = 0;
/** When the next try to make lost landmarkers again may begin, ms (one that failed waits a while). */
let rebuildAfter = 0;

/**
 * A try of the other delegate (protocol "try"): the other landmarker, once made, reads every other camera frame, and
 * after `frames` frames the quicker of the two is kept. Each keeps following the hands on its own frames.
 */
interface Trial {
  delegate: "GPU" | "CPU";
  other: HandLandmarker | null;
  frames: number;
  turn: number;
  times: { mine: number[]; other: number[] };
}
let trial: Trial | null = null;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

function startTrial(message: Extract<ToWorker, { type: "try" }>): void {
  // One landmarker reading the whole picture only (a worker with tiles of its own does not try), one try at a time.
  if (trial || rebuilding || more.length || !makeAnother || message.delegate === delegate) {
    post({ type: "tried", kept: delegate, times: { GPU: null, CPU: null } });
    return;
  }
  const mine = delegate;
  const current: Trial = { delegate: message.delegate, other: null, frames: Math.max(4, message.frames), turn: 0, times: { mine: [], other: [] } };
  trial = current;
  makeAnother(message.delegate).then(
    (made) => {
      if (trial === current) current.other = made;
      else made.close();
    },
    (error: unknown) => {
      console.warn(`Hand tracking on the ${message.delegate} is unavailable here.`, error);
      if (trial !== current) return;
      trial = null;
      post({ type: "tried", kept: mine, times: { [mine]: null, [message.delegate]: null } as { GPU: null; CPU: null } });
    },
  );
}

/** The landmarker to read this frame with: during a try, the two take turns. Counts the try along. */
function trialReader(): { landmarker: HandLandmarker; which: "mine" | "other" } {
  const current = trial;
  if (!current?.other) return { landmarker: landmarker!, which: "mine" };
  return current.turn++ % 2 ? { landmarker: current.other, which: "other" } : { landmarker: landmarker!, which: "mine" };
}

/** Closes a landmarker no longer wanted; one that will not close (its GPU gone) is let go anyway. */
function letGo(landmarker: { close(): void }): void {
  try {
    landmarker.close();
  } catch (error) {
    console.warn("A landmarker could not be closed.", error);
  }
}

/**
 * A frame read during a try: noted, and once there are enough of each, the quicker landmarker is kept. A read that
 * failed says nothing about speed; one the other landmarker failed ends the try, keeping this one.
 */
function trialRead(which: "mine" | "other", ms: number, ok: boolean): void {
  const current = trial;
  if (!current?.other) return;
  if (!ok) {
    if (which === "mine") return;
    letGo(current.other);
    trial = null;
    const times = { GPU: null as number | null, CPU: null as number | null };
    post({ type: "tried", kept: delegate, times });
    return;
  }
  current.times[which].push(ms);
  // The first read of a new landmarker builds its shaders: it is left out.
  const mine = median(current.times.mine) ?? Infinity;
  const other = median(current.times.other.slice(1)) ?? Infinity;
  // Plainly the quicker over a few reads each (twice as quick): no need to wait out the try (a GPU drawn in software reads
  // in seconds).
  const plain = current.times.mine.length >= 2 && current.times.other.length >= 3 && (other * 2 < mine || mine * 2 < other);
  if (!plain && current.times.mine.length + current.times.other.length < current.frames) return;
  const old = delegate;
  if (other < mine * 0.85) {
    letGo(landmarker!);
    landmarker = current.other;
    delegate = current.delegate;
  } else {
    letGo(current.other);
  }
  trial = null;
  const times = { GPU: null as number | null, CPU: null as number | null };
  times[old] = mine;
  times[current.delegate] = Number.isFinite(other) ? other : null;
  post({ type: "tried", kept: delegate, times });
}

const post = (message: FromWorker) => scope.postMessage(message);

async function addFace(model: ArrayBuffer, files: Fileset | null = later, on: "GPU" | "CPU" = prefer): Promise<"GPU" | "CPU"> {
  if (!files) throw new Error("the runtime is not loaded");
  faceModel = model;
  // A module worker loads the runtime's loader with import(), which runs it
  // once: it hands MediaPipe its factory (self.ModuleFactory) the first
  // time only, and the hand's landmarker took that. The factory is the
  // module's default export, so the second landmarker is given it again.
  const loader = (await import(/* @vite-ignore */ files.wasmLoaderPath)) as { default?: unknown };
  const global = self as unknown as { ModuleFactory?: unknown };
  global.ModuleFactory ??= loader.default;
  const made = await createFaceLandmarker(files, model, on, gpu);
  const old = face;
  face = made.landmarker;
  if (old) letGo(old);
  return made.delegate;
}

/** Whether this worker's WebGL is drawn in software (SwiftShader, llvmpipe...). */
function softwareGpu(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2") ?? new OffscreenCanvas(1, 1).getContext("webgl");
    return gl ? isSoftwareGpu(gpuName(gl)) : false;
  } catch {
    return false;
  }
}

async function init(message: Extract<ToWorker, { type: "init" }>): Promise<void> {
  const binary = URL.createObjectURL(new Blob([message.wasm], { type: "application/wasm" }));
  const files = { wasmLoaderPath: message.loader, wasmBinaryPath: binary };
  later = { wasmLoaderPath: message.loader, wasmBinaryPath: message.binary };
  prefer = message.prefer;
  const tiles = Math.max(1, Math.round(message.tiles ?? 1));
  const create = async (delegate: "GPU" | "CPU", runtime: Fileset = files) => {
    const canvas = gpu.canvasFor(delegate);
    const made = await HandLandmarker.createFromOptions(runtime, {
      runningMode: "VIDEO",
      // One hand for the shooting games, deliberately: a second costs time
      // (measured in input/trust.ts, which keeps a passer-by's hand from
      // taking the aim). Grip Prix asks for two for each player on the
      // camera. Players sharing a camera in tiles (tiles.ts) get their share
      // of the hands in each tile.
      numHands: tiles > 1 ? Math.max(1, Math.ceil((message.hands ?? 2) / tiles)) : (message.hands ?? 1),
      minHandDetectionConfidence: message.confidence ?? 0.5,
      minHandPresenceConfidence: message.confidence ?? 0.5,
      minTrackingConfidence: 0.5,
      baseOptions: { modelAssetBuffer: new Uint8Array(message.model), delegate },
      ...(canvas ? { canvas } : {}),
    });
    return gpu.watch(made, canvas);
  };
  try {
    delegate = "CPU";
    // A GPU that is the CPU drawing (a blocklisted driver's fallback) reads a hand in seconds where the CPU takes tens of ms.
    if (message.prefer === "GPU" && softwareGpu()) console.info("The GPU here is drawn in software: hand tracking runs on the CPU.");
    else if (message.prefer === "GPU") {
      try {
        landmarker = await create("GPU");
        delegate = "GPU";
      } catch (error) {
        console.warn("Hand tracking on the GPU is unavailable; using the CPU.", error);
      }
    }
    landmarker ??= await create("CPU");
    makeAnother = async (other) => {
      // As for the tiles below: the runtime's factory again, and the site's files (cached by now).
      const loader = (await import(/* @vite-ignore */ files.wasmLoaderPath)) as { default?: unknown };
      const global = self as unknown as { ModuleFactory?: unknown };
      global.ModuleFactory ??= loader.default;
      return create(other, later!);
    };
    if (tiles > 1) {
      // A landmarker for each tile after the first. Each starts its own copy of the runtime,
      // handed the factory again (see addFace), from the site's files, which are cached by now.
      const loader = (await import(/* @vite-ignore */ files.wasmLoaderPath)) as { default?: unknown };
      const global = self as unknown as { ModuleFactory?: unknown };
      more = [];
      for (let i = 1; i < tiles; i++) {
        global.ModuleFactory ??= loader.default;
        more.push(await create(delegate, later));
      }
    }
    // The face is optional: a face that will not start leaves the hand playing.
    let withFace = false;
    if (message.face) {
      try {
        await addFace(message.face, files);
        withFace = true;
      } catch (error) {
        console.warn("Face tracking is unavailable.", error);
      }
    }
    post({ type: "ready", delegate, face: withFace });
  } catch (error) {
    post({ type: "failed", message: String(error) });
  } finally {
    URL.revokeObjectURL(binary);
  }
}

/**
 * Players sharing a camera: each tile of the picture to its own landmarker, the hands joined (tiles.ts).
 * A tile that has had no hand for a few frames is read only now and then (TileSchedule); the others, always.
 */
function readTiles(image: VideoFrame | ImageBitmap, timestamp: number): SeenHand[] {
  const landmarkers = [landmarker!, ...more];
  if (schedule?.count !== landmarkers.length) schedule = new TileSchedule(landmarkers.length);
  const width = "displayWidth" in image ? image.displayWidth : image.width;
  const height = "displayHeight" in image ? image.displayHeight : image.height;
  const due = schedule.next();
  const found = tileRects(landmarkers.length, width, height).map((tile, i) => {
    if (!due[i]) return { tile, hands: [] as SeenHand[], read: false };
    let canvas = tileCanvases[i];
    if (!canvas || canvas.width !== tile.width || canvas.height !== tile.height) canvas = tileCanvases[i] = new OffscreenCanvas(tile.width, tile.height);
    // The whole frame shifted onto the tile's canvas, not drawImage's source rectangle, which Safari ignores for a
    // VideoFrame (see cropped below and cut.ts).
    canvas.getContext("2d")!.drawImage(image, -tile.x, -tile.y);
    return { tile, hands: seenHands(landmarkers[i]!.detectForVideo(canvas, timestamp)), read: true };
  });
  schedule.record(found.map((one) => (one.read ? one.hands.length : null)));
  return joinTiles(found, width, height);
}

/**
 * A part of the picture, drawn on a canvas of its own (where the page could not cut the frame itself). The whole frame
 * is drawn, shifted so that the part lands on the canvas, rather than with drawImage's source rectangle: Safari ignores
 * that rectangle for a VideoFrame (as it does a cut, see cut.ts) and draws the whole picture squeezed into the part.
 * The canvas clips what lies outside it.
 */
function cropped(image: VideoFrame | ImageBitmap, crop: { x: number; y: number; width: number; height: number }): OffscreenCanvas {
  let canvas = tileCanvases[0];
  if (!canvas || canvas.width !== crop.width || canvas.height !== crop.height) canvas = tileCanvases[0] = new OffscreenCanvas(crop.width, crop.height);
  canvas.getContext("2d")!.drawImage(image, -crop.x, -crop.y);
  return canvas;
}

/** Whether any landmarker here has lost its GPU. */
const anyLost = (): boolean => gpu.lost(landmarker) || more.some((one) => gpu.lost(one)) || gpu.lost(trial?.other) || gpu.lost(face);

/**
 * Makes again every landmarker whose GPU went: on the GPU the first time (Chrome brings its GPU back within a second
 * or so), on the CPU after that, or where the GPU will not have it. A try of the other delegate under way ends, as
 * one that could not be made does. The landmarkers they replace are let go once the new ones are made.
 */
async function rebuild(): Promise<void> {
  rebuilding = true;
  losses++;
  // What was lost was on the GPU: back to it once, unless it has come back drawn in software.
  const on: "GPU" | "CPU" = losses === 1 && !softwareGpu() ? "GPU" : "CPU";
  try {
    const current = trial;
    if (current) {
      trial = null;
      if (current.other) letGo(current.other);
      post({ type: "tried", kept: delegate, times: { GPU: null, CPU: null } });
    }
    if (gpu.lost(landmarker) || more.some((one) => gpu.lost(one))) {
      const old = [landmarker!, ...more];
      const make = async (which: "GPU" | "CPU") => {
        const made: HandLandmarker[] = [];
        try {
          for (let i = 0; i < old.length; i++) made.push(await makeAnother!(which));
        } catch (error) {
          made.forEach(letGo);
          throw error;
        }
        return made;
      };
      let now = on;
      let made: HandLandmarker[];
      try {
        made = await make(on);
      } catch (error) {
        if (on === "CPU") throw error;
        console.warn("Hand tracking on the GPU is unavailable since it restarted; using the CPU.", error);
        now = "CPU";
        made = await make("CPU");
      }
      [landmarker, ...more] = made as [HandLandmarker, ...HandLandmarker[]];
      delegate = now;
      old.forEach(letGo);
      post({ type: "restarted", delegate });
    }
    if (gpu.lost(face) && faceModel) await addFace(faceModel, later, on);
    console.info(`Tracking started again after the GPU restarted (the hand on the ${delegate}).`);
  } catch (error) {
    rebuildAfter = performance.now() + 5000;
    console.warn("Tracking could not be started again after the GPU restarted; trying again in a moment.", error);
  } finally {
    rebuilding = false;
  }
}

function read(message: Extract<ToWorker, { type: "frame" }>): void {
  const began = performance.now();
  let hands: SeenHand[] = [];
  // A GPU gone since the last frame: nothing is found on it, so what read on it waits for the landmarkers made again.
  if (!rebuilding && makeAnother && began >= rebuildAfter && anyLost()) void rebuild();
  const handsLost = gpu.lost(landmarker) || more.some((one) => gpu.lost(one));
  const withFace = message.face === true && face !== null && !gpu.lost(face);
  let which: "mine" | "other" = "mine";
  let ok = true;
  try {
    try {
      if (handsLost) ok = false;
      else if (more.length) hands = readTiles(message.image, message.timestamp);
      else {
        const reader = trialReader();
        which = reader.which;
        hands = seenHands(reader.landmarker.detectForVideo(message.crop ? cropped(message.image, message.crop) : message.image, message.timestamp));
      }
    } catch (error) {
      // One bad frame (a camera mid-reconfiguration) is skipped, not fatal.
      ok = false;
      console.warn("A camera frame could not be read.", error);
    }
    const inference = performance.now() - began;
    post({
      type: "result",
      sequence: message.sequence,
      capturedAt: message.capturedAt,
      hands,
      inference,
      face: withFace,
    });
    trialRead(which, inference, ok);
    if (withFace) {
      const faceBegan = performance.now();
      let eyes: FaceReading | null = null;
      try {
        eyes = eyesFrom(face!.detectForVideo(message.image, message.timestamp));
      } catch (error) {
        console.warn("A camera frame's face could not be read.", error);
      }
      post({ type: "face-result", sequence: message.sequence, capturedAt: message.capturedAt, eyes, inference: performance.now() - faceBegan });
    }
  } finally {
    // An unclosed camera frame holds one of the camera's few buffers: a handful and the camera stalls.
    message.image.close();
  }
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") void init(message);
  else if (message.type === "face") {
    addFace(message.model).then(
      (delegate) => post({ type: "face-ready", delegate }),
      (error: unknown) => post({ type: "face-failed", message: String(error) }),
    );
  } else if (message.type === "try") {
    startTrial(message);
  } else if (message.type === "frame") {
    if (landmarker) read(message);
    else message.image.close();
  }
};
