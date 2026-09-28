// Dead of Night with a scripted hand: the aim check on the nine mason jars,
// into the night, a shot, and the reload by pointing off the screen.
import { expect, test } from "@playwright/test";
import { handAt, moveTo, passAimCheck, pose, shoot, shot, skipWelcome, snapshot } from "./helpers";

test("a scripted hand through the jars' aim check into the night, and a reload off the screen", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/?input=script#dead-of-night");
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("check");
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#check-title")).toHaveText("Shoot the lit target.");
  // The jars are the check's targets, spread over the view.
  const lit = (await snapshot(page)).lit;
  expect(lit?.id).toMatch(/^jar\.\d$/);
  await shot(page, info, "night-script-01-aim-check");

  const shots = await passAimCheck(page);
  expect(shots).toBeGreaterThanOrEqual(6);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", "8 of 8 rounds");

  // The hand fires in the night too: a round leaves the rifle.
  await shoot(page, 0.5, 0.55);
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^7 of 8 rounds/);
  // And pointing off the screen reloads it, round by round.
  await moveTo(page, 1.35, 0.5);
  await page.waitForTimeout(500);
  await moveTo(page, 0.5, 0.5);
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", "8 of 8 rounds", { timeout: 5_000 });
  await shot(page, info, "night-script-02-play");
  expect(errors).toEqual([]);
});
