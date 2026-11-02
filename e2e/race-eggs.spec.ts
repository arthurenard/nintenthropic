// Grip Prix's easter eggs on the real page: the Konami code on the start screen
// (a golden flash, a toast, the unlock kept), a honk on H with its bubble over
// the kart, and the duck found by driving up to it (a toast in the player's
// viewport, "Duck 1 of 9. Paddling in the pond."). Chrome is muted and the preference says so.
import { expect, test, type Page } from "@playwright/test";
import { duckSpot } from "../src/kart/sim/eggs";
import { planFor } from "../src/kart/sim/plan";
import { MEADOW_LOOP, TRACKS } from "../src/kart/track/tracks";
import { shot } from "./helpers";
import { chooseDrivers, open, pastHowTo, state } from "./kart";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
    } catch {
      // no storage: the page decides
    }
  });
});

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

const unlocks = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("grip-prix.unlocks") ?? "null") as { konami: boolean; ducks: string[] } | null);

/** Practice with the keyboard (one lap, unless told otherwise), into the race and past the loading screen. */
async function practiceRace(page: Page, laps = "1") {
  await open(page);
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("heading", { name: /Driving/ })).toBeVisible();
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page);
  await expect(page.getByRole("heading", { name: "Ready to Race" })).toBeVisible();
  await page.getByRole("radio", { name: laps, exact: true }).click();
  await page.getByRole("button", { name: "Start Race" }).click();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
}

test("the Konami code on the start screen unlocks the golden kart, with a flash and a toast", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByRole("heading", { name: "Grip Prix" })).toBeVisible();
  expect(await unlocks(page)).toBeNull();

  // Typed into the race code field it is only typing.
  await page.getByLabel("Race code").focus();
  for (const key of KONAMI) await page.keyboard.press(key);
  await expect(page.locator("#toast")).toBeHidden();
  expect(await unlocks(page)).toBeNull();
  await page.getByLabel("Race code").blur();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // Up, up, down, down, left, right, left, right, B, A.
  for (const key of KONAMI) await page.keyboard.press(key);
  await expect(page.locator("#toast")).toHaveText("A golden kart, and a secret track.");
  await expect(page.locator("#gold-flash")).toHaveClass(/go/);
  expect((await unlocks(page))?.konami).toBe(true);

  // Again: it is already theirs.
  await page.waitForTimeout(300);
  for (const key of KONAMI) await page.keyboard.press(key);
  await expect(page.locator("#toast")).toHaveText("Still gold.");
  expect(errors).toEqual([]);
});

test("H honks: a Honk! bubble over the kart, and the tricks are in the pause sheet", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await practiceRace(page);
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 20_000 }).toBe("racing");
  await expect(page.locator(".gp-bubble")).toHaveCount(0);
  await page.keyboard.press("h");
  const bubble = page.locator(".gp-bubble");
  await expect(bubble).toHaveCount(1);
  // The anchor is a point; the words are what can be seen.
  await expect(bubble.locator(".gp-bubble-body")).toBeVisible();
  // The driver is picked at random on a first visit: a robot beeps and the duck quacks.
  await expect(bubble).toHaveText(/^(Honk!|Beep\.|Quack!)$/);
  await shot(page, info, "eggs-honk", 150);
  // It floats up and goes.
  await expect(bubble).toHaveCount(0, { timeout: 5_000 });

  await page.keyboard.press("Escape");
  const sheet = page.locator("#pause-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("#pause-tricks")).toContainText("Tricks");
  await expect(sheet.locator("#pause-tricks")).toContainText("Press H to honk.");
  expect(errors).toEqual([]);
});

