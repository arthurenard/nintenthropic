// Orbital Decay: the mouse through a whole pass (shooting what comes at the
// glass, overheating and venting with the right button), the scripted hand
// through the running lights' aim check into play (venting by pointing off
// the screen), pause, and the glass giving way into the results.
import { expect, test, type Page } from "@playwright/test";
import { gameDebug, handAt, moveTo, passAimCheck, pose, shoot, shot, skipWelcome, snapshot } from "./helpers";

type Target = { kind: string; id: number; x: number; y: number; distance: number; closing: number | null };

const targets = (page: Page) => gameDebug(page, "debug.targets()") as Promise<Target[]>;
const heatLabel = (page: Page) => page.locator("#heat").getAttribute("aria-label");
const heatPercent = async (page: Page) => Number(/(\d+)%/.exec((await heatLabel(page)) ?? "")?.[1] ?? 0);

async function playOrbit(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}#orbital-decay`);
  await expect(page.locator("#feature-title")).toHaveText("Orbital Decay");
  await page.getByRole("button", { name: "Play", exact: true }).click();
}

/** A viewport fraction of the stage, in page pixels. */
async function onStage(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.locator("#stage").boundingBox())!;
  return [box.x + x * box.width, box.y + y * box.height];
}

test("the mouse through a pass: shooting, overheating, venting, the breather", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page, { "handy.control.v1": "mouse" });
  await playOrbit(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("play");
  await expect(page.locator("#heat")).toBeVisible();
  await expect(page.locator("#heat")).toHaveAttribute("aria-label", "Heat 0%");
  // The corner panel: the pass, and the glass as the cupola in miniature.
  await expect(page.locator("#readouts dt").first()).toHaveText("Pass");
  await expect(page.locator("#readouts .segments.ring .seg")).toHaveCount(7);
  await page.mouse.move(...(await onStage(page, 0.5, 0.45)));
  await shot(page, info, "orbit-mouse-01-play");

  // A burst into the dark overheats the laser; the right button vents it.
  for (let i = 0; i < 9; i++) {
    await page.mouse.click(...(await onStage(page, 0.5, 0.1)));
    await page.waitForTimeout(140);
  }
  await expect(page.locator("#heat")).toHaveAttribute("aria-label", /^Overheated, cooling/);
  await expect(page.locator("#hint")).toHaveText("Right-click or press V to vent the laser.");
  await shot(page, info, "orbit-mouse-02-overheated", 200);
  await page.mouse.click(...(await onStage(page, 0.5, 0.1)), { button: "right" });
  await expect.poll(() => heatPercent(page), { timeout: 3_000 }).toBe(0);
  await expect(page.locator("#heat")).toHaveAttribute("aria-label", "Heat 0%");

  // Through the pass: shoot what is coming, most urgent first; vent when hot.
  let cleared = false;
  for (let i = 0; i < 400 && !cleared; i++) {
    const list = (await targets(page)).filter((t) => t.kind !== "drone" && t.x > 0.03 && t.x < 0.97 && t.y > 0.03 && t.y < 0.97);
    list.sort((a, b) => (a.closing ?? 99) - (b.closing ?? 99));
    const t = list[0];
    if ((await heatPercent(page)) > 70) {
      await page.keyboard.press("v");
      await page.waitForTimeout(650);
    } else if (t) {
      await page.mouse.click(...(await onStage(page, t.x, t.y)));
      await page.waitForTimeout(160);
    } else {
      await page.waitForTimeout(250);
    }
    cleared = (await gameDebug(page, "debug.match().phase")) === "breather";
  }
  expect(cleared).toBe(true);
  await expect(page.locator("#score")).not.toHaveText("0");
  // The night side, and the next pass's title card.
  await expect(page.locator(".banner .title1")).toHaveText("Pass 2", { timeout: 10_000 });
  await shot(page, info, "orbit-mouse-03-breather", 0);
  await expect.poll(async () => gameDebug(page, "debug.match().pass"), { timeout: 10_000 }).toBe(2);

  // Pause and resume.
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
  await shot(page, info, "orbit-mouse-04-paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#pause-sheet")).toBeHidden();

  // The glass gives way: the burst, the shutters, the card, then the results.
  await gameDebug(page, "debug.breach()");
  await expect(page.locator(".banner .title1")).toHaveText(/^The pane failed on Pass \d\.$/, { timeout: 15_000 });
  await shot(page, info, "orbit-mouse-05-failed", 0);
  await expect(page.locator("#results")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#results-outcome")).toHaveText(/^Breached on Pass \d$/);
  await expect(page.locator("#results-stats div")).toHaveCount(4);
  await page.waitForTimeout(1200);
  await shot(page, info, "orbit-mouse-06-results");
  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#home")).toBeVisible();
  await expect(page.locator("#feature-title")).toHaveText("Orbital Decay");
  expect(errors).toEqual([]);
});

test("the scripted hand: the running lights' aim check, a shot, venting off the screen", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await playOrbit(page, "?input=script");
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("check");
  await pose(page, handAt(0.5, 0.5));
  // Nine running lights to shoot, spread over the view.
  const lit = (await snapshot(page)).lit;
  expect(lit).not.toBeNull();
  await shot(page, info, "orbit-hand-01-aim-check");
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#heat")).toBeVisible();
  // The hand fires: the laser heats.
  await shoot(page, 0.5, 0.3);
  await expect.poll(() => heatPercent(page), { timeout: 3_000 }).toBeGreaterThan(0);
  await shot(page, info, "orbit-hand-02-play");
  // Pointing off the screen vents it.
  await moveTo(page, 1.35, 0.5);
  await page.waitForTimeout(500);
  await moveTo(page, 0.5, 0.5);
  await expect.poll(() => heatPercent(page), { timeout: 3_000 }).toBe(0);
  // Pause, and back through the count.
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await snapshot(page)).held, { timeout: 10_000 }).toBe(false);
  expect(errors).toEqual([]);
});
