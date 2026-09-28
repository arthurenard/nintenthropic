// (d) Hand play when things go wrong between the camera and the game: a hand
// that goes (the round waits for it and counts the player back in), a camera
// that stops (the round waits under a sheet with the fixes), the results
// played again with a fold of the thumb, the idle world at rest, and a window
// resized mid-round with the aim still true.
import { expect, test, type Page } from "@playwright/test";
import { gameDebug, handAt, moveTo, playWithHand, pose, shoot, shot, skipWelcome, snapshot } from "./helpers";

const state = (page: Page) => snapshot(page);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** The game's clock, to see that a held world stands still. */
function gameTime(page: Page): Promise<number> {
  return gameDebug(page, "debug.match().time ?? 0") as Promise<number>;
}

test("a hand gone in play holds the round, and a 3-2-1 brings it back", async ({ page }, info) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  await page.waitForTimeout(600);
  await pose(page, null);
  // Said first, then held once it has been gone longer than any reload's swing.
  await expect(page.locator("#hint")).toHaveText("Show your hand to the camera.");
  expect((await state(page)).held).toBe(false);
  await expect.poll(async () => (await state(page)).hold, { timeout: 5_000 }).toBe("lost");
  const held = await state(page);
  expect(held.held).toBe(true);
  expect(held.running).toBe(false); // the world stands still...
  expect(held.tracking).toBe(true); // ...while the camera goes on looking
  await expect(page.locator("#hold-card")).toBeVisible();
  await expect(page.locator("#hold-title")).toHaveText("Show Your Hand");
  await expect(page.getByRole("button", { name: "Pause Menu" })).toBeVisible();
  await expect(page.locator("#hint")).toBeHidden();
  await expect(page.locator("#announce")).toHaveText(/Show your hand/);
  const frozen = await gameTime(page);
  await page.waitForTimeout(700);
  expect(await gameTime(page)).toBe(frozen);
  await shot(page, info, "hold-01-hand-lost");

  // Back, steadily: counted in.
  await pose(page, handAt(0.5, 0.5));
  await expect.poll(async () => (await state(page)).hold, { timeout: 5_000 }).toBe("count");
  await expect(page.locator("#hold-count")).toBeVisible();
  await shot(page, info, "hold-02-countdown", 200);
  // A hand that drops during the count goes back to waiting.
  await pose(page, null);
  await expect.poll(async () => (await state(page)).hold, { timeout: 5_000 }).toBe("lost");
  await pose(page, handAt(0.5, 0.5));
  await expect.poll(async () => (await state(page)).hold, { timeout: 5_000 }).toBe("count");
  await expect.poll(async () => (await state(page)).held, { timeout: 5_000 }).toBe(false);
  const after = await state(page);
  expect(after.running).toBe(true);
  expect(after.hold).toBeNull();
  await expect.poll(() => gameTime(page)).toBeGreaterThan(frozen);
  // The hand fires again: nothing stale fired on the way back.
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "6 of 6 rounds");
  await shoot(page, 0.5, 0.6);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  expect(errors).toEqual([]);
});

test("swinging the hand out of the picture reloads without holding the round", async ({ page }) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  await shoot(page, 0.5, 0.6);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  // A swing across and out past the right edge, gone for a second, and back.
  for (const x of [0.75, 1.0, 1.25]) {
    await pose(page, handAt(x, 0.5));
    await page.waitForTimeout(50);
  }
  await pose(page, null);
  await page.waitForTimeout(1000);
  // Gone that long for a reload is not a lost hand: nothing asked for it.
  const hint = page.locator("#hint");
  expect((await hint.isVisible()) ? await hint.textContent() : null).not.toBe("Show your hand to the camera.");
  await pose(page, handAt(0.5, 0.5));
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "6 of 6 rounds", { timeout: 5_000 });
  expect((await state(page)).held).toBe(false);
  expect(errors).toEqual([]);
});

