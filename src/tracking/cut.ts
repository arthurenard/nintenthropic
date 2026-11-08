/**
 * Whether this browser really cuts a VideoFrame to the `visibleRect` it was asked for.
 *
 * Players sharing a camera are each handed their column of the picture as a VideoFrame cut to it, which costs nothing
 * (no copy). Chrome gives the landmarker the column. Safari's VideoFrame says it was cut (displayWidth, visibleRect are
 * the column's) but drawImage and WebGL's texImage2D, which is how MediaPipe takes a frame, still read the whole
 * picture: every worker then finds the hands of all the players, squeezed into its own column, so an empty seat sees a
 * phantom hand where its neighbour's is (measured with e2e/seats.html in WebKit 26.6). What a frame reports cannot be
 * trusted, so the browser is asked once with a picture that has a known answer, by both ways of reading a frame. Where
 * it does not cut, the workers cut the whole frame themselves (the "crop" of a frame message).
 */

/** A 4 by 2 picture, black on the left and white on the right, cut to its white half. */
function whiteHalf(): VideoFrame {
  const picture = new OffscreenCanvas(4, 2);
  const context = picture.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 4, 2);
  context.fillStyle = "#000";
  context.fillRect(0, 0, 2, 2);
  return new VideoFrame(picture, { timestamp: 0, visibleRect: { x: 2, y: 0, width: 2, height: 2 } });
}

/** Whether a pixel read back is the white half's (not the black half's, which is what the whole picture's left edge is). */
const isWhite = (red: number | undefined): boolean => red !== undefined && red > 200;

/** The cut frame's first pixel by drawImage. */
function drawnWhite(frame: VideoFrame): boolean {
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(frame, 0, 0, 1, 1);
  return isWhite(context.getImageData(0, 0, 1, 1).data[0]);
}

/** The cut frame's first texel by a texture upload, as MediaPipe takes a frame. */
function uploadedWhite(frame: VideoFrame): boolean {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) throw new Error("no WebGL to ask");
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  const buffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.deleteFramebuffer(buffer);
  gl.deleteTexture(texture);
  return isWhite(pixel[0]);
}

let known: boolean | null = null;

/**
 * Whether a VideoFrame cut with `visibleRect` is what drawImage and a texture upload then read (asked once, a
 * millisecond or two). Anything that goes wrong in the asking (no WebGL here, no OffscreenCanvas) says no: the workers
 * cutting the frame themselves is right everywhere, only dearer.
 */
export function framesHonourCut(): boolean {
  if (known !== null) return known;
  let frame: VideoFrame | null = null;
  try {
    frame = whiteHalf();
    known = drawnWhite(frame) && uploadedWhite(frame);
  } catch {
    known = false;
  } finally {
    frame?.close();
  }
  return known;
}
