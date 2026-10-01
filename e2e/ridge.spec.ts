// Overwatch Ridge, end to end: with the mouse, the right button's scope and
// a first stage cleared with aimed shots, the reload, pause, and the results
// after the fall; with a scripted hand, the aim check's steel plates, one eye
// closed to scope, and a shot through it with the thumb.
import { expect, test, type Page } from "@playwright/test";
import { gameDebug, handAt, passAimCheck, pose, shoot, shot, skipWelcome, snapshot } from "./helpers";

type Target = { id: number; role: string; side: string; activity: string; distance: number };
type Mission = { stage: number; phase: string; rounds: number; score: number };

const eyes = (page: Page, left: number, right: number) =>
  page.evaluate(([l, r]) => window.handyTest!.eyes(l === -1 ? null : { blinkLeft: l!, blinkRight: r! }), [left, right]);

const mission = (page: Page) =>
  gameDebug(page, "(() => { const m = debug.mission(); return { stage: m.stage, phase: m.phase, rounds: m.rifle.rounds, score: m.scorer.score }; })()") as Promise<Mission>;

async function openRidge(page: Page, control: "mouse" | "hand", query = ""): Promise<void> {
  await skipWelcome(page, control === "mouse" ? { "handy.control.v1": "mouse" } : {});
  await page.goto(`/${query}#overwatch-ridge`);
  await expect(page.locator("#feature-title")).toHaveText("Overwatch Ridge");
  await page.getByRole("button", { name: "Play", exact: true }).click();
}

/** A view fraction as a point on the page, inside the game's band. */
async function onStage(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.locator("#stage").boundingBox())!;
  return [box.x + x * box.width, box.y + y * box.height];
}

/**
 * One aimed shot with the mouse: point where the round will land on him (the
 * drop and the wind held off, as a player learns to), hold the right button
 * to scope in there, settle, correct for how he moved (the scope pans at a
 * quarter of the mouse), click, and let go.
 */
async function aimedShot(page: Page, target: Target): Promise<void> {
  const part = target.activity === "binoculars" ? "chest" : "head";
  const a = (await gameDebug(page, `debug.aimFor(${target.id}, "${part}")`)) as { x: number; y: number } | null;
  if (!a) return;
  const [x, y] = await onStage(page, a.x, a.y);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await expect.poll(() => gameDebug(page, "debug.zoom()"), { timeout: 5_000 }).toBeGreaterThan(0.99);
  await page.waitForTimeout(250);
  const b = (await gameDebug(page, `debug.aimFor(${target.id}, "${part}")`)) as { x: number; y: number } | null;
  if (b) {
    const [bx, by] = await onStage(page, a.x + (b.x - a.x) * 4, a.y + (b.y - a.y) * 4);
    await page.mouse.move(bx, by);
    await page.waitForTimeout(120);
  }
  await page.mouse.down({ button: "left" });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(250);
  await page.mouse.up({ button: "right" });
}