test("another hand coming into the picture neither takes the aim nor fires", async ({ page }) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  await moveTo(page, 0.3, 0.55);
  await page.waitForTimeout(500);
  // Someone else's hand across the picture, thumb down, for a moment: staged
  // in the page so the moment is short however busy the machine.
  const seen = await page.evaluate(
    async ({ theirs, mine }) => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const host = window.handyTest!.internals().host!;
      const before = host.aim(performance.now());
      window.handyTest!.pose(theirs);
      await sleep(150);
      const during = host.aim(performance.now());
      window.handyTest!.pose(mine);
      await sleep(250);
      return { before, during, after: host.aim(performance.now()) };
    },
    { theirs: handAt(0.97, 0.2, 72), mine: handAt(0.3, 0.55) },
  );
  expect(seen.before.tracking).toBe(true);
  expect(seen.during.fired || seen.after.fired).toBe(false);
  expect(seen.during.x).toBeCloseTo(seen.before.x, 2);
  expect(seen.during.y).toBeCloseTo(seen.before.y, 2);
  expect(seen.after.tracking).toBe(true);
  expect(seen.after.x).toBeCloseTo(0.3, 1);
  await page.waitForTimeout(300);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "6 of 6 rounds");
  expect(errors).toEqual([]);
});

test("pausing while the round waits for the hand, and resuming through the count", async ({ page }) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  await pose(page, null);
  await expect.poll(async () => (await state(page)).hold, { timeout: 5_000 }).toBe("lost");
  await page.getByRole("button", { name: "Pause Menu" }).click();
  await expect(page.locator("#pause-sheet")).toBeVisible();
  const paused = await state(page);
  expect(paused.paused).toBe(true);
  expect(paused.tracking).toBe(false);
  expect(paused.hold).toBeNull();
  await pose(page, handAt(0.5, 0.5));
  // Resume with the hand: not straight into the fight, but counted in.
  await page.getByRole("button", { name: "Resume" }).click();
  const resumed = await state(page);
  expect(resumed.held).toBe(true);
  expect(resumed.running).toBe(false);
  await expect.poll(async () => (await state(page)).hold, { timeout: 5_000 }).toBe("count");
  await expect.poll(async () => (await state(page)).held, { timeout: 5_000 }).toBe(false);
  expect((await state(page)).running).toBe(true);

  // P pauses and resumes from the keyboard the same way.
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeHidden();
  expect((await state(page)).held).toBe(true);
  await expect.poll(async () => (await state(page)).held, { timeout: 5_000 }).toBe(false);
  expect(errors).toEqual([]);
});

test("a camera that stops sending pictures mid-round: Try Again keeps the round", async ({ page }, info) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  await shoot(page, 0.5, 0.6);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  const checkBefore = (await state(page)).lastCheck;
  await page.evaluate(() => window.handyTest!.stall(true));
  await expect(page.locator("#alert")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#alert-title")).toHaveText("Camera Stopped");
  await expect(page.locator("#alert-body")).toHaveText("Your camera stopped sending a picture. Check it, then Try Again.");
  await expect(page.locator("#alert .button:visible")).toHaveText(["Try Again", "Use Mouse or Trackpad", "Choose a Game"]);
  const troubled = await state(page);
  expect(troubled.troubled).toBe(true);
  expect(troubled.running).toBe(false);
  expect(troubled.phase).toBe("play");
  await shot(page, info, "hold-03-camera-stalled");
  // Esc does not dismiss it: the round waits for a choice.
  await page.keyboard.press("Escape");
  await expect(page.locator("#alert")).toBeVisible();

  await page.evaluate(() => window.handyTest!.stall(false));
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect.poll(async () => (await state(page)).held, { timeout: 10_000 }).toBe(false);
  const back = await state(page);
  expect(back.phase).toBe("play");
  expect(back.running).toBe(true);
  expect(back.troubled).toBe(false);
  expect(back.lastCheck).toEqual(checkBefore); // the same round, no new aim check
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  expect(errors).toEqual([]);
});

