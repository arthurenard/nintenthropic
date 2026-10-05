// The arcade: the chosen game as the hero, the row of every game to choose
// from - by click, by keyboard as a radio group - the choice remembered and
// in the address, a link that opens a game's card, and the way back from a
// game to it. Photographed at every size the design must hold at.
import { expect, test, type Page } from "@playwright/test";
import { shot, skipWelcome, snapshot } from "./helpers";

const card = (page: Page, name: string) => page.getByRole("radiogroup", { name: "Games" }).getByRole("radio", { name: new RegExp(`^${name}`) });

test("choosing a game: click, keyboard, remembered, in the address", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/");
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  await expect(card(page, "High Noon")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio")).toHaveCount(5);

  // Choosing another game that can be played offers Play for it.
  await card(page, "Dead of Night").click();
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  await expect(card(page, "Dead of Night")).toHaveAttribute("aria-checked", "true");
  await expect(card(page, "High Noon")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#feature-soon")).toBeHidden();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#dead-of-night");

  // One tab stop: the chosen card; the arrows choose, wrapping round.
  await expect(card(page, "Dead of Night")).toHaveAttribute("tabindex", "0");
  await expect(card(page, "High Noon")).toHaveAttribute("tabindex", "-1");
  await card(page, "Dead of Night").focus();
  await page.keyboard.press("ArrowRight");
  await expect(card(page, "Orbital Decay")).toBeFocused();
  await expect(page.locator("#feature-title")).toHaveText("Orbital Decay");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  // The row runs on through both headings: End is the last game of the last one, Racing's Grip Prix.
  await page.keyboard.press("End");
  await expect(page.locator("#feature-title")).toHaveText("Grip Prix");
  // Every game can be played now: none is Coming Soon. (A game still to come - named,
  // described, never playable - is covered by src/app/arcade.test.ts's entries without create.)
  await expect(page.locator("#feature-soon")).toBeHidden();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  for (const name of ["High Noon", "Dead of Night", "Orbital Decay", "Overwatch Ridge", "Grip Prix"]) await expect(card(page, name)).not.toContainText("Coming Soon");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#feature-title")).toHaveText("Grip Prix");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#feature-title")).toHaveText("Overwatch Ridge");
  expect(new URL(page.url()).hash).toBe("#overwatch-ridge");

  // Remembered: the arcade opens on it again.
  await page.goto("/");
  await expect(page.locator("#feature-title")).toHaveText("Overwatch Ridge");
  // And a link opens a game's card, over what was remembered.
  await page.goto("/#dead-of-night");
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  await page.goto("/?game=orbital-decay");
  await expect(page.locator("#feature-title")).toHaveText("Orbital Decay");
  // A link followed on the page turns the arcade too.
  await page.evaluate(() => (location.hash = "#high-noon"));
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  expect(errors).toEqual([]);
});

test("each game's best is its own, and Choose a Game comes back to the game played", async ({ page }) => {
  await skipWelcome(page, {
    "handy.control.v1": "mouse",
    "handy.best.v2.high-noon.standard.pointer": { score: 4210, outcome: "Fell on Wave 3", at: 1 },
  });
  await page.goto("/#dead-of-night");
  await expect(page.locator("#home-best")).toBeHidden();
  await card(page, "High Noon").click();
  await expect(page.locator("#home-best")).toHaveText("Your best: 4,210 · Fell on Wave 3");
  await card(page, "Orbital Decay").click();
  await expect(page.locator("#home-best")).toBeHidden();

  await card(page, "High Noon").click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  // Chosen elsewhere meanwhile (another tab): the way back is to the game played.
  await page.evaluate(() => localStorage.setItem("handy.game.v1", JSON.stringify("dead-of-night")));
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#home")).toBeVisible();
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  await expect(card(page, "High Noon")).toHaveAttribute("aria-checked", "true");
  expect(new URL(page.url()).hash).toBe("#high-noon");
});

test("the arcade at every size", async ({ page }, info) => {
  await skipWelcome(page);
  for (const [width, height] of [
    [1280, 720],
    [1512, 945],
    [2560, 1440],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const game of ["high-noon", "overwatch-ridge", "grip-prix"]) {
      await page.goto(`/#${game}`);
      await expect(page.locator("#home")).toBeVisible();
      await page.mouse.move(1, 1);
      // The whole row is in sight on a phone too, below the hero: Racing's card is the last of it.
      const last = (await card(page, "Grip Prix").boundingBox())!;
      expect(last.x + last.width).toBeLessThanOrEqual(width);
      if (width > 860) expect(last.y + last.height).toBeLessThanOrEqual(height);
      // Shooting's four cards sit side by side under their heading, Racing's on the same row beside them.
      if (width > 860) {
        const first = (await card(page, "High Noon").boundingBox())!;
        expect(Math.abs(first.y - last.y)).toBeLessThan(2);
      }
      await page.waitForTimeout(500);
      await shot(page, info, `arcade-${width}x${height}-${game}`, 0);
    }
  }
});

test("the games sit under their headings, and Play on Grip Prix opens its own page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await skipWelcome(page);
  await page.goto("/");
  const row = page.getByRole("radiogroup", { name: "Games" });
  // Shooting lists the four finger-pistol games, Racing lists Grip Prix.
  const group = (heading: string) => row.locator(".shelf-group").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
  await expect(row.getByRole("heading")).toHaveText(["Shooting", "Racing"]);
  await expect(group("Shooting").getByRole("radio")).toHaveCount(4);
  await expect(group("Racing").getByRole("radio")).toHaveCount(1);
  await expect(group("Racing").getByRole("radio", { name: /^Grip Prix/ })).toBeVisible();

  // Choosing it shows its hero like the others': no finger pistol or aim to set, just Play.
  await card(page, "Grip Prix").click();
  await expect(page.locator("#feature-title")).toHaveText("Grip Prix");
  await expect(page.locator("#feature-about")).toContainText("wheel");
  expect(new URL(page.url()).hash).toBe("#grip-prix");
  await expect(page.locator("#start-control")).toBeHidden();
  await expect(page.locator("#adjust")).toBeHidden();
  await expect(page.locator("#feature-soon")).toBeHidden();

  // Play goes to race.html (the arcade does not try to start it in its own page).
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page).toHaveURL(/\/race\.html$/);
  await expect(page.getByRole("heading", { name: "Grip Prix" })).toBeVisible();

  // And the way back lands on the arcade with Grip Prix chosen.
  await page.getByRole("link", { name: "Handy" }).click();
  await expect(page).toHaveURL(/\/index\.html#grip-prix$/);
  await expect(page.locator("#feature-title")).toHaveText("Grip Prix");
  await expect(card(page, "Grip Prix")).toHaveAttribute("aria-checked", "true");

  // A link to the game opens the arcade on it, as it does for the others.
  await page.goto("/?game=grip-prix");
  await expect(page.locator("#feature-title")).toHaveText("Grip Prix");
  expect(errors).toEqual([]);
});