test("Overwatch Ridge with the mouse: the scope on the right button, a stage cleared, pause, the fall and the results", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openRidge(page, "mouse");
  // The mouse needs no aim check: straight to the valley.
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 120_000 }).toBe("play");
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^5 of 5 rounds/);
  await page.mouse.move(720, 450);
  // A newcomer is shown where to look: a man 290 m out is a few pixels in the wide view. One mark
  // over the checkpoint (the three sentries stand together), with its range, and how to scope said
  // at the foot of the view until the player has.
  await expect(page.locator(".spot")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".spot-label")).toHaveText(/^Checkpoint · \d{3} m$/);
  await expect(page.locator("#hint")).toHaveText("Hold Shift or the right button to look through the scope.");
  await shot(page, info, "ridge-01-valley");
  // Held breath: no sway, so the test's aim is the aim.
  await gameDebug(page, "debug.still(true)");

  // The right button scopes in, where the mouse points; the page's crosshair gives way, and so do the marks.
  await page.mouse.down({ button: "right" });
  await expect.poll(() => gameDebug(page, "debug.scoped()")).toBe(true);
  await expect.poll(() => gameDebug(page, "debug.zoom()")).toBeGreaterThan(0.99);
  await expect(page.locator(".spot")).toHaveCount(0);
  await expect(page.locator("#hint")).toBeHidden();
  await shot(page, info, "ridge-02-scoped", 200);
  await page.mouse.up({ button: "right" });
  await expect.poll(() => gameDebug(page, "debug.scoped()")).toBe(false);
  // Looked through the scope once: the lesson is learned for good, and the marks come back with the wide view.
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("handy.tips-seen.v1")))!)).toContain("ridge.scope");
  await expect(page.locator(".spot")).toHaveCount(1, { timeout: 5_000 });

  // Stage 1: three sentries at the checkpoint, each taken through the scope.
  const deadline = Date.now() + 120_000;
  let cleared = false;
  while (Date.now() < deadline) {
    const m = await mission(page);
    if (m.stage > 1 || (m.stage === 1 && m.phase !== "combat" && m.phase !== "intro")) {
      cleared = true;
      break;
    }
    if (m.phase !== "combat") {
      await page.waitForTimeout(300);
      continue;
    }
    if (m.rounds === 0) {
      // Out: R works the bolt through five fresh rounds.
      await page.keyboard.press("r");
      await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^5 of 5 rounds/, { timeout: 8_000 });
      continue;
    }
    const targets = (await gameDebug(page, "debug.targets().filter((t) => t.side === 'hostile').sort((a, b) => a.distance - b.distance)")) as Target[];
    if (!targets.length) {
      await page.waitForTimeout(400);
      continue;
    }
    await aimedShot(page, targets[0]!);
    // The round takes its time across the valley; the bolt goes back and forward.
    await page.waitForTimeout(1_300);
  }
  expect(cleared, "the first stage is cleared").toBe(true);
  expect((await mission(page)).score).toBeGreaterThan(0);
  await shot(page, info, "ridge-03-cleared", 300);

  // Pause and resume.
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#pause-sheet")).toBeHidden();

  // A round from the far ledge: the scope cracks, the view tips into the grass, the results.
  await gameDebug(page, "debug.hurt(1000)");
  await expect.poll(() => gameDebug(page, "debug.phase()"), { timeout: 5_000 }).toBe("dying");
  await expect(page.locator("#results")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#results-outcome")).toHaveText(/on Stage \d/);
  await expect(page.locator("#results-stats div")).toHaveCount(4);
  await expect(page.locator("#results-fire")).toBeHidden();
  await page.waitForTimeout(1_200);
  await shot(page, info, "ridge-04-results");
  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#home")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Overwatch Ridge with a scripted hand: the plates, one eye closed to scope, a shot with the thumb", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openRidge(page, "hand", "?input=script");
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 120_000 }).toBe("check");
  await eyes(page, 0.05, 0.07);
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#check-title")).toHaveText("Point at the Lit Plate");
  await shot(page, info, "ridge-hand-01-plates");
  // The nine plates, unscoped: the hand's aim is fitted to the wide view.
  expect(await gameDebug(page, "debug.scoped()")).toBe(false);
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await pose(page, handAt(0.5, 0.55));
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^5 of 5 rounds/);

  // One eye closed and held: the scope, centred where the hand points.
  await eyes(page, 0.84, 0.22);
  await expect.poll(() => gameDebug(page, "debug.scoped()"), { timeout: 3_000 }).toBe(true);
  await expect.poll(() => gameDebug(page, "debug.zoom()"), { timeout: 3_000 }).toBeGreaterThan(0.99);
  await shot(page, info, "ridge-hand-02-scoped", 200);
  // The thumb folds: a round goes, and the bolt comes back as it rises.
  await shoot(page, 0.5, 0.55);
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^4 of 5 rounds/);
  // Open: the scope goes.
  await eyes(page, 0.05, 0.07);
  await expect.poll(() => gameDebug(page, "debug.scoped()"), { timeout: 3_000 }).toBe(false);
  expect(errors).toEqual([]);
});

const scoped = (page: Page) => gameDebug(page, "debug.scoped()");
const meter = (page: Page) => page.locator("#eye-meter");

/** The scripted hand through the aim check into play, the face open, the hand held up mid-view. */
async function playRidgeWithHand(page: Page): Promise<void> {
  await openRidge(page, "hand", "?input=script");
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 120_000 }).toBe("check");
  await eyes(page, 0.06, 0.08);
  await pose(page, handAt(0.5, 0.5));
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await pose(page, handAt(0.5, 0.55));
  // Held breath: no sway, so the test's aim is the aim.
  await gameDebug(page, "debug.still(true)");
}

