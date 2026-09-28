// Settings, records and preferences: the sheet from the arcade and from a
// paused game, by pointer and by keyboard; what it changes, and that it is
// remembered; a record on the arcade after a game; Reset Handy.
import { expect, test, type Page } from "@playwright/test";
import { passAimCheck, pose, handAt, shot, skipWelcome, snapshot } from "./helpers";

type Preferences = {
  volume: number;
  difficulty: string;
  crosshair: { size: string; highContrast: boolean };
  steadiness: string;
  cameraInPlay: boolean;
  reduceMotion: boolean | null;
  reduceFlashing: boolean;
};
type Extra = { difficulty: string; preferences: Preferences; reducedMotion: boolean; smoothing: { minCutoff: number; beta: number } | null };

const extra = (page: Page) => page.evaluate(() => window.handyTest!.snapshot() as unknown as Extra);

const storedKeys = (page: Page) =>
  page.evaluate(() => {
    const keys: string[] = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i++) keys.push(storage.key(i)!);
    }
    return keys.filter((key) => key.startsWith("handy.")).sort();
  });

/** Ends the round as a game ends it, through the HUD. */
const endRound = (page: Page, score: number, outcome = "Fell on Wave 2", note?: string) =>
  page.evaluate(
    ({ score, outcome, note }) =>
      window.handyTest!.hud().gameOver({
        outcome,
        won: false,
        score,
        note,
        stats: [
          { label: "Waves", value: "1" },
          { label: "Kills", value: "4" },
          { label: "Accuracy", value: "50%" },
          { label: "Best Streak", value: "2" },
        ],
        secretsFound: 0,
        secretsTotal: 8,
      }),
    { score, outcome, note },
  );

/** A difficulty on the sheet ("Standard" is a crosshair size too). */
const pickDifficulty = (page: Page, name: "Relaxed" | "Standard") =>
  page.getByRole("radiogroup", { name: "Difficulty" }).getByRole("radio", { name }).click();

async function mouseGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Use Mouse or Trackpad" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
}

test("the settings sheet from the arcade, by keyboard alone", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/");
  await expect(page.locator("#home")).toBeVisible();
  // The gear is in the arcade's corner, after Privacy and the sound.
  await page.getByRole("button", { name: "Settings" }).focus();
  await page.keyboard.press("Enter");
  const sheet = page.locator("#settings");
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await shot(page, info, "settings-01-arcade");

  // Done first, then the difficulty: one tab stop, the arrows choose.
  await expect(page.getByRole("button", { name: "Done" })).toBeFocused();
  await page.keyboard.press("Tab");
  const standard = page.getByRole("radiogroup", { name: "Difficulty" }).getByRole("radio", { name: "Standard" });
  await expect(standard).toBeFocused();
  await expect(standard).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "Relaxed" })).toBeFocused();
  await expect(page.getByRole("radio", { name: "Relaxed" })).toHaveAttribute("aria-checked", "true");
  await expect(standard).toHaveAttribute("aria-checked", "false");
  expect((await extra(page)).difficulty).toBe("relaxed");

  // The volume: a labelled slider the arrows move.
  await page.keyboard.press("Tab");
  const volume = page.getByRole("slider", { name: "Volume" });
  await expect(volume).toBeFocused();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowLeft");
  await expect(volume).toHaveAttribute("aria-valuetext", "80%");
  expect((await extra(page)).preferences.volume).toBeCloseTo(0.8, 5);

  // The crosshair's size, then High Contrast: a switch Space turns on.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radiogroup", { name: "Crosshair" }).getByRole("radio", { name: "Standard" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Tab");
  const contrast = page.getByRole("switch", { name: "High Contrast" });
  await expect(contrast).toBeFocused();
  await page.keyboard.press("Space");
  await expect(contrast).toHaveAttribute("aria-checked", "true");

  // Aim Steadiness wraps round with the arrows.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Balanced" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Steady" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Responsive" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");

  // Reduce Motion follows the system (not reduced here) until chosen.
  const motion = page.getByRole("switch", { name: "Reduce Motion" });
  await expect(motion).toHaveAttribute("aria-checked", "false");
  await motion.focus();
  await page.keyboard.press("Enter");
  await expect(motion).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");
  await page.getByRole("switch", { name: "Reduce Flashing" }).click();
  await page.getByRole("switch", { name: "Show Camera in Play" }).click();
  await shot(page, info, "settings-02-changed", 300);

  const chosen = await extra(page);
  expect(chosen.preferences).toEqual({
    volume: 0.8,
    difficulty: "relaxed",
    crosshair: { size: "large", highContrast: true },
    steadiness: "steady",
    cameraInPlay: false,
    reduceMotion: true,
    reduceFlashing: true,
  });
  expect(chosen.reducedMotion).toBe(true);

  // Esc closes the sheet and gives the focus back to the gear.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();

  // Everything is remembered.
  await page.reload();
  expect((await extra(page)).preferences).toEqual(chosen.preferences);
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "Relaxed" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("80");
  expect(errors).toEqual([]);
});

