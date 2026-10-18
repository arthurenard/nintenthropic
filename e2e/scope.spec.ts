// The scope, in a game that has one (the Test Range, ?range=1): closing one
// eye with the scripted hand's scripted face, Shift and the right mouse
// button held or toggled, the touch screen's Scope button, the Settings
// group, and the face landmarker loading with the first such game.
import { expect, test, type Page } from "@playwright/test";
import { handAt, passAimCheck, pose, shot, returningVisitor, snapshot } from "./helpers";

type ScopeState = { active: boolean; buttons: boolean; eye: boolean; mode: string } | null;
const scope = async (page: Page) => (await page.evaluate(() => window.arcadeTest!.snapshot() as unknown as { scope: ScopeState })).scope;
const crosshairHidden = async (page: Page) => (await page.evaluate(() => window.arcadeTest!.snapshot() as unknown as { crosshairHidden: boolean })).crosshairHidden;
const gameScoped = (page: Page) => page.evaluate(() => (window.arcadeTest!.internals().session!.game as unknown as { debug: { scoped(): boolean } }).debug.scoped());
const eyes = (page: Page, left: number, right: number) => page.evaluate(([l, r]) => window.arcadeTest!.eyes(l === -1 ? null : { blinkLeft: l!, blinkRight: r! }), [left, right]);

async function playRange(page: Page, query = "", control: "mouse" | "hand" = "mouse"): Promise<void> {
  await returningVisitor(page, control === "mouse" ? { "handy.control.v1": "mouse" } : {});
  await page.goto(`/?range=1${query}#test-range`);
  await expect(page.locator("#feature-title")).toHaveText("Test Range");
  await page.getByRole("button", { name: "Play", exact: true }).click();
}

test("closing one eye scopes, a blink never does, and the game draws its own reticle", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playRange(page, "&input=script", "hand");
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await eyes(page, 0.05, 0.07);
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await pose(page, handAt(0.5, 0.5));
  expect(await scope(page)).toMatchObject({ active: false, eye: true, mode: "hold" });

  // A blink: both eyes shut for a tenth of a second, again and again.
  for (let i = 0; i < 4; i++) {
    await eyes(page, 0.92, 0.9);
    await page.waitForTimeout(100);
    await eyes(page, 0.05, 0.07);
    expect((await scope(page))!.active).toBe(false);
    await page.waitForTimeout(250);
  }
  expect(await gameScoped(page)).toBe(false);

  // One eye closed and held: the scope, and the page's crosshair steps aside.
  await eyes(page, 0.84, 0.22);
  await expect.poll(async () => (await scope(page))!.active, { timeout: 2_000 }).toBe(true);
  await expect.poll(() => gameScoped(page), { timeout: 2_000 }).toBe(true);
  expect(await crosshairHidden(page)).toBe(true);
  await shot(page, info, "scope-01-eye", 200);
  // The eye eases a little open: still scoped (the hysteresis).
  await eyes(page, 0.42, 0.2);
  await page.waitForTimeout(400);
  expect((await scope(page))!.active).toBe(true);
  // Open: the scope goes, and the crosshair is back.
  await eyes(page, 0.05, 0.07);
  await expect.poll(async () => (await scope(page))!.active, { timeout: 2_000 }).toBe(false);
  await expect.poll(() => crosshairHidden(page), { timeout: 2_000 }).toBe(false);

  // Close One Eye to Scope turned off (from the pause sheet): the eye no longer scopes.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#scope-group")).toBeVisible();
  await page.getByRole("switch", { name: "Close One Eye to Scope" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await eyes(page, 0.84, 0.22);
  await page.waitForTimeout(600);
  expect((await scope(page))!.active).toBe(false);
  expect(errors).toEqual([]);
});

test("Shift and the right mouse button scope, held or toggled, and the right button no longer reloads", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playRange(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  await page.mouse.move(720, 450);
  expect(await scope(page)).toMatchObject({ active: false, eye: false, mode: "hold" });

  await page.keyboard.down("Shift");
  await expect.poll(async () => (await scope(page))!.active).toBe(true);
  await expect.poll(() => gameScoped(page)).toBe(true);
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await scope(page))!.active).toBe(false);

  // A shot, then the right button: it scopes, and the magazine is not reloaded.
  await page.mouse.click(720, 450);
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^4 of 5 rounds/);
  await page.mouse.down({ button: "right" });
  await expect.poll(async () => (await scope(page))!.active).toBe(true);
  // A left click while the right is held still fires, through the scope.
  await page.waitForTimeout(700);
  await page.mouse.down({ button: "left" });
  await page.mouse.up({ button: "left" });
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", /^3 of 5 rounds/);
  await shot(page, info, "scope-02-mouse", 150);
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => (await scope(page))!.active).toBe(false);
  await page.waitForTimeout(1_200);
  await expect(page.locator("#magazine")).toHaveAttribute("aria-label", "3 of 5 rounds");

  // Toggle, from Settings: a press scopes, the next lets go.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radiogroup", { name: "Scope Button" }).getByRole("radio", { name: "Toggle" }).click();
  await expect(page.locator("#foot-scope")).toHaveText(
    "Close one eye for a moment to look through the scope, or press Shift or the right mouse button: once to look, again to stop.",
  );
  await shot(page, info, "scope-03-settings", 300);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.keyboard.press("Shift");
  await expect.poll(async () => (await scope(page))!.active).toBe(true);
  await page.waitForTimeout(300);
  expect((await scope(page))!.active).toBe(true);
  await page.mouse.click(720, 450, { button: "right" });
  await expect.poll(async () => (await scope(page))!.active).toBe(false);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("handy.scope.v1")))!)).toEqual({ eye: true, button: "toggle" });
  expect(errors).toEqual([]);
});

