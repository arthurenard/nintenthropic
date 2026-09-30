import { describe, expect, it } from "vitest";
import { cameraName, nextCamera, videoInputs, type CameraInfo } from "./camera";

const front: CameraInfo = { deviceId: "front", label: "FaceTime HD Camera" };
const desk: CameraInfo = { deviceId: "desk", label: "Studio Display Camera" };
const phone: CameraInfo = { deviceId: "phone", label: "" };

describe("the cameras the browser lists", () => {
  it("counts cameras only: no microphones, and none the page may not see yet", () => {
    const devices = [
      { kind: "audioinput", deviceId: "mic", label: "Microphone" },
      { kind: "videoinput", deviceId: "front", label: "FaceTime HD Camera" },
      { kind: "videoinput", deviceId: "", label: "" }, // listed before the page may use a camera
      { kind: "audiooutput", deviceId: "out", label: "Speakers" },
    ] as const;
    expect(videoInputs(devices)).toEqual([front]);
  });
});

describe("the next camera", () => {
  it("is none when there is nothing to switch to", () => {
    expect(nextCamera([], null)).toBeNull();
    expect(nextCamera([front], "front")).toBeNull();
  });

  it("follows the one in use, and comes round to the first", () => {
    expect(nextCamera([front, desk], "front")).toBe(desk);
    expect(nextCamera([front, desk], "desk")).toBe(front);
    expect(nextCamera([front, desk, phone], "desk")).toBe(phone);
    expect(nextCamera([front, desk, phone], "phone")).toBe(front);
  });

  it("starts from the first when the one in use is not on the list", () => {
    expect(nextCamera([front, desk], "gone")).toBe(front);
    expect(nextCamera([front, desk], null)).toBe(front);
  });
});

describe("a camera's name", () => {
  it("is the one the browser gives, else its place in the list", () => {
    const list = [front, desk, phone];
    expect(cameraName(list, "desk")).toBe("Studio Display Camera");
    expect(cameraName(list, "phone")).toBe("Camera 3");
    expect(cameraName(list, "gone")).toBe("Camera 1");
    expect(cameraName([], null)).toBe("Camera 1");
  });
});
