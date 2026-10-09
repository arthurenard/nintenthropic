// (a) The whole game with the mouse: the arcade, High Noon, pause, and the
// results card.
import { expect, test } from "@playwright/test";
import { shot, skipWelcome, snapshot } from "./helpers";

test("the mouse flow: arcade, High Noon, pause, results", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/#arcade");
  await expect(page.locator("#arcade")).toBeVisible();
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  await shot(page, info, "mouse-01-arcade");

  await page.getByRole("button", { name: "Use Mouse or Trackpad" }).click();
  await expect(page.locator("#control-label")).toHaveText("Mouse or Trackpad");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "true");
  await page.mouse.move(720, 430);
  await shot(page, info, "mouse-02-play");

  // A click is a shot: one round leaves the cylinder.
  await page.mouse.click(720, 430);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  // R reloads: the game listens for its own key.
  await page.keyboard.press("r");
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "6 of 6 rounds", { timeout: 5_000 });

  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust Aim" })).toBeHidden(); // the mouse needs no aim setup
  expect((await snapshot(page)).paused).toBe(true);
  await shot(page, info, "mouse-03-paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#pause-sheet")).toBeHidden();
  expect((await snapshot(page)).paused).toBe(false);

  // Left alone, the gang may fell the player. A
  // game that spares an idle player (High Noon's first wave may) is ended
  // as any game ends, through the HUD, so the results card is still seen.
  const results = page.locator("#results");
  const fell = await results.waitFor({ state: "visible", timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  if (!fell) {
    await page.evaluate(() =>
      window.handyTest!.hud().gameOver({
        outcome: "Fell on Wave 1",
        won: false,
        score: 0,
        stats: [
          { label: "Waves", value: "0" },
          { label: "Kills", value: "0" },
          { label: "Accuracy", value: "0%" },
          { label: "Best Streak", value: "0" },
        ],
        secretsFound: 0,
        secretsTotal: 8,
      }),
    );
    await expect(results).toBeVisible();
  }
  await expect(page.locator("#results-outcome")).toHaveText(/Fell on Wave \d|Survived/);
  await expect(page.locator("#results-stats div")).toHaveCount(4);
  // Folding a thumb to play again is for hand players only.
  await expect(page.locator("#results-fire")).toBeHidden();
  await page.waitForTimeout(1200); // the score counts up
  await shot(page, info, "mouse-04-results");

  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#arcade")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a tall window plays in a band the town can fill, and a short one keeps its chrome small", async ({ page }) => {
  await skipWelcome(page, { "handy.control.v1": "mouse" });
  await page.setViewportSize({ width: 420, height: 860 });
  await page.goto("/#arcade");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  // Never taller than 1.1 : 1, centred, with the night above and below.
  const band = (await page.locator("#stage").boundingBox())!;
  expect(band.width).toBeCloseTo(420, 0);
  expect(band.height).toBeCloseTo(420 / 1.1, 0);
  expect(band.y + band.height / 2).toBeCloseTo(430, 0);
  // A click lands where it is inside the band, as anywhere.
  await page.mouse.click(210, band.y + band.height / 2);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");

  // A phone on its side: the score panel shrinks to the corner it has.
  await page.setViewportSize({ width: 667, height: 375 });
  await expect.poll(async () => (await page.locator("#stage").boundingBox())!.height).toBeCloseTo(375, 0);
  const panel = (await page.locator("#hud-score").boundingBox())!;
  expect(panel.height).toBeLessThan(375 * 0.36);
});
