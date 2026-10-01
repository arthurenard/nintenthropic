// (c) A scripted hand - landmarks from a script instead of the camera - drives
// the real aim pipeline (filter, thumb trigger, aim check, fits) through a
// whole aim check to 95% and into play; then, as a returning player, through
// the check again in three shots.
import { expect, test } from "@playwright/test";
import { handAt, moveTo, passAimCheck, pose, shoot, shot, skipWelcome, snapshot } from "./helpers";

test("a scripted hand passes the aim check at 95% and plays", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/?input=script");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#trigger")).toHaveAttribute("data-state", "ready");
  // The check says what is happening: point at the lit bottle, Handy learns where you point. No crosshair to steer.
  await expect(page.locator("#check-title")).toHaveText("Point at the Lit Bottle");
  await expect(page.locator("#check-detail")).toHaveText("Point your finger at it and fire. Handy is learning where you point.");
  await expect(page.locator("#check-status")).toHaveText("Learning Your Aim");
  expect((await snapshot(page)).crosshairShown).toBe(false);
  // Whatever the finger does, the game is told the aim rests on the lit bottle: nothing it draws
  // (a beam, a sway, a laser) follows an aim that is not learned yet.
  await moveTo(page, 0.2, 0.75);
  await page.waitForTimeout(250);
  const lit = (await snapshot(page)).lit!;
  const told = (await page.evaluate(() => window.handyTest!.internals().host!.aim(performance.now()))) as { x: number; y: number; tracking: boolean };
  expect(told.tracking).toBe(true);
  expect(told.x).toBeCloseTo(lit.x, 6);
  expect(told.y).toBeCloseTo(lit.y, 6);
  await moveTo(page, 0.5, 0.5);
  await shot(page, info, "script-01-aim-check");

  let crosshairs = 0;
  const shots = await passAimCheck(page, async (n) => {
    // The crosshair stays away until the aim is set: the bottle is taken, and the ring fills.
    const state = await snapshot(page);
    if (state.crosshairShown && !state.checkDone) crosshairs++;
    if (n === 2) {
      await expect(page.locator("#check-title")).toHaveText("Two Down");
      await shot(page, info, "script-02-learning");
    }
  });
  expect(crosshairs, "no crosshair while the aim is learned").toBe(0);
  // Six shots: two to learn, one to fit the full map, three to prove it.
  expect(shots).toBe(6);
  await expect.poll(async () => (await snapshot(page)).lastCheck?.ended ?? null, { timeout: 5_000 }).toBe("ready");
  expect((await snapshot(page)).lastCheck!.score!).toBeGreaterThanOrEqual(0.95);
  // The ready moment lasts a second and a half: caught when the game's
  // frames leave the test time to look.
  const moment = page.locator(".ready-moment");
  if (await moment.isVisible()) {
    await expect(moment).toContainText("Aim Set");
    await expect(moment).toContainText("The crosshair now follows your finger.");
    // The crosshair arrives with it, already right.
    expect((await snapshot(page)).crosshairShown).toBe(true);
    await shot(page, info, "script-03-aim-set", 0);
  }

  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  await expect(page.locator("#hud-score")).toBeVisible();
  // The hand fires in play too: a round leaves the cylinder.
  await shoot(page, 0.5, 0.6);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  // And pointing off the screen reloads it.
  await moveTo(page, 1.35, 0.5);
  await page.waitForTimeout(500);
  await moveTo(page, 0.5, 0.5);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "6 of 6 rounds", { timeout: 5_000 });
  await shot(page, info, "script-04-play");

  // A new game begins with the aim check again - measured from the first
  // shot now, so three good ones are enough.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 30_000 }).toBe("check");
  await expect(page.locator("#check-title")).toHaveText("Welcome Back");
  expect((await snapshot(page)).crosshairShown).toBe(false);
  expect(await passAimCheck(page)).toBe(3);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  expect(errors).toEqual([]);
});

test("with Reduce Motion the aim check says the same, shows no crosshair until the aim is set, and ends on Aim Set", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await skipWelcome(page);
  await page.goto("/?input=script");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#check-title")).toHaveText("Point at the Lit Bottle");
  let crosshairs = 0;
  let sawMoment = false;
  await passAimCheck(page, async () => {
    const state = await snapshot(page);
    if (state.crosshairShown && !state.checkDone) crosshairs++;
    if (await page.locator(".ready-moment").isVisible()) {
      sawMoment = true;
      await expect(page.locator(".ready-moment")).toContainText("The crosshair now follows your finger.");
    }
  });
  expect(crosshairs).toBe(0);
  expect(sawMoment, "the Aim Set moment shows, only fading").toBe(true);
  // The moment is shorter with Reduce Motion (0.9 s), and the round begins, with the crosshair.
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  expect((await snapshot(page)).crosshairShown).toBe(true);
  expect(errors).toEqual([]);
});