test("Overwatch Ridge with a scripted hand: the eye is fed back, a low wink scopes, a hand across the face keeps it", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playRidgeWithHand(page);

  // What a newcomer is shown: how to scope - the eye, and the way that always works - left standing at
  // the foot of the view; the face seen; the checkpoint marked with its range.
  await expect(page.locator("#hint")).toHaveText("Close one eye to look through the scope. Or hold Shift.");
  await expect(meter(page)).toHaveAttribute("data-state", "seen");
  await expect(page.locator(".spot")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".spot-label")).toHaveText(/^Checkpoint · \d{3} m$/);
  await shot(page, info, "ridge-hand-03-first-time", 900);

  // The eye part shut: the indicator fills, and nothing scopes.
  await eyes(page, 0.28, 0.08);
  await expect(meter(page)).toHaveAttribute("data-state", "closing");
  await page.waitForTimeout(500);
  await shot(page, info, "ridge-hand-04-eye-closing", 0, { x: 1100, y: 640, width: 340, height: 260 });
  expect(await scoped(page)).toBe(false);

  // A wink that only reads 0.47 - a fixed 0.55 would never see it - scopes. The marks and the hint give way.
  await eyes(page, 0.47, 0.12);
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(true);
  await expect(meter(page)).toHaveAttribute("data-state", "scoped");
  await expect(page.locator(".spot")).toHaveCount(0);
  await expect(page.locator("#hint")).toBeHidden();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("handy.tips-seen.v1")))!)).toContain("ridge.scope");

  // The pointing hand comes across the face: the landmarker finds none. The scope stays, and says so.
  await eyes(page, -1, -1);
  await page.waitForTimeout(2_000);
  expect(await scoped(page)).toBe(true);
  await expect(meter(page)).toHaveAttribute("data-held", "true");
  await shot(page, info, "ridge-hand-05-eye-held", 0, { x: 1100, y: 640, width: 340, height: 260 });

  // The face is back with the eye open: the scope goes, and the marks come back.
  await eyes(page, 0.06, 0.08);
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(false);
  await expect(meter(page)).toHaveAttribute("data-state", "seen");
  await expect(page.locator(".spot")).toHaveCount(1);

  // A blink, hard and slow, does not scope.
  await eyes(page, 0.95, 0.93);
  await page.waitForTimeout(350);
  await eyes(page, 0.06, 0.08);
  await page.waitForTimeout(400);
  expect(await scoped(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("Overwatch Ridge with a scripted hand: a face that is never seen is said, with the way that works", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playRidgeWithHand(page);
  // The pointing hand across the face for good: the eye never reads, and the player has not scoped.
  await eyes(page, -1, -1);
  await expect(page.locator("#hint")).toHaveText("Your face isn’t in view. Hold Shift to look through the scope.", { timeout: 20_000 });
  await expect(meter(page)).toHaveAttribute("data-state", "away");
  await shot(page, info, "ridge-hand-06-face-away", 0, { x: 280, y: 640, width: 1160, height: 260 });
  // And Shift does what it says.
  await page.keyboard.down("Shift");
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(true);
  await page.keyboard.up("Shift");
  expect(errors).toEqual([]);
});

test("Overwatch Ridge with the hand: Shift and the right mouse button scope, even with the hand lost", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playRidgeWithHand(page);
  // Turn the eye out of it: only the buttons are asked.
  await eyes(page, -1, -1);

  await page.keyboard.down("Shift");
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(true);
  await page.keyboard.up("Shift");
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(false);

  await page.mouse.move(720, 450);
  await page.mouse.down({ button: "right" });
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(true);
  await page.mouse.up({ button: "right" });
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(false);

  // The hand dropped out of the picture for a moment: the scope is still there to be asked for.
  await pose(page, null);
  await page.keyboard.down("Shift");
  await expect.poll(() => scoped(page), { timeout: 1_000 }).toBe(true);
  await page.keyboard.up("Shift");
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(false);
  await pose(page, handAt(0.5, 0.55));

  // Toggled, from Settings: a press scopes, the next lets go.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radiogroup", { name: "Scope Button" }).getByRole("radio", { name: "Toggle" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await snapshot(page)).held, { timeout: 15_000 }).toBe(false);
  await pose(page, handAt(0.5, 0.55));
  await page.keyboard.press("Shift");
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(true);
  await page.waitForTimeout(400);
  expect(await scoped(page)).toBe(true);
  await page.keyboard.press("Shift");
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(false);
  expect(errors).toEqual([]);
});

test("Overwatch Ridge on a touch screen with the hand: the Scope button rests above the camera's picture", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/?input=script#overwatch-ridge");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 120_000 }).toBe("check");
  await pose(page, handAt(0.5, 0.5));
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await pose(page, handAt(0.5, 0.55));
  expect((await snapshot(page)).input).toBe("hand");
  const button = page.getByRole("button", { name: "Scope" });
  await expect(button).toBeVisible();
  // In the corner, clear of the camera's picture.
  const [b, pip] = [(await button.boundingBox())!, (await page.locator("#pip").boundingBox())!];
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.y + b.height).toBeLessThanOrEqual(pip.y + 1);
  await button.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch", isPrimary: true });
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(true);
  await shot(page, info, "ridge-hand-07-touch-scope", 200);
  await button.dispatchEvent("pointerup", { pointerId: 9, pointerType: "touch", isPrimary: true });
  await expect.poll(() => scoped(page), { timeout: 3_000 }).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});