test("difficulty persists across a reload, reaches the game, and keeps its own record", async ({ page }, info) => {
  await skipWelcome(page);
  await page.goto("/");
  await expect(page.locator("#home-best")).toBeHidden(); // no record yet
  await page.getByRole("button", { name: "Settings" }).click();
  await pickDifficulty(page, "Relaxed");
  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  expect((await extra(page)).difficulty).toBe("relaxed");

  await mouseGame(page);
  expect((await extra(page)).difficulty).toBe("relaxed");
  await endRound(page, 4321, "Fell on Wave 3", "A rifleman on the bank roof. Watch the rooftops.");
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#results-game")).toHaveText("High Noon · Relaxed");
  await expect(page.locator("#results-note")).toHaveText("A rifleman on the bank roof. Watch the rooftops.");
  await expect(page.locator("#new-best")).toBeVisible();
  await expect(page.locator("#new-best-margin")).toBeHidden(); // the first record beats nothing
  await shot(page, info, "settings-03-results-relaxed", 800);

  // The record is kept under the game, the difficulty and the pointer.
  const kept = await page.evaluate(() => localStorage.getItem("handy.best.v2.high-noon.relaxed.pointer"));
  expect(JSON.parse(kept!)).toMatchObject({ score: 4321, outcome: "Fell on Wave 3" });

  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#home-best")).toHaveText("Your best on Relaxed: 4,321 · Fell on Wave 3");
  await shot(page, info, "settings-04-arcade-record");

  // Standard keeps its own records, and the hand its own.
  await page.getByRole("button", { name: "Settings" }).click();
  await pickDifficulty(page, "Standard");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#home-best")).toBeHidden();

  // Beating a record says by how much; falling short says the best to beat.
  await page.getByRole("button", { name: "Settings" }).click();
  await pickDifficulty(page, "Relaxed");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  await endRound(page, 6431, "Fell on Wave 4");
  await expect(page.locator("#new-best-margin")).toHaveText("+2,110 over your best");
  await expect(page.locator("#new-best-margin")).toBeVisible();
  await shot(page, info, "settings-05-results-new-best", 800);
  await page.getByRole("button", { name: "Play Again" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 30_000 }).toBe("play");
  await endRound(page, 1200, "Fell on Wave 1");
  await expect(page.locator("#results-best")).toHaveText("Best 6,431");
  await expect(page.locator("#results-best")).toBeVisible();
  await expect(page.locator("#new-best")).toBeHidden();
});

test("the settings sheet over a paused game", async ({ page }, info) => {
  await skipWelcome(page);
  await page.goto("/");
  await mouseGame(page);
  await page.keyboard.press("p");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#settings")).toBeVisible();
  await expect(page.locator("#foot-difficulty")).toContainText("A change applies when the next round begins.");
  await shot(page, info, "settings-06-paused");

  // A new difficulty waits for the next round: this one is kept under its own.
  await pickDifficulty(page, "Relaxed");
  let state = await extra(page);
  expect(state.preferences.difficulty).toBe("relaxed");
  expect(state.difficulty).toBe("standard");

  // The sheet's keys are its own: P and Space do not resume the game under it.
  await page.getByRole("radio", { name: "Relaxed" }).focus();
  await page.keyboard.press("p");
  await page.keyboard.press(" ");
  expect((await snapshot(page)).paused).toBe(true);
  await expect(page.locator("#settings")).toBeVisible();

  // Esc: back to the pause sheet, on its Settings button.
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).toBeHidden();
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await expect(page.locator("#pause-settings")).toBeFocused();

  // Restart begins the next round, at the new difficulty.
  await page.getByRole("button", { name: "Restart" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 30_000 }).toBe("play");
  state = await extra(page);
  expect(state.difficulty).toBe("relaxed");
});

