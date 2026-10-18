// Every screen the app can show, photographed at each size the design must
// hold at (1440x900 at 1x and 2x, and a narrow 900-wide window), for review
// against DESIGN.md. The moments that happen by chance in play - a wave's
// title card, being hit, a secret - are staged through the HUD directly.
import { expect, test, type Page } from "@playwright/test";
import { handAt, passAimCheck, pose, shoot, shot, returningVisitor, snapshot } from "./helpers";

async function stage(page: Page, script: string): Promise<void> {
  await page.evaluate(script);
}

test("first run, the landing and the arcade", async ({ page }, info) => {
  await page.goto("/");
  // A first visit lands on the landing, with the two spaces side by side.
  await expect(page.locator("#landing")).toBeVisible();
  await page.mouse.move(1, 1);
  await shot(page, info, "02-landing", 1200);
  await page.getByRole("link", { name: "Play" }).click();
  await expect(page.locator("#arcade")).toBeVisible();
  await page.mouse.move(1, 1);
  await shot(page, info, "02-arcade");
  // The Konami code, typed on the arcade.
  for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
    await page.keyboard.press(key);
  }
  await expect(page.locator("#toast")).toHaveText("Golden guns, until you go.");
  await shot(page, info, "03-golden-unlocked");
  // Typed again, it has nothing more to give.
  for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
    await page.keyboard.press(key);
  }
  await expect(page.locator("#toast")).toHaveText("Still gold.");
  await page.getByRole("button", { name: "Privacy" }).click();
  await expect(page.locator("#privacy")).toBeVisible();
  await shot(page, info, "04-privacy");
});

test("the camera's question and getting ready", async ({ page }, info) => {
  await returningVisitor(page);
  // As a first visit, where the browser has not yet been asked.
  await page.addInitScript(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) =>
      descriptor.name === ("camera" as PermissionName)
        ? Promise.resolve({ state: "prompt", onchange: null } as unknown as PermissionStatus)
        : query(descriptor);
  });
  // Hold the hand model back a moment, so the loading bar is caught part way.
  await page.route("**/models/hand_landmarker.task", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  await page.goto("/#arcade");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.locator("#prime")).toBeVisible();
  await shot(page, info, "05-camera-question");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#loading")).toBeVisible();
  await expect(page.locator("#loading-title")).toHaveText(/Getting ready… \d+%/);
  await shot(page, info, "06-getting-ready");
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("check");
  await expect.poll(async () => (await snapshot(page)).tracker?.stats.framesWithHand ?? 0, { timeout: 30_000 }).toBeGreaterThan(5);
  await shot(page, info, "07-aim-check-camera");
});

