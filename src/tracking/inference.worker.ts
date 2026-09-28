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
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { HandLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker, eyesFrom, type Fileset } from "./face";
import type { FromWorker, ToWorker } from "./protocol";
import type { FaceReading, Landmark } from "./types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let landmarker: HandLandmarker | null = null;
let face: FaceLandmarker | null = null;
/**
 * Where the runtime's files are on the site, for a face landmarker added
 * later (each landmarker starts its own copy of the runtime; by then the
 * browser has the files cached).
 */
let later: Fileset | null = null;
let prefer: "GPU" | "CPU" = "GPU";

const post = (message: FromWorker) => scope.postMessage(message);

async function addFace(model: ArrayBuffer, files: Fileset | null = later): Promise<"GPU" | "CPU"> {
  if (!files) throw new Error("the runtime is not loaded");
  // A module worker loads the runtime's loader with import(), which runs it
  // once: it hands MediaPipe its factory (self.ModuleFactory) the first
  // time only, and the hand's landmarker took that. The factory is the
  // module's default export, so the second landmarker is given it again.
  const loader = (await import(/* @vite-ignore */ files.wasmLoaderPath)) as { default?: unknown };
  const global = self as unknown as { ModuleFactory?: unknown };
  global.ModuleFactory ??= loader.default;
  const made = await createFaceLandmarker(files, model, prefer);
  face?.close();
  face = made.landmarker;
  return made.delegate;
}

async function init(message: Extract<ToWorker, { type: "init" }>): Promise<void> {
  const binary = URL.createObjectURL(new Blob([message.wasm], { type: "application/wasm" }));
  const files = { wasmLoaderPath: message.loader, wasmBinaryPath: binary };
  later = { wasmLoaderPath: message.loader, wasmBinaryPath: message.binary };
  prefer = message.prefer;
  const create = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(files, {
      runningMode: "VIDEO",
      // One hand, deliberately: a second costs time (measured in
      // input/trust.ts, which keeps a passer-by's hand from taking the aim).
      numHands: message.hands ?? 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      baseOptions: { modelAssetBuffer: new Uint8Array(message.model), delegate },
    });
  try {
    let delegate: "GPU" | "CPU" = "CPU";
    if (message.prefer === "GPU") {
      try {
        landmarker = await create("GPU");
        delegate = "GPU";
      } catch (error) {
        console.warn("Hand tracking on the GPU is unavailable; using the CPU.", error);
      }
    }
    landmarker ??= await create("CPU");
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

function read(message: Extract<ToWorker, { type: "frame" }>): void {
  const began = performance.now();
  let landmarks: Landmark[] | null = null;
  let handedness: "Left" | "Right" | null = null;
  const withFace = message.face === true && face !== null;
  try {
    const result = landmarker!.detectForVideo(message.image, message.timestamp);
    const hand = result.landmarks[0];
    if (hand && hand.length >= 21) {
      landmarks = hand.map(({ x, y, z }) => ({ x, y, z }));
      const name = result.handedness[0]?.[0]?.categoryName;
      handedness = name === "Left" || name === "Right" ? name : null;
    }
  } catch (error) {
    // One bad frame (a camera mid-reconfiguration) is skipped, not fatal.
    console.warn("A camera frame could not be read.", error);
  }
  post({
    type: "result",
    sequence: message.sequence,
    capturedAt: message.capturedAt,
    landmarks,
    handedness,
    inference: performance.now() - began,
    face: withFace,
  });
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
  message.image.close();
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") void init(message);
  else if (message.type === "face") {
    addFace(message.model).then(
      (delegate) => post({ type: "face-ready", delegate }),
      (error: unknown) => post({ type: "face-failed", message: String(error) }),
    );
  } else if (message.type === "frame") {
    if (landmarker) read(message);
    else message.image.close();
  }
};
