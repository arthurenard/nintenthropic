// (c) A scripted hand - landmarks from a script instead of the camera - drives
// the real aim pipeline (filter, thumb trigger, aim check, fits) through a
// whole aim check to 95% and into play; then, as a returning player, through
// the check again in three shots.
import { expect, test } from "@playwright/test";
import { handAt, passAimCheck, pose, shoot, shot, skipWelcome, snapshot } from "./helpers";

test("a scripted hand passes the aim check at 95% and plays", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/?input=script");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#trigger")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#check-title")).toHaveText("Shoot the lit target.");
  await shot(page, info, "script-01-aim-check");

  const shots = await passAimCheck(page, async (n) => {
    if (n === 2) {
      await expect(page.locator("#check-title")).toHaveText("There’s your crosshair.");
      await shot(page, info, "script-02-crosshair");
    }
  });
  // Six shots: two to learn, one to fit the full map, three to prove it.
  expect(shots).toBe(6);
  await expect.poll(async () => (await snapshot(page)).lastCheck?.ended ?? null, { timeout: 5_000 }).toBe("ready");
  expect((await snapshot(page)).lastCheck!.score!).toBeGreaterThanOrEqual(0.95);
  // The ready moment lasts a second and a half: caught when the game's
  // frames leave the test time to look.
  const moment = page.locator(".ready-moment");
  if (await moment.isVisible()) {
    await expect(moment).toContainText(/Aim \d+%/);
    await expect(moment).toContainText("You’re ready.");
    await shot(page, info, "script-03-ready", 0);
  }

  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  await expect(page.locator("#hud-score")).toBeVisible();
  // The hand fires in play too: a round leaves the cylinder.
  await shoot(page, 0.5, 0.6);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  // And pointing off the screen reloads it.
  await pose(page, handAt(1.35, 0.5));
  await page.waitForTimeout(500);
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "6 of 6 rounds", { timeout: 5_000 });
  await shot(page, info, "script-04-play");

  // A new game begins with the aim check again - measured from the first
  // shot now, so three good ones are enough.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 30_000 }).toBe("check");
  await expect(page.locator("#check-title")).toHaveText("Welcome back.");
  expect(await passAimCheck(page)).toBe(3);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  expect(errors).toEqual([]);
});
