/**
 * The hand landmarker, off the page's thread.
 *
 * Reading a hand takes 10-40 ms a frame, and on the page's own thread every
 * one of those milliseconds is a millisecond the game cannot draw in: at 30
 * camera frames a second it cost the render loop two frames out of every
 * four. Here it runs beside the game instead, on its own WebGL context.
 */
import { HandLandmarker } from "@mediapipe/tasks-vision";
import type { FromWorker, ToWorker } from "./protocol";
import type { Landmark } from "./types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let landmarker: HandLandmarker | null = null;

const post = (message: FromWorker) => scope.postMessage(message);

async function init(message: Extract<ToWorker, { type: "init" }>): Promise<void> {
  const binary = URL.createObjectURL(new Blob([message.wasm], { type: "application/wasm" }));
  const fileset = { wasmLoaderPath: message.loader, wasmBinaryPath: binary };
  const create = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(fileset, {
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
    if (message.prefer === "GPU") {
      try {
        landmarker = await create("GPU");
        post({ type: "ready", delegate: "GPU" });
        return;
      } catch (error) {
        console.warn("Hand tracking on the GPU is unavailable; using the CPU.", error);
      }
    }
    landmarker = await create("CPU");
    post({ type: "ready", delegate: "CPU" });
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
  } finally {
    message.image.close();
  }
  post({
    type: "result",
    sequence: message.sequence,
    capturedAt: message.capturedAt,
    landmarks,
    handedness,
    inference: performance.now() - began,
  });
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") void init(message);
  else if (message.type === "frame") {
    if (landmarker) read(message);
    else message.image.close();
  }
};
