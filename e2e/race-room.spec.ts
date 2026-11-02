// Grip Prix with real rooms: a host and guests in tabs of ONE browser (that is
// what ?net=local makes a room), joining by code and racing by keyboard - the
// real net, the real sim, the real renderer, nothing stood in but the camera.
// A driver (e2e/kart.ts) presses the arrow keys to follow the road. Muted,
// like every test here.
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers";
import { chooseDrivers, host, join, KeyboardDriver, onScreen, open, pastHowTo, state } from "./kart";

// The site's sound preference is off in these tests, as Chrome is muted too: no music is made, nothing plays.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
    } catch {
      // no storage: the page decides
    }
  });
});

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name });
const startButton = (page: Page) => page.getByRole("button", { name: "Start Race" });

/** A wheel player (hands scripted) who has been through the wheel check, in a room's lobby. */
async function wheelGuest(page: Page, code: string, name: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("handy.kart.checked.v1", "true");
  });
  await open(page, "&input=script");
  await page.getByLabel("Race code").fill(code);
  await page.getByRole("button", { name: "Join a Race" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("radio", { name: "Wheel" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page, 60_000);
  await expect(page.locator("#lobby-waiting")).toBeVisible({ timeout: 20_000 });
}

test("a host and two guests race a lap: one watches on the big screen, and Race Again goes straight off", async ({ page }, info) => {
  const errors: string[] = [];
  const context = page.context();
  const gus = await context.newPage();
  const bea = await context.newPage();
  for (const [who, p] of [["host", page], ["gus", gus], ["bea", bea]] as const) {
    p.on("pageerror", (error) => errors.push(`${who}: ${error.message}`));
  }

  // The host opens a room; two friends join by its code.
  const code = await host(page, "Hana");
  await join(gus, code, "Gus");
  await join(bea, code, "Bea", true);
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(3);
  await expect(page.locator("#lobby-players")).toContainText("Big screen");
  await expect(startButton(page)).toBeEnabled();
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await shot(page, info, "room-1-host-lobby", 300);
  await shot(gus, info, "room-1b-guest-lobby", 100);
  await startButton(page).click();

  // Everyone is in the race: the host's screen shows Hana and Bea, Gus's his own, Bea's device is her wheel.
  await onScreen(page, "race");
  await onScreen(gus, "race");
  await onScreen(bea, "race");
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(gus.locator("canvas.race-canvas")).toBeVisible();
  await expect(bea.locator("#controller")).toBeVisible();
  await expect(bea.locator("canvas.race-canvas")).toHaveCount(0);
  expect((await state(page)).views).toHaveLength(2);
  expect((await state(gus)).views).toHaveLength(1);
  expect((await state(bea)).views).toHaveLength(0);
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");
  await shot(page, info, "room-2-host-split-screen", 1500);
  await shot(bea, info, "room-2b-controller", 100);
  await expect(bea.locator(".controller-card")).toContainText(/\d(st|nd|rd|th)/);
  await expect(bea.locator(".controller-card")).toContainText("Lap 1/1");

  // Three people drive.
  const drivers = [new KeyboardDriver(page).start(), new KeyboardDriver(gus).start(), new KeyboardDriver(bea).start()];
  await onScreen(page, "results", 150_000);
  await onScreen(gus, "results", 30_000);
  await onScreen(bea, "results", 30_000);
  await Promise.all(drivers.map((driver) => driver.stop()));

  // The results, on every device, with the names of all six karts and ours marked.
  for (const [p, me] of [[page, "Hana"], [gus, "Gus"], [bea, "Bea"]] as const) {
    await expect(p.locator("#standings-body tr")).toHaveCount(6);
    for (const name of ["Hana", "Gus", "Bea"]) await expect(p.locator("#standings-body")).toContainText(name);
    await expect(p.locator("#standings-body tr.mine")).toHaveCount(1);
    await expect(p.locator("#standings-body tr.mine")).toContainText(me);
  }
  await shot(page, info, "room-3-results", 300);
  // Only the host can race again; the others wait for them.
  await expect(page.getByRole("button", { name: "Race Again" })).toBeVisible();
  await expect(gus.getByRole("button", { name: "Race Again" })).toBeHidden();
  await expect(gus.locator("#results-wait")).toContainText("Hana");

  // Race Again: the same people, straight into the next race, nobody asked to get ready again.
  await page.getByRole("button", { name: "Race Again" }).click();
  await onScreen(page, "race");
  await onScreen(gus, "race", 20_000);
  await onScreen(bea, "race", 20_000);
  await expect(bea.locator("#controller")).toBeVisible();
  // Gus's own screen is drawing the new race, and the host's still shows two viewports.
  await expect(gus.locator("canvas.race-canvas")).toBeVisible();
  await expect.poll(async () => (await state(gus)).race?.phase, { timeout: 30_000 }).toBe("countdown");
  expect((await state(page)).views).toHaveLength(2);
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("countdown");
  expect((await state(page)).lobby!.players.map((p) => p.ready)).toEqual([true, true, true]);
  expect(errors).toEqual([]);
});

test("a guest who leaves mid-race becomes a bot; a latecomer is turned away; the host leaving ends it for everyone", async ({ page }, info) => {
  const context = page.context();
  const gus = await context.newPage();
  const bea = await context.newPage();
  const late = await context.newPage();

  const code = await host(page, "Hana");
  await join(gus, code, "Gus");
  await join(bea, code, "Bea");
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await startButton(page).click();
  await onScreen(page, "race");
  await onScreen(gus, "race");
  await onScreen(bea, "race");
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");

  // Too late to join: the race has started.
  await open(late);
  await late.getByLabel("Race code").fill(code);
  await late.getByRole("button", { name: "Join a Race" }).click();
  await expect(late.locator("#trouble")).toContainText("That race has already started.");
  await shot(late, info, "room-4-started", 400);
  await late.getByRole("button", { name: "Back to Start" }).click();

  // Gus leaves from the pause sheet. His kart carries on as a bot, and his seat is free.
  await gus.keyboard.press("Escape");
  await expect(gus.locator("#pause-sheet")).toContainText("The race keeps going for everyone else.");
  await gus.getByRole("button", { name: "Leave Race" }).click();
  await expect(heading(gus, "Grip Prix")).toBeVisible();
  await expect.poll(async () => (await state(page)).lobby!.players.map((p) => p.name), { timeout: 10_000 }).toEqual(["Hana", "Bea"]);
  const before = (await state(page)).race!.karts;
  await page.waitForTimeout(2500);
  const after = (await state(page)).race!.karts;
  // The kart he left moved on its own: every kart that is not Hana's or Bea's is a bot now.
  const mine = new Set([(await state(page)).mine[0], (await state(bea)).mine[0]]);
  const moved = after.filter((kart) => !mine.has(kart.id) && Math.hypot(kart.x - before.find((k) => k.id === kart.id)!.x, kart.z - before.find((k) => k.id === kart.id)!.z) > 5);
  expect(moved.length).toBe(after.length - 2);

  // The host closes the room: Bea is told, kindly, and has a way back.
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-sheet")).toContainText("Leaving ends the race for everyone.");
  await page.getByRole("button", { name: "Leave Race" }).click();
  await expect(bea.locator("#trouble")).toContainText("The host left the race.", { timeout: 10_000 });
  await shot(bea, info, "room-5-host-left", 300);
  await bea.getByRole("button", { name: "Back to Start" }).click();
  await expect(heading(bea, "Grip Prix")).toBeVisible();
});

test("a full room turns the fifth away, and a wrong code finds no race", async ({ page }, info) => {
  const context = page.context();
  const names = ["Gus", "Bea", "Cy"];
  const guests = await Promise.all(names.map(() => context.newPage()));
  const fifth = await context.newPage();

  const code = await host(page, "Hana");
  for (const [i, guest] of guests.entries()) await join(guest, code, names[i]!);
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(4);

  await open(fifth);
  await fifth.getByLabel("Race code").fill(code);
  await fifth.getByRole("button", { name: "Join a Race" }).click();
  await expect(fifth.locator("#trouble")).toContainText("This race is full.");
  await shot(fifth, info, "room-6-full", 300);
  await fifth.getByRole("button", { name: "Back to Start" }).click();

  // A code nobody has opened (the host's own is taken: this one is not).
  const wrong = code === "ZZZZ" ? "YYYY" : "ZZZZ";
  await fifth.getByLabel("Race code").fill(wrong);
  await fifth.getByRole("button", { name: "Join a Race" }).click();
  await expect(fifth.locator("#trouble")).toContainText("There’s no race with that code.");
  // The room is as it was.
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(4);
});

test("the host's pause stops the race for everyone when it plays on the big screen, and resumes with a 3-2-1", async ({ page }, info) => {
  const context = page.context();
  const bea = await context.newPage();
  const code = await host(page, "Hana");
  await join(bea, code, "Bea");
  // The host shows the race on this screen; Bea's device becomes her wheel (she did not choose otherwise).
  await page.getByRole("radio", { name: "On This Screen" }).click();
  await expect(bea.getByRole("radio", { name: "Big Screen" })).toHaveAttribute("aria-checked", "true");
  await expect(bea.locator("#foot-screen")).toContainText("Hana chose to show the race on their screen");
  await shot(page, info, "room-7-display-choice", 300);
  await startButton(page).click();
  await onScreen(bea, "race");
  await expect(bea.locator("#controller")).toBeVisible();
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");
  expect((await state(page)).views).toHaveLength(2);
  await page.waitForTimeout(1500);

  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await expect(page.locator("#pause-sheet")).toContainText("so does everyone");
  // Bea's phone says so too, and nothing moves anywhere.
  await expect(bea.locator("#pause-veil")).toBeVisible();
  await expect(bea.locator("#pause-veil")).toContainText("Paused");
  await expect(bea.locator("#pause-veil")).toContainText("Waiting for Hana to resume.");
  await shot(bea, info, "room-7b-paused-controller", 200);
  const stopped = (await state(page)).race!.time;
  await page.waitForTimeout(1500);
  expect((await state(page)).race!.time).toBe(stopped);
  expect((await state(bea)).race!.time).toBeLessThanOrEqual(stopped + 0.2);

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(bea.locator("#pause-veil")).toContainText("Get Ready");
  await expect(bea.locator("#pause-count")).toHaveText(/^[123]$/);
  await expect(page.locator("#pause-veil")).toBeVisible();
  await expect(bea.locator("#pause-veil")).toBeHidden({ timeout: 6000 });
  await expect(page.locator("#pause-veil")).toBeHidden();
  await expect.poll(async () => (await state(page)).race!.time, { timeout: 5000 }).toBeGreaterThan(stopped + 0.5);

  // Restart from the pause sheet: the same people, the lights again, on every device.
  const before = (await state(page)).lobby!.race;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect.poll(async () => (await state(bea)).lobby!.race, { timeout: 10_000 }).not.toBe(before);
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("countdown");
  await expect(page.locator("#pause-veil")).toBeHidden();
  await expect(page.locator("#pause-sheet")).toBeHidden();
  await expect(bea.locator("#controller")).toBeVisible();
  await expect.poll(async () => (await state(bea)).race?.phase, { timeout: 30_000 }).toBe("countdown");
  expect((await state(page)).views).toHaveLength(2);
  expect((await state(page)).lobby!.players.map((p) => p.ready)).toEqual([true, true]);
});

test("a wheel player on the big screen who loses their hands is told in their own viewport", async ({ page }, info) => {
  const context = page.context();
  const bea = await context.newPage();
  const code = await host(page, "Hana");
  await wheelGuest(bea, code, "Bea");
  await bea.getByRole("radio", { name: "Big Screen" }).click();
  // Her wheel is level and seen: she is ready, and the host can start.
  await expect(page.locator("#lobby-players")).toContainText("Bea");
  await expect(startButton(page)).toBeEnabled({ timeout: 20_000 });
  await startButton(page).click();
  await onScreen(page, "race");
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");
  await expect(bea.locator("#controller")).toBeVisible();
  await expect(bea.locator(".corner-preview")).toHaveCount(0);
  await expect(bea.locator(".controller-card .wheel-view canvas")).toBeVisible();
  await expect(page.locator(".view-note")).toHaveCount(0);

  // Her hands leave the picture: her phone says so at once, the big screen after a moment, in her viewport.
  await bea.evaluate(() => window.gripTest!.wheel(null));
  await expect(bea.locator("#lost-hands")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".view-note")).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator(".view-note")).toHaveText("Bea: Show Both Hands");
  await shot(page, info, "room-8-hands-lost", 300);

  // They come back, and the note goes.
  await bea.evaluate(() => window.gripTest!.wheel({ angle: 0 }));
  await expect(page.locator(".view-note")).toHaveCount(0, { timeout: 5000 });
  await expect(bea.locator("#lost-hands")).toBeHidden();

  // Her phone propped up in front of her: the wheel's picture, her place, lap and item, large.
  await bea.setViewportSize({ width: 390, height: 844 });
  await bea.evaluate(() => window.gripTest!.wheel({ angle: 14 }));
  await shot(bea, info, "room-8b-controller-wheel-phone", 500);
});

test("practice against bots, all the way to the results and round again", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Maya");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page);
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await startButton(page).click();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });

  const driver = new KeyboardDriver(page).start();
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");
  await shot(page, info, "room-9-practice", 3000);
  await onScreen(page, "results", 150_000);
  await driver.stop();
  await expect(page.locator("#standings-body tr")).toHaveCount(6);
  await expect(page.locator("#standings-body tr.mine")).toContainText("Maya");
  await expect(page.locator("#results-eyebrow")).toContainText("1 lap");
  await page.getByRole("button", { name: "Race Again" }).click();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave Race" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();
  expect(errors).toEqual([]);
});