test("a camera unplugged mid-round: carry on with the mouse", async ({ page }, info) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  await shoot(page, 0.5, 0.6);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "5 of 6 rounds");
  await page.evaluate(() => window.handyTest!.unplug());
  await expect(page.locator("#alert")).toBeVisible();
  await expect(page.locator("#alert-title")).toHaveText("Camera Stopped");
  await expect(page.locator("#alert-body")).toHaveText("Your camera disconnected. Reconnect it, then Try Again.");
  await shot(page, info, "hold-04-camera-unplugged");
  await page.getByRole("button", { name: "Use Mouse or Trackpad" }).click();
  await expect(page.locator("#alert")).toBeHidden();
  const now = await state(page);
  expect(now.input).toBe("mouse");
  expect(now.phase).toBe("play");
  expect(now.running).toBe(true);
  await expect(page.locator("#pip")).toBeHidden();
  await expect(page.locator("#game")).toHaveAttribute("data-input", "mouse");
  await expect(page.locator("#hint")).toHaveText("Click to fire.");
  // The same round, with the pointer.
  await page.mouse.move(720, 430);
  await page.mouse.click(720, 430);
  await expect(page.locator("#cylinder")).toHaveAttribute("aria-label", "4 of 6 rounds");
  expect(errors).toEqual([]);
});

test("another camera after Try Again starts the round afresh with its own aim check", async ({ page }) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  await page.evaluate(() => {
    window.handyTest!.device("another-camera");
    window.handyTest!.unplug();
  });
  await expect(page.locator("#alert")).toBeVisible();
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect.poll(async () => (await state(page)).phase, { timeout: 10_000 }).toBe("check");
  // No aim is saved for this camera: the check starts from the beginning.
  await expect(page.locator("#check-title")).toHaveText("Shoot the lit target.");
  expect((await state(page)).running).toBe(true);
  expect(errors).toEqual([]);
});

test("the results: a fold of the thumb plays again, and the world rests", async ({ page }, info) => {
  const errors = watchErrors(page);
  await playWithHand(page);
  // As the card arrives: a quick fold while it is still settling, which must
  // not count, and the thumb up again. Staged in the page, on the card's
  // own clock, so a busy machine cannot make it late.
  const early = page.evaluate(
    ({ up, folded }) =>
      new Promise<void>((resolve) => {
        const results = document.getElementById("results") as HTMLDialogElement;
        const wait = () => {
          if (!results.open) return void setTimeout(wait, 10);
          setTimeout(() => window.handyTest!.pose(folded), 250);
          setTimeout(() => {
            window.handyTest!.pose(up);
            resolve();
          }, 450);
        };
        wait();
      }),
    { up: handAt(0.5, 0.5), folded: handAt(0.5, 0.5, 72) },
  );
  await page.evaluate(() =>
    window.handyTest!.hud().gameOver({
      outcome: "Fell on Wave 2",
      won: false,
      score: 2450,
      stats: [
        { label: "Waves", value: "1" },
        { label: "Kills", value: "6" },
        { label: "Accuracy", value: "64%" },
        { label: "Best Streak", value: "4" },
      ],
      secretsFound: 1,
      secretsTotal: 8,
    }),
  );
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#results-fire")).toBeVisible();
  await expect(page.locator("#results-fire")).toHaveText("Or fold your thumb to play again.");
  expect((await state(page)).tracking).toBe(true);
  // The fold while the card was still arriving is not the one that counts.
  await early;
  await page.waitForTimeout(300);
  expect((await state(page)).phase).toBe("over");
  // Once the world has played out under the card, it stops drawing.
  await expect.poll(async () => (await state(page)).running, { timeout: 6_000 }).toBe(false);
  expect((await state(page)).idle).toBe(true);
  await shot(page, info, "hold-05-results-fire");
  await shoot(page, 0.5, 0.5);
  await expect.poll(async () => (await state(page)).phase, { timeout: 5_000 }).toBe("check");
  await expect(page.locator("#results")).toBeHidden();
  expect((await state(page)).running).toBe(true);
  expect(errors).toEqual([]);
});

