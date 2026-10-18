// Switch Camera: with two or more cameras, the aim check's picture and the
// pause menu swap to the next camera at once - the old stream released, the
// new camera named, its aim check begun (from its saved aim if it has one),
// Settings and the remembered choice following. Chrome's fake camera is one
// device, so a second is simulated in the page: enumerateDevices lists two,
// and getUserMedia opens the real fake camera under the id it was asked for.
import { expect, test, type Page } from "@playwright/test";
import { passAimCheck, shot, returningVisitor, snapshot } from "./helpers";

/** The page's cameras, and what has been opened through them, for the tests to read and change. */
type Cameras = {
  list: { deviceId: string; label: string }[];
  /** Every track opened, in order, with the device it was opened as. */
  tracks: { deviceId: string; track: MediaStreamTrack; liveAtOpen: number }[];
  /** Devices another app has (getUserMedia says NotReadableError). */
  busy: string[];
};

declare global {
  interface Window {
    __cameras?: Cameras;
  }
}

/** Two cameras in the page: the front one first. */
async function twoCameras(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const cameras: Cameras = {
      list: [
        { deviceId: "cam-front", label: "FaceTime HD Camera" },
        { deviceId: "cam-desk", label: "Studio Display Camera" },
      ],
      tracks: [],
      busy: [],
    };
    window.__cameras = cameras;
    const media = navigator.mediaDevices;
    media.enumerateDevices = async () =>
      cameras.list.map(({ deviceId, label }) => ({ kind: "videoinput", deviceId, label, groupId: deviceId, toJSON: () => ({}) }) as MediaDeviceInfo);
    const real = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const video = typeof constraints?.video === "object" ? { ...constraints.video } : {};
      const asked = (video.deviceId ?? {}) as { exact?: string; ideal?: string };
      delete video.deviceId;
      let deviceId = asked.exact ?? asked.ideal;
      if (asked.exact && !cameras.list.some((camera) => camera.deviceId === asked.exact)) throw new DOMException("No such camera", "OverconstrainedError");
      if (!deviceId || !cameras.list.some((camera) => camera.deviceId === deviceId)) deviceId = cameras.list[0]?.deviceId;
      if (!deviceId) throw new DOMException("No camera", "NotFoundError");
      if (cameras.busy.includes(deviceId)) throw new DOMException("Another app has it", "NotReadableError");
      const liveAtOpen = cameras.tracks.filter((entry) => entry.track.readyState === "live").length;
      const stream = await real({ ...constraints, video });
      const track = stream.getVideoTracks()[0]!;
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId });
      cameras.tracks.push({ deviceId, track, liveAtOpen });
      return stream;
    };
  });
}

/** A camera has been plugged in or out: the browser says so. */
const devicesChanged = (page: Page) => page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));

const tracks = (page: Page) =>
  page.evaluate(() => window.__cameras!.tracks.map(({ deviceId, track, liveAtOpen }) => ({ deviceId, state: track.readyState, liveAtOpen })));

const chosen = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("handy.camera-choice.v1") ?? "null") as string | null);

/** Through the camera's question (if the browser asks it) into the aim check, with the real fake camera. */
async function toAimCheck(page: Page): Promise<void> {
  await page.goto("/#arcade");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("check");
  await expect(page.locator("#pip")).toBeVisible();
}

test("with one camera, Switch Camera is nowhere", async ({ page }) => {
  await returningVisitor(page);
  await page.goto("/?input=script#arcade");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await expect(page.locator("#pip")).toBeVisible();
  await expect(page.locator("#switch-camera")).toBeHidden();
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await expect(page.locator("#pause-switch-camera")).toBeHidden();
  await expect(page.getByRole("button", { name: "Switch Camera" })).toHaveCount(0);
});

