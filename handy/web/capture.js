"use strict";
// Mirrors and JPEG-encodes the page's camera frames on a thread of their own.
// On the page's thread, canvas encoding waits for the page to fall idle, which
// a busy or background tab may not do for a whole second.
const canvas = new OffscreenCanvas(640, 480);
const context = canvas.getContext("2d");
// Mirror exactly once, matching the preview and the native control conventions.
context.setTransform(-1, 0, 0, 1, canvas.width, 0);
onmessage = async ({ data: frame }) => {
  try {
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
    postMessage(
      await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 }),
    );
  } catch {
    postMessage(null); // the page sends this frame without a camera image
  } finally {
    frame.close();
  }
};