test("the camera menu shows only when there is a choice, and the choice is kept", async ({ page }) => {
  await skipWelcome(page);
  await page.addInitScript(() => {
    const devices = [
      { kind: "videoinput", deviceId: "cam-built-in", label: "Built-in Camera", groupId: "a" },
      { kind: "videoinput", deviceId: "cam-desk", label: "Desk Camera", groupId: "b" },
      { kind: "audioinput", deviceId: "mic", label: "Microphone", groupId: "a" },
    ];
    navigator.mediaDevices.enumerateDevices = () => Promise.resolve(devices.map((d) => ({ ...d, toJSON: () => d }) as unknown as MediaDeviceInfo));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const menu = page.getByRole("combobox", { name: "Camera" });
  await expect(menu).toBeVisible();
  await expect(menu.locator("option")).toHaveText(["Built-in Camera", "Desk Camera"]);
  await menu.selectOption("cam-desk");
  expect(await page.evaluate(() => localStorage.getItem("handy.camera-choice.v1"))).toBe('"cam-desk"');
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("combobox", { name: "Camera" })).toHaveValue("cam-desk");
});

test("one camera, no menu; the chosen camera opens, and a missing one gives way", async ({ page }) => {
  await skipWelcome(page, { "handy.camera-choice.v1": "a-camera-long-gone", "handy.camera-opened.v1": true });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#camera-row")).toBeHidden();
  await page.getByRole("button", { name: "Done" }).click();
  // The fake camera opens all the same: the choice falls back gracefully.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe("check");
});

test("the camera's picture steps aside in play when asked, and comes back for the aim setup", async ({ page }) => {
  await skipWelcome(page, { "handy.settings.v1": { cameraInPlay: false, steadiness: "responsive" } });
  await page.goto("/?input=script");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  const pip = page.locator("#pip");
  await expect(pip).toBeVisible();
  // The player's steadiness reaches the hand's filter.
  expect((await extra(page)).smoothing).toEqual({ minCutoff: 2.2, beta: 1.2 });
  await pose(page, handAt(0.5, 0.5));
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("play");
  await expect(pip).toBeHidden();
  // A lost hand brings it back, whatever the setting.
  await pose(page, null);
  await expect(pip).toBeVisible({ timeout: 5_000 });
});

test("Forget Saved Aim forgets every camera's aim, and says so", async ({ page }) => {
  await skipWelcome(page, {
    "handy.aim.v1.cam-a.1280x720": { version: 1 },
    "handy.aim.v1.cam-b.640x480": { version: 1 },
    "handy.best.v2.high-noon.standard.hand": { score: 900, outcome: "Fell on Wave 1", at: 1 },
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Adjust Aim" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const forget = page.getByRole("button", { name: "Forget Saved Aim" });
  await expect(forget).toBeEnabled();
  await forget.click();
  await expect(page.locator("#toast")).toHaveText("Saved aim forgotten.");
  await expect(forget).toBeDisabled();
  expect(await storedKeys(page)).not.toContain("handy.aim.v1.cam-a.1280x720");
  expect(await storedKeys(page)).toContain("handy.best.v2.high-noon.standard.hand");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Adjust Aim" })).toBeHidden();
});

test("Copy System Info copies what a bug report needs", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await skipWelcome(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Copy System Info" }).click();
  await expect(page.locator("#toast")).toHaveText("Copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Handy \d+\.\d+\.\d+\n/);
  expect(copied).toContain("Browser: Mozilla/5.0");
  expect(copied).toContain("Graphics: ");
  expect(copied).toContain("Screen: ");
  expect(copied).not.toContain("camera-choice");
});

test("Reset Handy asks first, then forgets everything and welcomes you again", async ({ page }, info) => {
  await skipWelcome(page, {
    "handy.aim.v1.cam-a.1280x720": { version: 1 },
    "handy.best.v2.high-noon.standard.hand": { score: 900, outcome: "Fell on Wave 1", at: 1 },
    "handy.settings.v1": { difficulty: "relaxed", volume: 0.3 },
    "handy.tips-seen.v1": ["glint"],
    "handy.camera-choice.v1": "cam-desk",
    "handy.muted.v1": true,
    "someone-else": "theirs",
  });
  await page.goto("/");
  expect((await extra(page)).difficulty).toBe("relaxed");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Reset Handy" }).click();
  const alert = page.getByRole("dialog", { name: "Reset Handy?" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await shot(page, info, "settings-07-reset");
  // Cancel keeps everything.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(alert).toBeHidden();
  expect(await storedKeys(page)).toContain("handy.settings.v1");

  await page.getByRole("button", { name: "Reset Handy" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator("#welcome")).toBeVisible();
  await expect(page.locator("#settings")).toBeHidden();
  await expect(page.getByRole("button", { name: "Get Started" })).toBeFocused();
  expect(await storedKeys(page)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("someone-else"))).toBe('"theirs"');
  const state = await extra(page);
  expect(state.difficulty).toBe("standard");
  expect(state.preferences.volume).toBe(1);
  expect((await snapshot(page)).view).toBe("welcome");
});

test("the settings sheet in a narrow window is a full-height sheet", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await skipWelcome(page, { "handy.best.v2.high-noon.standard.hand": { score: 12340, outcome: "Fell on Wave 6", at: 1 } });
  await page.goto("/");
  await expect(page.locator("#home-best")).toHaveText("Your best: 12,340 · Fell on Wave 6");
  // The arcade fits the window: nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, info, "settings-08-narrow-arcade");
  await page.getByRole("button", { name: "Settings" }).click();
  // Measured once the sheet has finished rising, not part way.
  await page.locator("#settings").evaluate((sheet) => Promise.all(sheet.getAnimations({ subtree: true }).map((a) => a.finished)));
  const box = (await page.locator("#settings").boundingBox())!;
  expect(box.width).toBeCloseTo(390, 0);
  expect(box.y + box.height).toBeCloseTo(844, 0);
  expect(box.height).toBeGreaterThan(800);
  await shot(page, info, "settings-09-narrow-sheet");
  // Each choice sits under its name, as wide as the row.
  const group = (await page.getByRole("radiogroup", { name: "Aim Steadiness" }).boundingBox())!;
  expect(group.width).toBeGreaterThan(300);
});