test("two cameras: switching from the aim check and from the pause menu", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returningVisitor(page, { "handy.camera-opened.v1": true });
  await twoCameras(page);
  await toAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).tracker?.stats.framesWithHand ?? 0, { timeout: 60_000 }).toBeGreaterThan(5);
  expect((await tracks(page)).map((t) => t.deviceId)).toEqual(["cam-front"]);

  // On the camera's picture, an icon button with a name and a place in the tab order.
  const onPicture = page.locator("#pip").getByRole("button", { name: "Switch Camera" });
  await expect(onPicture).toBeVisible();
  const box = (await onPicture.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const pip = (await page.locator("#pip").boundingBox())!;
  await shot(page, info, "switch-camera-01-aim-check", 550, { x: pip.x - 16, y: pip.y - 16, width: pip.width + 32, height: pip.height + 32 });
  await shot(page, info, "switch-camera-01-aim-check-page", 0);

  // By keyboard: the next camera at once, named in a toast, the old one released before the new opens.
  await onPicture.focus();
  await expect(onPicture).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast")).toHaveText("Studio Display Camera");
  await expect.poll(async () => (await tracks(page)).length).toBe(2);
  const opened = await tracks(page);
  expect(opened.map((t) => t.deviceId)).toEqual(["cam-front", "cam-desk"]);
  expect(opened[0]!.state).toBe("ended");
  expect(opened[1]!.state).toBe("live");
  expect(opened[1]!.liveAtOpen).toBe(0);
  // Remembered as the choice, and the aim check begins again for it.
  expect(await chosen(page)).toBe("cam-desk");
  await expect.poll(async () => (await snapshot(page)).phase).toBe("check");
  expect((await snapshot(page)).shots).toBe(0);
  // The keyboard's place is kept, for the next camera.
  await expect(onPicture).toBeFocused();
  const framesThen = (await snapshot(page)).tracker!.stats.framesWithHand;
  await expect.poll(async () => (await snapshot(page)).tracker!.stats.framesWithHand, { timeout: 30_000 }).toBeGreaterThan(framesThen);
  await shot(page, info, "switch-camera-02-switched");

  // From the pause menu: back to the first camera, the sheet closing on a new aim check.
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  const inMenu = page.locator("#pause-sheet").getByRole("button", { name: "Switch Camera" });
  await expect(inMenu).toBeVisible();
  await shot(page, info, "switch-camera-03-pause-menu");
  await inMenu.click();
  await expect(page.locator("#pause-sheet")).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("FaceTime HD Camera");
  await expect.poll(async () => (await tracks(page)).length).toBe(3);
  expect((await tracks(page)).map((t) => t.state)).toEqual(["ended", "ended", "live"]);
  expect(await chosen(page)).toBe("cam-front");
  await expect.poll(async () => (await snapshot(page)).phase).toBe("check");

  // Settings agrees: its Camera menu shows the one now in use.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#camera-choice")).toHaveValue("cam-front");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Resume" }).click();

  expect(errors).toEqual([]);
});

test("a camera with a saved aim begins its check from it", async ({ page }) => {
  await returningVisitor(page, { "handy.camera-opened.v1": true });
  await twoCameras(page);
  await toAimCheck(page);
  // The other camera has been set up before, in this game, at this picture size.
  const { width, height } = await page.evaluate(() => {
    const camera = window.arcadeTest!.internals().camera!;
    return { width: camera.width, height: camera.height };
  });
  await page.evaluate(
    ({ width, height }) =>
      localStorage.setItem(
        `handy.aim.v1.cam-desk.${width}x${height}.high-noon`,
        JSON.stringify({ version: 1, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], savedAt: Date.now() }),
      ),
    { width, height },
  );
  const returning = () => page.evaluate(() => window.arcadeTest!.internals().session!.check!.check.returning);
  // This camera has no aim yet: the check starts from the beginning, and shows no crosshair.
  expect(await returning()).toBe(false);
  await expect(page.locator("#check-title")).toHaveText("Point at the Lit Bottle");
  expect((await snapshot(page)).crosshairShown).toBe(false);
  await page.locator("#switch-camera").click();
  await expect(page.locator("#toast")).toHaveText("Studio Display Camera");
  await expect.poll(async () => (await snapshot(page)).shots).toBe(0);
  await expect.poll(async () => (await snapshot(page)).phase).toBe("check");
  // The other one has one: the check starts from it (three shots to confirm it) - and still shows
  // no crosshair, so a returning player points, too, instead of steering a saved aim onto the bottles.
  expect(await returning()).toBe(true);
  await expect(page.locator("#check-title")).toHaveText("Welcome Back");
  expect((await snapshot(page)).crosshairShown).toBe(false);
});

