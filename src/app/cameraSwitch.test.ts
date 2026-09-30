import { describe, expect, it } from "vitest";
import { CameraError, type CameraInfo } from "../tracking/camera";
import { switchCamera, type SwitchHost } from "./cameraSwitch";

const front: CameraInfo = { deviceId: "front", label: "FaceTime HD Camera" };
const desk: CameraInfo = { deviceId: "desk", label: "Studio Display Camera" };

/** A browser with these cameras; `opens` says what each device does when asked to open. */
function fakeHost(cameras: CameraInfo[], inUse: string | null, opens: Record<string, "ok" | "busy" | "gone"> = {}) {
  const log: string[] = [];
  let chosen: string | null = null;
  let live = inUse;
  const host: SwitchHost = {
    cameras: async () => cameras,
    inUse: () => live,
    release() {
      log.push(`release ${live}`);
      live = null;
    },
    async open() {
      // A chosen camera that has gone gives way to another, as openCamera does.
      let id = chosen!;
      if (opens[id] === "gone") id = cameras.find((camera) => opens[camera.deviceId] !== "gone" && camera.deviceId !== id)?.deviceId ?? id;
      if (opens[id] === "busy") {
        log.push(`busy ${id}`);
        throw new CameraError("busy");
      }
      log.push(`open ${id}`);
      live = id;
      return id;
    },
    choose(deviceId) {
      log.push(`choose ${deviceId}`);
      chosen = deviceId;
    },
  };
  return { host, log, chosen: () => chosen, live: () => live };
}

describe("Switch Camera", () => {
  it("does nothing with fewer than two cameras", async () => {
    const one = fakeHost([front], "front");
    expect(await switchCamera(one.host)).toEqual({ kind: "none" });
    expect(one.log).toEqual([]);
    const none = fakeHost([], null);
    expect(await switchCamera(none.host)).toEqual({ kind: "none" });
  });

  it("lets the old camera go before the next opens, and remembers the choice", async () => {
    const browser = fakeHost([front, desk], "front");
    expect(await switchCamera(browser.host)).toEqual({ kind: "switched", camera: desk });
    expect(browser.log).toEqual(["release front", "choose desk", "open desk", "choose desk"]);
    expect(browser.chosen()).toBe("desk");
    expect(browser.live()).toBe("desk");
  });

  it("comes round to the first camera from the last", async () => {
    const browser = fakeHost([front, desk], "desk");
    expect(await switchCamera(browser.host)).toEqual({ kind: "switched", camera: front });
    expect(browser.chosen()).toBe("front");
  });

  it("names a camera the browser has not named by its place in the list", async () => {
    const unnamed: CameraInfo = { deviceId: "usb", label: "" };
    const browser = fakeHost([front, unnamed], "front");
    expect(await switchCamera(browser.host)).toEqual({ kind: "switched", camera: { deviceId: "usb", label: "Camera 2" } });
  });

  it("keeps the camera that was in use when the next is busy, and says what it wanted", async () => {
    const browser = fakeHost([front, desk], "front", { desk: "busy" });
    const result = await switchCamera(browser.host);
    expect(result).toEqual({ kind: "kept", camera: front, wanted: desk, trouble: "busy" });
    expect(browser.log).toEqual(["release front", "choose desk", "busy desk", "choose front", "open front", "choose front"]);
    expect(browser.chosen()).toBe("front");
    expect(browser.live()).toBe("front");
  });

  it("is a camera trouble when neither will open", async () => {
    const browser = fakeHost([front, desk], "front", { desk: "busy", front: "busy" });
    expect(await switchCamera(browser.host)).toEqual({ kind: "failed", trouble: "busy" });
    expect(browser.live()).toBeNull();
  });

  it("is a camera trouble when the next is busy and no camera was in use to go back to", async () => {
    const browser = fakeHost([front, desk], null, { front: "busy" });
    // With none in use the first camera is next.
    expect(await switchCamera(browser.host)).toEqual({ kind: "failed", trouble: "busy" });
  });

  it("takes what opened as the choice when the next has gone (unplugged since it was listed)", async () => {
    const third: CameraInfo = { deviceId: "usb", label: "USB Camera" };
    const browser = fakeHost([front, desk, third], "front", { desk: "gone" });
    const result = await switchCamera(browser.host);
    expect(result).toEqual({ kind: "switched", camera: front });
    expect(browser.chosen()).toBe("front");
  });

  it("never remembers a device the browser does not list", async () => {
    const browser = fakeHost([front, desk], "front");
    const open = browser.host.open;
    browser.host.open = async () => {
      await open();
      return "default"; // a camera that reports no id of its own
    };
    expect(await switchCamera(browser.host)).toMatchObject({ kind: "switched" });
    expect(browser.chosen()).toBe("desk");
  });
});
