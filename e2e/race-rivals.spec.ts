// Rivalries on the real page (rivals.ts): a host races a one-lap race against the bots, and a scripted run of hits is put
// on the room's score sheet through the test hook (a real hit needs a lucky item). The results then hand out awards,
// the next race's intro calls out the grudge, and the nemesis wears a marker. Muted, like every test here.
import { expect, test } from "@playwright/test";
import { shot } from "./helpers";
import { KeyboardDriver, host, join, onScreen, state } from "./kart";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
    } catch {
      // no storage: the page decides
    }
  });
});

test("a scripted run of hits earns awards on the results, a grudge in the next intro, and a marker on the nemesis", async ({ page }, info) => {
  test.setTimeout(8 * 60_000);
  const errors: string[] = [];
  const gus = await page.context().newPage();
  for (const [who, p] of [["host", page], ["gus", gus]] as const) p.on("pageerror", (error) => errors.push(`${who}: ${error.message}`));
  const code = await host(page, "Hana");
  await join(gus, code, "Gus");
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(2);
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Start Race" }).click();
  await onScreen(page, "race", 60_000);
  await onScreen(gus, "race", 30_000);
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  await expect(gus.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  const drivers = [new KeyboardDriver(page).start(), new KeyboardDriver(gus).start()];
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");

  // The score sheet, on each screen (a real hit needs a lucky item): Hana lands six pucks on Gus, and Gus two on Hana (a real hit or two may join them).
  const karts = { hana: (await state(page)).mine[0]!, gus: (await state(gus)).mine[0]! };
  for (const p of [page, gus]) {
    await p.evaluate((k) => {
      const rivals = window.gripTest!.rivals()!;
      for (let i = 0; i < 6; i++) rivals.hit({ kart: k.gus, by: k.hana, cause: "puck" });
      for (let i = 0; i < 2; i++) rivals.hit({ kart: k.hana, by: k.gus, cause: "seeker" });
    }, karts);
  }
  expect(await page.evaluate((k) => window.gripTest!.rivals()!.nemesis(k.hana), karts)).toBe(karts.gus);

  await onScreen(page, "results", 200_000);
  await onScreen(gus, "results", 60_000);
  await Promise.all(drivers.map((driver) => driver.stop()));
  // Awards, on both screens: the best shot is Hana, and the one hit most is Gus, each with the words that say why.
  for (const p of [page, gus]) {
    const awards = p.locator("#results-awards");
    await expect(awards).toBeVisible();
    await expect(awards.locator('[data-award="sharpshooter"]')).toContainText("Hana");
    await expect(awards.locator('[data-award="sharpshooter"] .award-detail')).toHaveText(/^Landed \d+ hits\.$/);
    await expect(awards.locator('[data-award="magnet"]')).toContainText("Gus");
  }
  await shot(page, info, "rivals-results", 1700);

  // Race again: the intro calls out their grudge, and Hana's nemesis wears a marker.
  await page.getByRole("button", { name: "Race Again" }).click();
  await onScreen(page, "race", 60_000);
  await onScreen(gus, "race", 30_000);
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  const intro = page.locator(".rival-intro");
  await expect(intro).toBeVisible({ timeout: 20_000 });
  await expect(intro.locator(".rival-line")).toHaveText(/^Hana vs Gus: \d+-\d+$/);
  await expect(intro.locator(".rival-basis")).toHaveText("Spin-outs between them");
  await shot(page, info, "rivals-intro", 300);
  // The marker hovers over their kart, in the one viewport, once they are in sight.
  const mark = page.locator(".gp-rival-mark");
  await expect(mark).toBeVisible({ timeout: 20_000 });
  await expect(mark).toHaveCount(1);
  await shot(page, info, "rivals-marker", 100);
  expect(errors).toEqual([]);
});

test("a cup's podium hands out awards from the whole cup's score", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await host(page, "Hana");
  // Four scripted races of a cup on the score sheet (no race is driven), then the podium as the room would show it.
  await page.evaluate(() => {
    const test = window.gripTest!;
    const lobby = test.state()!.lobby!;
    const hana = lobby.players[0]!;
    const rivals = test.rivals()!;
    const racers = [
      { id: 0, name: "Hana", colour: hana.colour, player: hana.slot },
      { id: 1, name: "Kit", colour: "#4cc3ff", player: 1 },
      { id: 2, name: "Mango", colour: "#ff9f0a", player: 2 },
      { id: 3, name: "Bramble", colour: "#bf5af2", player: null },
    ];
    for (let race = 0; race < 4; race++) {
      rivals.begin(100 + race, racers, { cup: "acorn", race });
      rivals.hit({ kart: 1, by: 2, cause: "puck" });
      rivals.hit({ kart: 0, by: 2, cause: "seeker" });
      if (race > 0) rivals.hit({ kart: 1, by: 2, cause: "slick" });
      const order = race % 2 === 0 ? [2, 1, 0, 3] : [1, 2, 3, 0];
      rivals.finish(order.map((kart, i) => ({ kart, place: i + 1, time: 50 + i * 3, bestLap: null })));
    }
    const points = [
      { key: "p2", name: "Mango", colour: "#ff9f0a", player: 2, points: 52 },
      { key: "p1", name: "Kit", colour: "#4cc3ff", player: 1, points: 48 },
      { key: "p0", name: "Hana", colour: hana.colour, player: hana.slot, points: 36 },
      { key: "b:Bramble", name: "Bramble", colour: "#bf5af2", player: null, points: 20 },
    ];
    test.preview("podium", { ...lobby, phase: "podium", result: null, grandPrix: { cup: "acorn", race: 3, points } });
  });
  const awards = page.locator("#podium-awards");
  await expect(awards).toBeVisible();
  await expect(awards.locator(".award")).not.toHaveCount(0);
  await expect(awards.locator('[data-award="sharpshooter"]')).toContainText("Mango");
  await shot(page, info, "rivals-podium", 1800);
  expect(errors).toEqual([]);
});

test("Practice alone keeps no score and shows no awards", async ({ page }) => {
  await page.goto("/race.html?net=local");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("heading", { name: /Driving/ })).toBeVisible();
  expect(await page.evaluate(() => window.gripTest!.rivals())).toBeNull();
});
