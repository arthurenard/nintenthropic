/**
 * The parts of the engine the first screen needs, kept apart from the host so
 * the arcade loads without three.js: it arrives only when a game starts.
 */
import type { Aim } from "./types";

export class WebGLUnavailable extends Error {
  constructor() {
    super("WebGL is unavailable");
    this.name = "WebGLUnavailable";
  }
}

/** An aim that does nothing: no hand, no shot. */
export const IDLE_AIM: Aim = {
  x: 0.5,
  y: 0.5,
  tracking: false,
  armed: false,
  fired: false,
  travel: 0,
  offscreen: false,
  capturedAt: 0,
};

export interface FrameInfo {
  now: number;
  dt: number;
  aim: Aim;
}