test("the aim check says how to frame the hand, once it has seen a problem for a moment", async ({ page }, info) => {
  const errors = watchErrors(page);
  await skipWelcome(page);
  await page.goto("/?input=script");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await state(page)).phase, { timeout: 60_000 }).toBe("check");
  const trigger = page.locator("#trigger");
  await pose(page, handAt(0.5, 0.5));
  await expect(trigger).toHaveAttribute("data-state", "ready");
  // Far from the camera: a small hand in the picture.
  await pose(page, { thumbDegrees: 18, indexTip: [0.5, 0.5], wrist: [0.51, 0.58], scale: 0.3 });
  await page.waitForTimeout(500);
  await expect(trigger).not.toHaveAttribute("data-state", "closer"); // not at once: it would flicker
  await expect(trigger).toHaveAttribute("data-state", "closer", { timeout: 5_000 });
  await expect(trigger).toHaveText("Come a little closer");
  await shot(page, info, "check-help-closer", 300);
  // Too near.
  await pose(page, { thumbDegrees: 18, indexTip: [0.5, 0.35], wrist: [0.52, 0.95], scale: 1.8 });
  await expect(trigger).toHaveText("Move back a little", { timeout: 5_000 });
  // At the picture's edge.
  await pose(page, { thumbDegrees: 18, indexTip: [0.975, 0.45], wrist: [0.95, 0.75], scale: 0.9 });
  await expect(trigger).toHaveText("Keep your hand in the picture", { timeout: 5_000 });
  // Framed well again: the help goes.
  await pose(page, handAt(0.5, 0.5));
  await expect(trigger).toHaveAttribute("data-state", "ready", { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test("getting ready offline says so, with the fix", async ({ page, context }, info) => {
  await skipWelcome(page, { "handy.camera-opened.v1": true });
  await page.goto("/");
  await expect(page.locator("#home")).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.locator("#alert")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#alert-title")).toHaveText("You’re Offline");
  await expect(page.locator("#alert-body")).toHaveText("Connect to the internet, then Try Again.");
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  await shot(page, info, "offline-01");
  await context.setOffline(false);
});

test("a paused game and resting results cost no frames", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    (window as unknown as { frames: number }).frames = 0;
    window.requestAnimationFrame = (callback) => {
      (window as unknown as { frames: number }).frames++;
      return raf(callback);
    };
  });
  const frames = () => page.evaluate(() => (window as unknown as { frames: number }).frames);
  await playWithHand(page);
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await page.waitForTimeout(400);
  const before = await frames();
  await page.waitForTimeout(1000);
  expect((await frames()) - before).toBeLessThanOrEqual(1);
  expect((await state(page)).tracking).toBe(false);
  expect(errors).toEqual([]);
});

test("a window resized mid-round keeps the crosshair where the shots land", async ({ page }, info) => {
  const errors = watchErrors(page);
  // Reduced motion: the view neither breathes nor eases, so a spot stays put.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await playWithHand(page);
  await gameDebug(page, "debug.setImmortal(true)");
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForTimeout(600);
  // A spot that stays where it is: the weather vane, on its roof.
  const vane = (await gameDebug(page, `debug.targets().find((t) => t.kind === "secret.vane")`)) as { x: number; y: number } | undefined;
  expect(vane, "the weather vane is in view").toBeTruthy();
  await pose(page, handAt(vane!.x, vane!.y));
  await page.waitForTimeout(500);
  // The crosshair is drawn where the hand points, in the new view...
  const aim = (await page.evaluate(() => window.handyTest!.internals().host!.aim(performance.now()))) as { x: number; y: number };
  expect(Math.abs(aim.x - vane!.x)).toBeLessThan(0.006);
  expect(Math.abs(aim.y - vane!.y)).toBeLessThan(0.006);
  await shot(page, info, "resize-01-aimed", 0);
  // ...and the shot lands there: the vane spins, and it is a secret found.
  await shoot(page, vane!.x, vane!.y);
  await expect(page.locator(".secret")).toContainText("The Weather Vane", { timeout: 15_000 });
  expect(errors).toEqual([]);
});
