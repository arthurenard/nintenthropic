// (b) The camera flow with Chrome's fake camera showing a still picture of a
// hand: the camera's question, getting ready (the tracker's wasm and model,
// and the game), and the aim check with MediaPipe finding the hand in every
// camera frame.
import { expect, test } from "@playwright/test";
import { shot, skipWelcome, snapshot } from "./helpers";

test("the camera flow: the hand is tracked, frame after frame", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/#arcade");
  await expect(page.locator("#control-label")).toHaveText("Finger Pistol");
  await page.getByRole("button", { name: "Play" }).click();

  // Before the browser asks, the page says why (unless the browser already
  // allows the camera, as a fake-camera Chrome may).
  const question = page.locator("#prime");
  await expect(question.or(page.locator("#loading"))).toBeVisible({ timeout: 10_000 }).catch(() => {});
  if (await question.isVisible()) {
    await shot(page, info, "camera-01-question");
    await page.getByRole("button", { name: "Continue" }).click();
  }

  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("check");
  await expect(page.locator("#pip")).toBeVisible();
  // MediaPipe finds the hand in the camera's frames, one after another.
  await expect
    .poll(async () => (await snapshot(page)).tracker?.stats.framesWithHand ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(20);
  const state = await snapshot(page);
  expect(state.tracker!.where).toBe("worker");
  expect(state.tracker!.stats.framesWithHand / state.tracker!.stats.frames).toBeGreaterThan(0.8);
  await expect(page.locator("#trigger")).not.toHaveAttribute("data-state", "lost");
  await shot(page, info, "camera-02-aim-check");
  info.annotations.push({
    type: "tracking",
    description: `${state.tracker!.where} ${state.tracker!.delegate}: inference p50 ${state.tracker!.stats.inference.p50.toFixed(1)} ms, p95 ${state.tracker!.stats.inference.p95.toFixed(1)} ms`,
  });

  // Pausing stops reading frames; resuming picks them up again.
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust Aim" })).toBeVisible();
  const paused = (await snapshot(page)).tracker!.stats.frames;
  await page.waitForTimeout(600);
  expect((await snapshot(page)).tracker!.stats.frames).toBe(paused);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await snapshot(page)).tracker!.stats.frames, { timeout: 10_000 }).toBeGreaterThan(paused);

  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#arcade")).toBeVisible();
  expect(errors).toEqual([]);
});
