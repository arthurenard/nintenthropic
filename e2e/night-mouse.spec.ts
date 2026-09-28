// Dead of Night with the mouse: the arcade, the rifle (a shot works the
// lever, R reloads round by round), a whole wave shot out of the fog, the
// breather, pause, the fall at the barricade and the results.
import { expect, test, type Page } from "@playwright/test";
import { gameDebug, shot, skipWelcome, snapshot } from "./helpers";

interface Target {
  kind: string;
  state: string;
  x: number;
  y: number;
  hx: number;
  hy: number;
  distance: number;
}

/** Shoots the nearest of the dead in view, at its head, through the page's own mouse. Returns whether it fired. */
async function shootNearest(page: Page, range: number): Promise<boolean> {
  const targets = (await gameDebug(page, "debug.targets()")) as Target[];
  const live = targets.filter((t) => t.distance < range && t.state !== "dying" && t.hx > 0.02 && t.hx < 0.98 && t.hy > 0.05 && t.hy < 0.95);
  if (!live.length) return false;
  const t = live.reduce((a, b) => (a.distance < b.distance ? a : b));
  const box = (await page.locator("#stage").boundingBox())!;
  await page.mouse.click(box.x + t.hx * box.width, box.y + (t.hy + 0.006) * box.height);
  return true;
}

test("Dead of Night with the mouse: a wave, the rifle, pause, the fall, the results", async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page, { "handy.control.v1": "mouse" });
  await page.goto("/#dead-of-night");
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("play");
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "true");
  await page.mouse.move(720, 420);
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", "8 of 8 rounds");
  await shot(page, info, "night-mouse-01-play");

  // A click is a shot: a round leaves the rifle and the lever is worked.
  await page.mouse.click(720, 420);
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^7 of 8 rounds/);
  // R reloads: the round goes back in through the gate.
  await page.keyboard.press("r");
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", "8 of 8 rounds", { timeout: 5_000 });

  // Wave 1: shoot the dead as they come out of the fog until the road is clear.
  const deadline = Date.now() + 150_000;
  let wave = 1;
  while (Date.now() < deadline) {
    wave = (await gameDebug(page, "debug.match().wave")) as number;
    if (wave >= 2) break;
    const rounds = (await gameDebug(page, "debug.match().rifle.rounds")) as number;
    if (rounds === 0) {
      await page.keyboard.press("r");
      await page.waitForTimeout(1300);
      continue;
    }
    const fired = await shootNearest(page, 32);
    await page.waitForTimeout(fired ? 480 : 250);
  }
  expect(wave, "the first wave is cleared by shooting").toBeGreaterThanOrEqual(2);
  expect((await gameDebug(page, "debug.match().scorer.kills")) as number).toBeGreaterThanOrEqual(6);
  expect(Number((await page.locator("#score").textContent())?.replace(/,/g, ""))).toBeGreaterThan(0);
  await shot(page, info, "night-mouse-02-breather", 300);

  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
  await shot(page, info, "night-mouse-03-paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#pause-sheet")).toBeHidden();

  // The dead crowd the barricade, and the night takes you.
  await gameDebug(page, "[1, 2, 3, 4, 5].map(() => debug.send('walker', 'road', 49))");
  const results = page.locator("#results");
  await expect(results).toBeVisible({ timeout: 40_000 });
  await expect(page.locator("#results-outcome")).toHaveText(/^Fell on Wave \d+$/);
  await expect(page.locator("#results-note")).toHaveText("A walker at the barricade. Aim for the head — three body shots take too long.");
  await expect(page.locator("#results-game")).toHaveText(/^Dead of Night/);
  await page.waitForTimeout(1200);
  await shot(page, info, "night-mouse-04-results");

  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#home")).toBeVisible();
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  expect(errors).toEqual([]);
});