test("Settings' Eye Test shows both eyes live, learns a held wink, and says when the face is hidden", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/?input=script");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#scope-group")).toBeVisible();
  const status = page.locator("#eye-test-status");
  await expect(page.locator("#eye-test")).toBeHidden();
  await page.locator("#eye-test-toggle").click();
  await expect(page.locator("#eye-test-toggle")).toHaveText("Stop");
  await eyes(page, 0.06, 0.08);
  await expect(status).toHaveText("Your face is seen. Close one eye past the mark and hold it.");
  await expect(page.locator("#eye-bar-left .eye-value")).toHaveText("6%");
  // One eye shut: its bar, and the line, say which; the other stays open.
  await eyes(page, 0.88, 0.2);
  await expect(page.locator("#eye-bar-left .eye-value")).toHaveText("88%");
  await expect(page.locator("#eye-bar-right .eye-value")).toHaveText("20%");
  await expect(status).toHaveText("One eye closed. That opens the scope.");
  await page.locator("#eye-test").scrollIntoViewIfNeeded();
  await shot(page, info, "ridge-eye-test-closed", 300);
  // Held a while, then let go: what this player's eye reads is learned and kept.
  await page.waitForTimeout(900);
  await eyes(page, 0.06, 0.08);
  await expect(status).toHaveText("Got it. The scope now fits how your eye closes.");
  const kept = JSON.parse((await page.evaluate(() => localStorage.getItem("handy.eye.v1")))!) as { open: number; closed: number };
  expect(kept.closed).toBeGreaterThan(0.8);
  expect(kept.open).toBeLessThan(0.15);
  // The pointing hand across the face: the test says that the face is not seen.
  await eyes(page, -1, -1);
  await expect(status).toHaveText("Looking for your face. Face the camera, with your hand down.");
  await shot(page, info, "ridge-eye-test-hidden", 300);
  await page.locator("#eye-test-toggle").click();
  await expect(page.locator("#eye-test-toggle")).toHaveText("Start");
  await expect(page.locator("#eye-test")).toBeHidden();
  expect(errors).toEqual([]);
});

test("Settings' Eye Test over a paused game leaves the round as it was: the eye still scopes after Resume", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playRidgeWithHand(page);
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#eye-test-toggle").click();
  await eyes(page, 0.06, 0.08);
  await expect(page.locator("#eye-test-status")).toHaveText("Your face is seen. Close one eye past the mark and hold it.");
  await page.getByRole("button", { name: "Done" }).click();
  // Closing the sheet ended the test: the camera's reading is the game's again.
  await expect(page.locator("#eye-test")).toBeHidden();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await snapshot(page)).held, { timeout: 15_000 }).toBe(false);
  await pose(page, handAt(0.5, 0.55));
  await eyes(page, 0.84, 0.22);
  await expect.poll(() => scoped(page), { timeout: 5_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test("Settings' Eye Test with the real camera: your own picture, the face landmarker read beside it, the camera let go after", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page, { "handy.camera-opened.v1": true });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#eye-test-toggle").click();
  // The camera's fake picture is a face behind a fist: the landmarker sees a face or it does not, and says which.
  await expect(page.locator("#eye-test-status")).toHaveText(/^(Looking for your face|Your face is seen)/, { timeout: 90_000 });
  const picture = page.locator("#eye-test-video");
  await expect(picture).toBeVisible();
  expect(await picture.evaluate((video: HTMLVideoElement) => video.videoWidth > 0 && !video.paused)).toBe(true);
  // The face is read on every frame while the test runs, in the tracker's worker.
  await expect
    .poll(async () => (await page.evaluate(() => window.handyTest!.snapshot() as unknown as { tracker: { stats: { face: { frames: number } | null } } | null })).tracker?.stats.face?.frames ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(10);
  // Stop: the picture goes and the camera is let go of.
  await page.locator("#eye-test-toggle").click();
  await expect(page.locator("#eye-test")).toBeHidden();
  await expect.poll(() => picture.evaluate((video: HTMLVideoElement) => video.srcObject === null)).toBe(true);
  expect((await snapshot(page)).tracker).not.toBeNull();
  expect(errors).toEqual([]);
});