test("a game without a scope: the right button reloads as before (the Scope settings are Overwatch Ridge's)", async ({ page }) => {
  await returningVisitor(page, { "handy.control.v1": "mouse" });
  await page.goto("/#arcade");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#settings")).toBeVisible();
  // Overwatch Ridge can be played, and it has a scope (and reads the eye).
  await expect(page.locator("#scope-group")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Close One Eye to Scope" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  expect(await scope(page)).toBeNull();
  await page.mouse.click(720, 430);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  await page.mouse.click(720, 430, { button: "right" });
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "6 of 6 rounds", { timeout: 5_000 });
});

test("on a touch screen, the Scope button in the corner", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await playRange(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  expect((await snapshot(page)).input).toBe("touch");
  const button = page.getByRole("button", { name: "Scope" });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeLessThan(844 / 4);
  expect(box.y).toBeGreaterThan(390 / 2);
  await button.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", isPrimary: true });
  await expect.poll(async () => (await scope(page))!.active).toBe(true);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await shot(page, info, "scope-04-touch", 200);
  await button.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", isPrimary: true });
  await expect.poll(async () => (await scope(page))!.active).toBe(false);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await context.close();
});

test("the eye's model loads with the first game that reads it, and the face is read on every other frame", async ({ page }) => {
  await returningVisitor(page, { "handy.camera-opened.v1": true });
  await page.goto("/?range=1#test-range");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("check");
  await expect
    .poll(async () => (await page.evaluate(() => window.arcadeTest!.snapshot() as unknown as { tracker: { stats: { frames: number; face: { frames: number } | null } } | null })).tracker?.stats.face?.frames ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(10);
  const stats = (await page.evaluate(() => window.arcadeTest!.snapshot() as unknown as { tracker: { stats: { frames: number; face: { frames: number } } } })).tracker.stats;
  expect(stats.face.frames / stats.frames).toBeGreaterThan(0.35);
  expect(stats.face.frames / stats.frames).toBeLessThan(0.65);
  // Back in the arcade, a game that does not read the eye leaves the face alone.
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Choose a Game" }).click();
  await page.getByRole("radiogroup", { name: "Games" }).getByRole("radio", { name: /^High Noon/ }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await page.evaluate(() => window.arcadeTest!.resetStats());
  await page.waitForTimeout(1_500);
  const after = (await page.evaluate(() => window.arcadeTest!.snapshot() as unknown as { tracker: { stats: { frames: number; face: unknown } } })).tracker.stats;
  expect(after.frames).toBeGreaterThan(10);
  expect(after.face).toBeNull();
});