test("a wheel player claps to honk, raises both hands to cheer, and waves hello", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A returning player with the scripted hands: only the level to hold, then the lobby.
  await page.addInitScript(() => {
    localStorage.setItem("handy.kart.checked.v1", "true");
    localStorage.setItem("handy.camera-opened.v1", "true");
  });
  await open(page, "&input=script");
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page);
  await expect(page.getByRole("heading", { name: "Ready to Race" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Start Race" }).click();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 20_000 }).toBe("racing");

  const emote = async () => {
    const snapshot = await state(page);
    return snapshot.race?.karts.find((kart) => kart.id === snapshot.mine[0])?.emote ?? null;
  };
  /** Moves the scripted hands through `pose(t)` for `seconds`, 30 pictures a second. */
  const move = (seconds: number, pose: string) =>
    page.evaluate(
      async ([length, source]) => {
        const make = new Function("t", `return (${source})(t)`) as (t: number) => Parameters<NonNullable<Window["gripTest"]>["wheel"]>[0];
        const began = performance.now();
        for (let t = 0; t < (length as number) * 1000; t = performance.now() - began) {
          window.gripTest!.wheel(make(t / 1000));
          await new Promise((resolve) => setTimeout(resolve, 33));
        }
      },
      [seconds, pose] as const,
    );

  // Fists on the wheel for a moment, then a clap: the palms together and apart in half a second.
  await move(1.2, "() => ({ angle: 0 })");
  await expect(page.locator(".gp-bubble")).toHaveCount(0);
  await move(0.45, "(t) => ({ angle: 0, fingers: 'open', span: 0.5 - 0.46 * Math.sin(Math.PI * t / 0.45) })");
  await move(0.3, "() => ({ angle: 0 })");
  await expect(page.locator(".gp-bubble")).toHaveText("Honk!");
  expect(await emote()).toBeNull();

  // Both open hands high above the wheel, held: a cheer, for as long as they are up.
  await move(0.6, "() => ({ angle: 0 })");
  await move(0.4, "() => ({ angle: 0, fingers: 'open' })");
  await move(0.9, "() => ({ angle: 0, fingers: 'open', centre: [0.5, 0.08] })");
  expect(await emote()).toBe("cheer");
  await move(1, "() => ({ angle: 0 })");
  await expect.poll(emote).toBeNull();

  // One open hand swinging side to side, the other a fist: a wave.
  await move(1.6, "(t) => ({ angle: 0, right: { fingers: 'open', x: 0.64 + 0.07 * Math.sin(2 * Math.PI * 2.5 * t) } })");
  expect(await emote()).toBe("wave");
  await move(1.4, "() => ({ angle: 0 })");
  await expect.poll(emote).toBeNull();
  expect(errors).toEqual([]);
});

test("driving up to the duck tells you, in your own viewport, and it is kept", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await practiceRace(page, "2");
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 20_000 }).toBe("racing");

  const plan = planFor(MEADOW_LOOP);
  const spot = duckSpot(MEADOW_LOOP, plan.geo, plan.terrain)!;
  const held = new Set<string>();
  const press = async (keys: string[]) => {
    for (const key of [...held]) {
      if (!keys.includes(key)) {
        held.delete(key);
        await page.keyboard.up(key);
      }
    }
    for (const key of keys) {
      if (!held.has(key)) {
        held.add(key);
        await page.keyboard.down(key);
      }
    }
  };

  // Follow the road, and for the last stretch of the lap aim at the duck's spot beside the fence.
  const toast = page.locator("#view-toasts .view-toast");
  let owed = 0;
  const began = Date.now();
  while (Date.now() - began < 200_000 && (await toast.count()) === 0) {
    const snapshot = await state(page);
    const race = snapshot.race;
    const id = snapshot.mine[0];
    const kart = race && id !== null && id !== undefined ? race.karts.find((candidate) => candidate.id === id) : undefined;
    if (!race || !kart || race.phase !== "racing" || snapshot.screen !== "race") {
      await press([]);
      await page.waitForTimeout(100);
      continue;
    }
    const at = plan.geo.project(kart.x, kart.z);
    const fraction = at.s / plan.geo.length;
    const near = fraction > MEADOW_LOOP.duck!.at - 0.045 && fraction < MEADOW_LOOP.duck!.at + 0.02;
    const ahead = near ? spot : plan.geo.point(at.s + 8 + Math.max(0, kart.speed) * 0.55);
    let error = Math.atan2(ahead.x - kart.x, ahead.z - kart.z) - kart.heading;
    error = Math.atan2(Math.sin(error), Math.cos(error));
    const turn = Math.max(-1, Math.min(1, -error * 1.6));
    owed += Math.abs(turn);
    const tap = owed >= 0.5;
    if (tap) owed -= 1;
    owed = Math.max(-1, owed);
    const keys = [];
    // Slow for the hairpin by the pond; the fence will do the rest.
    if (!near || kart.speed < 14) keys.push("ArrowUp");
    if (tap) keys.push(turn > 0 ? "ArrowRight" : "ArrowLeft");
    await press(keys);
    await page.waitForTimeout(35);
  }
  await press([]);

  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveText("Duck 1 of 9. Paddling in the pond.");
  await shot(page, info, "eggs-duck-found", 100);
  expect((await unlocks(page))?.ducks).toEqual(["meadow-loop"]);
  expect(errors).toEqual([]);
});