test("the aim check and play", async ({ page }, info) => {
  await returningVisitor(page);
  await page.goto("/?input=script#arcade");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await pose(page, handAt(0.5, 0.5));
  await shot(page, info, "08-aim-check");
  await passAimCheck(page, async (n) => {
    // No crosshair while the aim is learned: the lit bottle, the words and a ring that fills.
    if (n === 2) await shot(page, info, "09-aim-check-learning");
    if (n === 4) await shot(page, info, "10-aim-check-measuring");
    // The ready moment lasts a second and a half: caught as it arrives, with the crosshair under it.
    if (await page.locator(".ready-moment").isVisible()) await shot(page, info, "11-aim-set", 250);
  });
  // A narrow window may show fewer targets than a first check needs; then
  // it ends with Play Anyway instead of the ready moment.
  await expect.poll(async () => (await snapshot(page)).lastCheck?.ended ?? null, { timeout: 5_000 }).not.toBeNull();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  await pose(page, handAt(0.55, 0.45));
  await page.waitForTimeout(2600); // the first wave's card comes and goes
  // Stage the HUD's moments: a shot that lands, being hit from the right,
  // a secret, a hint, three rounds left.
  await stage(
    page,
    `(() => {
      const hud = window.handyTest.hud();
      hud.score(12450);
      hud.readouts([{ label: "Wave", value: "3" }, { label: "Gang", value: "5", meter: 0.6 }, { label: "Streak", value: "×3", meter: 0.67 }]);
      hud.ammo(3, 6, false);
      hud.banner("Wave 3", "Runners cross the street.");
      hud.hitMarker(0.55, 0.45, "headshot");
      hud.popup(0.55, 0.39, "+450 Quick Draw", "gold");
      hud.damage(1.1, 0.45);
      hud.secret("The Bell", 2, 8);
      hud.hint("Point off the screen to reload.");
    })()`,
  );
  await page.waitForTimeout(120);
  await shot(page, info, "12-play-hud", 0);
  await shoot(page, 0.5, 0.5);
  await pose(page, null);
  // A hand gone for a moment is said; gone for longer, the round waits for it.
  await expect(page.locator("#hint")).toHaveText("Show your hand to the camera.");
  await shot(page, info, "13-play-hand-lost", 250);
  await expect.poll(async () => (await snapshot(page)).hold, { timeout: 5_000 }).toBe("lost");
  await shot(page, info, "13b-play-hand-held");
  await pose(page, handAt(0.5, 0.5));
  await expect.poll(async () => (await snapshot(page)).hold, { timeout: 5_000 }).toBe("count");
  await shot(page, info, "13c-play-count-in", 200);
  await expect.poll(async () => (await snapshot(page)).held, { timeout: 5_000 }).toBe(false);
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await shot(page, info, "14-paused");
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-sheet")).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).held, { timeout: 5_000 }).toBe(false);
  // The camera stops sending pictures: the round waits under the fixes.
  await page.evaluate(() => window.handyTest!.stall(true));
  await expect(page.locator("#alert")).toBeVisible({ timeout: 10_000 });
  await shot(page, info, "14b-camera-stalled");
  await page.evaluate(() => window.handyTest!.stall(false));
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect.poll(async () => (await snapshot(page)).held, { timeout: 10_000 }).toBe(false);
  await stage(
    page,
    `window.handyTest.hud().gameOver({
      outcome: "Fell on Wave 4", won: false, score: 12450,
      stats: [{ label: "Waves", value: "3" }, { label: "Kills", value: "27" }, { label: "Accuracy", value: "71%" }, { label: "Best Streak", value: "9" }],
      secretsFound: 2, secretsTotal: 8,
    })`,
  );
  await expect(page.locator("#results")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, info, "15-results");
});

test("an aim that will not settle is offered Play Anyway, with one tip", async ({ page }, info) => {
  await returningVisitor(page);
  await page.goto("/?input=script#arcade");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  // A hand that never goes quite where the player looks: every shot lands
  // somewhere else near the target.
  const wander: [number, number][] = [
    [0.09, -0.07],
    [-0.1, 0.06],
    [0.07, 0.08],
    [-0.06, -0.09],
    [0.1, 0.02],
    [-0.08, 0.07],
  ];
  for (let shotIndex = 0; shotIndex < 12; shotIndex++) {
    // Every shot takes its target, so the bottles run out before twelve shots: they are stood up again,
    // a frame later, and the check goes on.
    await expect.poll(async () => (await snapshot(page)).lit, { timeout: 5_000 }).not.toBeNull();
    const lit = (await snapshot(page)).lit!;
    const [dx, dy] = wander[shotIndex % wander.length]!;
    await shoot(page, lit.x + dx, lit.y + dy);
    await page.waitForTimeout(150);
  }
  await expect(page.getByRole("button", { name: "Play Anyway" })).toBeVisible();
  expect((await snapshot(page)).checkDone).toBe(false);
  // The check says it is still learning, with the one tip, and no crosshair has shown.
  await expect(page.locator("#check-title")).toHaveText("Still Learning");
  expect((await snapshot(page)).crosshairShown).toBe(false);
  await shot(page, info, "10b-aim-check-play-anyway");
  await page.getByRole("button", { name: "Play Anyway" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  // The crosshair arrives with the round, and a hint says what it is.
  await expect(page.locator("#hint")).toHaveText("The crosshair now follows your finger.");
  expect((await snapshot(page)).crosshairShown).toBe(true);
});

const TROUBLES: [string, string][] = [
  ["camera-denied", "Camera Is Off"],
  ["camera-busy", "Camera Is Busy"],
  ["camera-missing", "No Camera Found"],
  ["camera-insecure", "Camera Unavailable"],
  ["model", "Couldn’t Get Ready"],
  ["game", "Couldn’t Load the Game"],
  ["webgl", "3D Is Turned Off"],
];

test("trouble, said calmly with the fix as a button", async ({ page }, info) => {
  await returningVisitor(page, { "handy.camera-opened.v1": true });
  for (const [kind, title] of TROUBLES) {
    await page.goto(`/?fail=${kind}#arcade`);
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.locator("#alert")).toBeVisible();
    await expect(page.locator("#alert-title")).toHaveText(title);
    await shot(page, info, `16-trouble-${kind}`);
  }
});