test("a next camera another app has: the one in use stays, and the player is told", async ({ page }) => {
  await returningVisitor(page, { "handy.camera-opened.v1": true });
  await twoCameras(page);
  await toAimCheck(page);
  await page.evaluate(() => window.__cameras!.busy.push("cam-desk"));
  await page.locator("#switch-camera").click();
  await expect(page.locator("#toast")).toHaveText("Couldn’t switch to Studio Display Camera. Another app may be using it.");
  await expect.poll(async () => (await tracks(page)).length).toBe(2);
  expect((await tracks(page)).map((t) => `${t.deviceId} ${t.state}`)).toEqual(["cam-front ended", "cam-front live"]);
  expect(await chosen(page)).toBe("cam-front");
  expect((await snapshot(page)).phase).toBe("check");
  expect((await snapshot(page)).troubled).toBe(false);
  // The picture is still read: the check goes on.
  const frames = (await snapshot(page)).tracker!.stats.framesWithHand;
  await expect.poll(async () => (await snapshot(page)).tracker!.stats.framesWithHand, { timeout: 30_000 }).toBeGreaterThan(frames);
});

test("a camera unplugged mid-game gives way to the other, and the switch goes with it", async ({ page }, info) => {
  await returningVisitor(page, { "handy.camera-opened.v1": true });
  await twoCameras(page);
  await toAimCheck(page);
  await page.locator("#switch-camera").click();
  await expect(page.locator("#toast")).toHaveText("Studio Display Camera");
  await expect.poll(async () => (await tracks(page)).length).toBe(2);
  await expect.poll(async () => (await snapshot(page)).phase).toBe("check");

  // The desk camera comes out: the round waits, and Try Again finds the front one.
  await page.evaluate(() => {
    window.__cameras!.list = window.__cameras!.list.filter((camera) => camera.deviceId !== "cam-desk");
    window.arcadeTest!.unplug();
  });
  await devicesChanged(page);
  await expect(page.locator("#alert")).toBeVisible();
  await expect(page.locator("#alert-title")).toHaveText("Camera Stopped");
  await shot(page, info, "switch-camera-04-unplugged");
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect.poll(async () => (await snapshot(page)).troubled).toBe(false);
  await expect.poll(async () => (await tracks(page)).at(-1)?.deviceId).toBe("cam-front");
  await expect.poll(async () => (await snapshot(page)).phase).toBe("check");
  // One camera left: nothing to switch to, and Settings names the one in use.
  await expect(page.locator("#switch-camera")).toBeHidden();
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await expect(page.locator("#pause-switch-camera")).toBeHidden();
});

test("a round in play starts afresh under the other camera, through its aim check", async ({ page }) => {
  await returningVisitor(page, { "handy.camera-opened.v1": true });
  await page.goto("/?input=script#arcade");
  await page.evaluate(() => {
    const list = [
      { deviceId: "cam-front", label: "FaceTime HD Camera" },
      { deviceId: "cam-desk", label: "Studio Display Camera" },
    ];
    navigator.mediaDevices.enumerateDevices = async () =>
      list.map(({ deviceId, label }) => ({ kind: "videoinput", deviceId, label, groupId: deviceId, toJSON: () => ({}) }) as MediaDeviceInfo);
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Switch Camera" }).click();
  await expect(page.locator("#toast")).toHaveText(/Camera$/);
  await expect(page.locator("#pause-sheet")).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).phase).toBe("check");
  expect((await snapshot(page)).paused).toBe(false);
  // The scripted hand is another camera now: its own aim, its own check.
  expect(await page.evaluate(() => window.arcadeTest!.internals().session!.camera)).toMatchObject({ deviceId: "cam-front" });
});
