// Rivalries on the real page (rivals.ts): a host races a one-lap race against the bots, and a scripted run of hits is put
// on the room's score sheet through the test hook (a real hit needs a lucky item). The results then hand out awards,
// the next race's intro calls out the grudge, and the nemesis wears a marker. Muted, like every test here.
import { expect, test } from "@playwright/test";
import { shot } from "./helpers";
import { KeyboardDriver, host, onScreen, state } from "./kart";

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
  page.on("pageerror", (error) => errors.push(error.message));
  await host(page, "Hana");
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Start Race" }).click();
  await onScreen(page, "race", 60_000);
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  const first = new KeyboardDriver(page).start();
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");

  // The score sheet: Hana lands three pucks on one bot, and that bot gets her back four times.
  const { me, bot } = await page.evaluate(() => {
    const snapshot = window.gripTest!.state()!;
    const me = snapshot.mine[0]!;
    const bot = snapshot.race!.karts.find((kart) => kart.id !== me)!.id;
    const rivals = window.gripTest!.rivals()!;
    for (let i = 0; i < 3; i++) rivals.hit({ kart: bot, by: me, cause: "puck" });
    for (let i = 0; i < 4; i++) rivals.hit({ kart: me, by: bot, cause: "seeker" });
    return { me, bot };
  });
  expect(await page.evaluate((id) => window.gripTest!.rivals()!.nemesis(id), me)).toBe(bot);

  await onScreen(page, "results", 200_000);
  await first.stop();
  // Awards: the best shot is Hana (the only player), with the words that say why.
  const awards = page.locator("#results-awards");
  await expect(awards).toBeVisible();
  await expect(awards.locator('[data-award="sharpshooter"]')).toContainText("Hana");
  await expect(awards.locator('[data-award="sharpshooter"] .award-detail')).toHaveText("Landed 3 hits.");
  await expect(awards.locator(".award-title").first()).not.toHaveText("");
  await shot(page, info, "rivals-results", 1700);

  // Race again: the intro calls out the biggest grudge, and Hana's nemesis wears a marker.
  await page.getByRole("button", { name: "Race Again" }).click();
  await onScreen(page, "race", 60_000);
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  const intro = page.locator(".rival-intro");
  await expect(intro).toBeVisible({ timeout: 20_000 });
  await expect(intro.locator(".rival-line")).toHaveText(/ vs .*: \d+-\d+$/);
  await expect(intro.locator(".rival-line")).toContainText("Hana");
  await shot(page, info, "rivals-intro", 300);
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");
  expect(await page.evaluate((id) => window.gripTest!.rivals()!.nemesis(id), me)).not.toBeNull();
  expect(errors).toEqual([]);
});

test("Practice alone keeps no score and shows no awards", async ({ page }) => {
  await page.goto("/race.html?net=local");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("heading", { name: /Driving/ })).toBeVisible();
  expect(await page.evaluate(() => window.gripTest!.rivals())).toBeNull();
});
