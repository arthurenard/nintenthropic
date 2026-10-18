/**
 * The Eye Test (Settings): the camera and the face landmarker, for as long
 * as the sheet asks, so a player can see that their face is read and how far
 * each eye closes. Over a paused game they are already here; at the arcade
 * they are made for the test - the camera let go of afterwards, the
 * landmarker kept for the game that follows. It is also the "Close one eye"
 * step: a wink held here teaches the scope how far this player's eye really
 * closes (and is kept), in full rather than by halves.
 */
import { Progress } from "../engine/fetch";
import { EYE_SCOPE, EyeScope } from "../input/scope";
import { CameraError, cameraPermission, openCamera, type Camera } from "../tracking/camera";
import type { HandCamera } from "./handCamera";
import { loadEyeProfile, prefs, saveEyeProfile } from "./prefs";
import type { EyeTestState } from "./settings";

const BLOCKED = "Your browser is blocking the camera for this page. Allow it from the address bar, then Start again.";

/**
 * Starts the Eye Test, showing the camera's picture in `video` and telling
 * `listener` what it reads. Resolves the function that stops it, or null
 * when it could not start (the listener has been told why).
 *
 * @param afterwards Puts the face reading back as the paused game had it, once the test is over.
 */
export async function runEyeTest(
  camera: HandCamera,
  listener: (state: EyeTestState) => void,
  video: HTMLVideoElement,
  afterwards: () => void,
): Promise<(() => void) | null> {
  const scripted = camera.scripted;
  const blocked = (message: string): null => {
    listener({ kind: "blocked", message });
    return null;
  };
  let own: Camera | null = null;
  if (!scripted) {
    if ((await cameraPermission()) === "denied") return blocked(BLOCKED);
    if (camera.camera) {
      // The paused game's own camera: its picture, shown here too.
      video.srcObject = camera.camera.stream;
      void video.play().catch(() => {});
    } else {
      try {
        own = await openCamera(video);
        prefs.cameraOpened = true;
      } catch (error) {
        const trouble = error instanceof CameraError ? error.trouble : "busy";
        return blocked(
          trouble === "denied"
            ? BLOCKED
            : trouble === "missing"
              ? "No camera found. Connect one, then Start again."
              : trouble === "insecure"
                ? "Your browser only shares the camera with secure pages."
                : "Your camera is being used by another app. Close it, then Start again.",
        );
      }
    }
    if (!camera.tracker?.hasFace) {
      const progress = new Progress((fraction) => listener({ kind: "getting-ready", fraction }));
      try {
        if (!camera.tracker) {
          camera.tracker = await camera.loadTracker({ wasm: progress.part("wasm", 12), model: progress.part("model", 8), face: progress.part("face", 4) }, true);
        }
        if (!camera.tracker.hasFace) await camera.tracker.addFace(progress.part("face", 4));
      } catch (error) {
        console.warn("The Eye Test could not get the face landmarker ready.", error);
      }
      if (!camera.tracker?.hasFace) {
        own?.stop();
        video.srcObject = null;
        return blocked("Couldn’t get your face reading ready. Check your connection, then Start again.");
      }
    }
  }
  const tracker = camera.tracker;
  const eye = new EyeScope({ ...EYE_SCOPE, learn: 1 }, loadEyeProfile());
  let learned = false;
  eye.onLearn = (taught) => {
    saveEyeProfile(taught);
    learned = true;
  };
  const say = () => listener({ kind: "reading", view: eye.view(performance.now()), learned });
  const source = scripted ?? tracker!;
  const off = source.subscribeFace?.((face) => {
    eye.read(face.eyes, face.capturedAt);
    say();
  });
  // Readings that stop coming (a face lost is a reading; a stalled camera is not) are seen as the face gone.
  const tick = window.setInterval(say, 250);
  // The test's own picture is read, not the game's: the page's tracking (HandCamera.start) stays as the paused game left it.
  if (scripted) {
    scripted.readFace(1);
    scripted.start();
  } else {
    tracker!.readFace(1);
    tracker!.start(video);
  }
  say();
  return () => {
    window.clearInterval(tick);
    off?.();
    if (scripted) scripted.stop();
    else tracker!.stop();
    // A paused game goes on as it was told: stopped, and reading the eye if it was to.
    afterwards();
    if (own) own.stop();
    else video.srcObject = null;
  };
}
