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
  await shot(page, info, "ridge-01-valley");
  // Held breath: no sway, so the test's aim is the aim.
  await gameDebug(page, "debug.still(true)");

  // The right button scopes in, where the mouse points; the page's crosshair gives way.
  await page.mouse.down({ button: "right" });
  await expect.poll(() => gameDebug(page, "debug.scoped()")).toBe(true);
  await expect.poll(() => gameDebug(page, "debug.zoom()")).toBeGreaterThan(0.99);
  await shot(page, info, "ridge-02-scoped", 200);
  await page.mouse.up({ button: "right" });
  await expect.poll(() => gameDebug(page, "debug.scoped()")).toBe(false);

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
  await expect(page.locator("#check-title")).toHaveText("Shoot the lit target.");
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