test("the driver stage: arrows choose and Return goes on; Dabble is a locked silhouette until every duck is found; the Golden Kart comes with the Konami code", async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const toStage = async (p: Page) => {
    await open(p);
    await p.getByRole("button", { name: "Practice" }).click();
    await p.getByRole("radio", { name: "Keyboard" }).click();
    await p.getByRole("button", { name: "Continue" }).click();
    await expect(p.getByRole("heading", { name: "Choose Your Driver" })).toBeVisible();
  };
  await toStage(page);
  const dock = page.getByRole("radiogroup", { name: "Drivers" });
  await expect(dock.getByRole("radio")).toHaveCount(9);
  // Nothing found yet: no golden kart, and the ninth is a silhouette that says how to find it.
  await expect(page.locator("#driver-golden")).toBeHidden();
  const dabble = dock.getByRole("radio", { name: /^Locked/ });
  await expect(dabble).toContainText("Find every duck");
  await dock.getByRole("radio", { name: /^Bun/ }).click();
  await expect(page.locator("#driver-name")).toHaveText("Bun");
  await expect(page.locator("#driver-class")).toHaveText("Lightweight");
  await expect(page.locator("#driver-stats .stat")).toHaveCount(4);
  // Arrows move through the nine and stop at the ends; the locked one is looked at, never chosen.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#driver-name")).toHaveText("Pepper");
  await expect(dock.getByRole("radio", { name: /^Pepper/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#driver-name")).toHaveText("Bun");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator("#driver-name")).toHaveText("Rivet");
  await dabble.click({ force: true });
  await expect(page.locator("#driver-name")).toHaveText("???");
  await expect(page.locator("#driver-blurb")).toContainText("Find every duck");
  await expect(page.locator("#driver-stats")).toBeHidden();
  await expect(dock.getByRole("radio", { name: /^Rivet/ })).toHaveAttribute("aria-checked", "true");
  await shot(page, info, "eggs-driver-locked", 700);
  // Return goes on, with the driver that is chosen (Rivet).
  await page.keyboard.press("Enter");
  await pastHowTo(page);
  await expect(page.getByRole("heading", { name: "Ready to Race" })).toBeVisible();
  expect((await state(page)).lobby!.players[0]!.character).toBe("rivet");

  // Every duck found, and the Konami code entered: Dabble can be driven, in a golden kart.
  const other = await context.newPage();
  await other.addInitScript((ducks) => {
    localStorage.setItem("handy.muted.v1", "true");
    localStorage.setItem("grip-prix.unlocks", JSON.stringify({ ducks, cups: [], konami: true }));
  }, TRACKS.filter((track) => track.duck).map((track) => track.id));
  await toStage(other);
  const dockTwo = other.getByRole("radiogroup", { name: "Drivers" });
  await expect(dockTwo.getByRole("radio", { name: /^Locked/ })).toHaveCount(0);
  await dockTwo.getByRole("radio", { name: /^Dabble/ }).click();
  await expect(other.locator("#driver-name")).toHaveText("Dabble");
  await expect(other.locator("#driver-golden")).toBeVisible();
  const golden = other.getByRole("switch", { name: "Golden Kart" });
  await expect(golden).toHaveAttribute("aria-checked", "false");
  await golden.click();
  await expect(golden).toHaveAttribute("aria-checked", "true");
  await shot(other, info, "eggs-driver-dabble-golden", 700);
  await other.getByRole("button", { name: "Continue" }).click();
  await pastHowTo(other);
  await expect(other.getByRole("heading", { name: "Ready to Race" })).toBeVisible();
  const me = (await state(other)).lobby!.players[0]!;
  expect([me.character, me.golden]).toEqual(["dabble", true]);
  expect(errors).toEqual([]);
});

test("the driver stage is live 3D where the page can draw it, and turns when it is dragged", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "&stage=3d");
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const stage = page.locator("#driver-stage");
  await expect(stage).toHaveAttribute("data-stage", "3d", { timeout: 30_000 });
  await expect(stage).toHaveClass(/live/);
  const canvas = stage.locator("canvas.stage-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.height).toBeGreaterThan(200);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await shot(page, info, "eggs-driver-3d", 600);
  // The stage goes with the screen: its canvas is let go of.
  await page.getByRole("button", { name: "Continue" }).click();
  await pastHowTo(page);
  await expect(page.getByRole("heading", { name: "Ready to Race" })).toBeVisible();
  await expect(page.locator("canvas.stage-canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});
