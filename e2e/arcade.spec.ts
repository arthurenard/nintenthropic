// The front door of Nintenthropic and the arcade behind it. The landing shows the two
// families side by side - the four shooters of Finger Guns, and Grip Prix, a page
// of its own - and the arcade is the shooters' own space: the chosen game as
// a full-bleed hero, the row of games to choose from (by click, by keyboard as
// a radio group), the choice remembered and in the address, a link that opens
// a game's card, and the way back, to the landing and from a game. Photographed
// at every size the design must hold at.
import { expect, test, type Page } from "@playwright/test";
import { shot, returningVisitor, snapshot } from "./helpers";

const card = (page: Page, name: string) => page.getByRole("radiogroup", { name: "Games" }).getByRole("radio", { name: new RegExp(`^${name}`) });
const hash = (page: Page) => new URL(page.url()).hash;
const GAMES = ["High Noon", "Dead of Night", "Orbital Decay", "Overwatch Ridge"];

test("choosing a game: click, keyboard, remembered, in the address", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returningVisitor(page);
  await page.goto("/#arcade");
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  await expect(card(page, "High Noon")).toHaveAttribute("aria-checked", "true");
  // Four shooters: Grip Prix is not a card of the row (it is the landing's other tile).
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expect(card(page, "Grip Prix")).toHaveCount(0);

  // Choosing another game that can be played offers Play for it.
  await card(page, "Dead of Night").click();
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  await expect(card(page, "Dead of Night")).toHaveAttribute("aria-checked", "true");
  await expect(card(page, "High Noon")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#feature-soon")).toBeHidden();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(hash(page)).toBe("#dead-of-night");

  // One tab stop: the chosen card; the arrows choose, wrapping round.
  await expect(card(page, "Dead of Night")).toHaveAttribute("tabindex", "0");
  await expect(card(page, "High Noon")).toHaveAttribute("tabindex", "-1");
  await card(page, "Dead of Night").focus();
  await page.keyboard.press("ArrowRight");
  await expect(card(page, "Orbital Decay")).toBeFocused();
  await expect(page.locator("#feature-title")).toHaveText("Orbital Decay");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.locator("#feature-title")).toHaveText("Overwatch Ridge");
  // Every game can be played: none is Coming Soon. (A game still to come - named,
  // described, never playable - is covered by src/app/arcade.test.ts's entries without create.)
  await expect(page.locator("#feature-soon")).toBeHidden();
  for (const name of GAMES) await expect(card(page, name)).not.toContainText("Coming Soon");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#feature-title")).toHaveText("Overwatch Ridge");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#feature-title")).toHaveText("Orbital Decay");
  expect(hash(page)).toBe("#orbital-decay");

  // Remembered: a new visit to the arcade's own address opens on it again.
  await page.goto("/?again=1#arcade");
  await expect(page.locator("#feature-title")).toHaveText("Orbital Decay");
  // And a link opens a game's card, over what was remembered: old links keep working.
  await page.goto("/#dead-of-night");
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  await page.goto("/?game=overwatch-ridge");
  await expect(page.locator("#feature-title")).toHaveText("Overwatch Ridge");
  // A link followed on the page turns the arcade too.
  await page.evaluate(() => (location.hash = "#high-noon"));
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  expect(errors).toEqual([]);
});

test("each game's best is its own, and Choose a Game comes back to the game played", async ({ page }) => {
  await returningVisitor(page, {
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
  await expect(page.locator("#arcade")).toBeVisible();
  await expect(page.locator("#feature-title")).toHaveText("High Noon");
  await expect(card(page, "High Noon")).toHaveAttribute("aria-checked", "true");
  expect(hash(page)).toBe("#high-noon");
});

test("the browser's Back in a game pauses it, and never leaves the page with the round", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returningVisitor(page, { "handy.control.v1": "mouse" });
  await page.goto("/");
  await page.getByRole("link", { name: "Play" }).click();
  await card(page, "Dead of Night").click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  // Back: the round holds under the pause menu.
  await page.goBack();
  await expect(page.locator("#pause-sheet")).toBeVisible();
  expect(await snapshot(page)).toMatchObject({ view: "game", phase: "play", paused: true });
  // Resume brings the game's address back with it, so Back pauses again instead of leaving.
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#pause-sheet")).toBeHidden();
  expect(hash(page)).toBe("#dead-of-night");
  await page.goBack();
  await expect(page.locator("#pause-sheet")).toBeVisible();
  expect(await snapshot(page)).toMatchObject({ view: "game", paused: true });
  await page.getByRole("button", { name: "Choose a Game" }).click();
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  expect(hash(page)).toBe("#dead-of-night");
  expect(errors).toEqual([]);
});

test("the browser's Back while a game gets ready cancels it, to where the address says", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returningVisitor(page, { "handy.control.v1": "mouse" });
  // The town takes its time to arrive, so the game is still getting ready when Back is pressed.
  await page.route("**/assets/western/**", async (route) => {
    await new Promise((done) => setTimeout(done, 4000));
    await route.continue().catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Play" }).click();
  await card(page, "High Noon").click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).view).toBe("game");
  expect((await snapshot(page)).phase).toBeNull();
  await page.goBack();
  await expect(page.locator("#landing")).toBeVisible();
  // The game that was loading never turns up afterwards, nor does its loading sheet.
  await page.waitForTimeout(6000);
  expect(await snapshot(page)).toMatchObject({ view: "landing", phase: null });
  await expect(page.locator("#loading")).toBeHidden();
  expect(errors).toEqual([]);
});

test("the landing: two equal tiles, and the way into each", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returningVisitor(page, { "handy.game.v1": "dead-of-night" });
  await page.goto("/");
  await expect(page.locator("#landing")).toBeVisible();
  await expect(page.locator("#arcade")).toBeHidden();
  expect((await snapshot(page)).view).toBe("landing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Games you play with your hands.");

  // Two tiles of one size, side by side: each with its name, a line, and the one thing to do.
  const arcade = page.locator("#tile-arcade");
  const grip = page.locator("#tile-grip");
  await expect(arcade.getByRole("heading", { name: "Finger Guns" })).toBeVisible();
  await expect(grip.getByRole("heading", { name: "Grip Prix" })).toBeVisible();
  await expect(arcade).toContainText("4 Games");
  await expect(grip).toContainText("Up to 4 Players");
  await expect(grip).toContainText("Grip the wheel. Race your friends.");
  const [a, g] = [(await arcade.boundingBox())!, (await grip.boundingBox())!];
  expect(Math.abs(a.width - g.width)).toBeLessThan(2);
  expect(Math.abs(a.height - g.height)).toBeLessThan(2);
  expect(Math.abs(a.y - g.y)).toBeLessThan(2);
  expect(g.x).toBeGreaterThan(a.x + a.width);
  // Grip Prix goes to its own page; Finger Guns' Play opens the arcade, not a game.
  await expect(grip.getByRole("link", { name: "Race" })).toHaveAttribute("href", "race.html");
  await expect(arcade.getByRole("link", { name: "Play" })).toHaveAttribute("href", "#finger-guns");

  // Its picture arrives over its sunny backdrop, which is also what stands in until it does (or if it never does).
  expect(await grip.locator(".tile-art").evaluate((art) => getComputedStyle(art).backgroundImage)).toContain("gradient");

  // Play: into the arcade, on the game chosen last, with the browser's history behind it.
  await arcade.getByRole("link", { name: "Play" }).click();
  await expect(page.locator("#arcade")).toBeVisible();
  await expect(page.locator("#landing")).toBeHidden();
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  expect(hash(page)).toBe("#dead-of-night");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeFocused();
  // Grip Prix is not a card in here, and there is no Racing heading.
  await expect(page.getByRole("heading", { name: "Racing" })).toHaveCount(0);
  await expect(card(page, "Grip Prix")).toHaveCount(0);

  // The bar: Nintenthropic leads back to the landing, standing on the Finger Guns tile; Back and Forward walk the same way.
  await page.getByRole("link", { name: "Nintenthropic" }).click();
  await expect(page.locator("#landing")).toBeVisible();
  await expect(page.locator("#arcade")).toBeHidden();
  expect(hash(page)).toBe("");
  await expect(arcade.getByRole("link", { name: "Play" })).toBeFocused();
  await page.goBack();
  await expect(page.locator("#arcade")).toBeVisible();
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
  await page.goForward();
  await expect(page.locator("#landing")).toBeVisible();

  // By keyboard alone: Enter on the pill.
  await arcade.getByRole("link", { name: "Play" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#arcade")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the arcade is the shooters' own space, with Grip Prix one choice away in the bar", async ({ page }) => {
  await returningVisitor(page);
  await page.goto("/#high-noon");
  const spaces = page.getByRole("navigation", { name: "Sections" });
  await expect(spaces.getByRole("link", { name: "Finger Guns" })).toHaveAttribute("aria-current", "page");
  await expect(spaces.getByRole("link", { name: "Grip Prix" })).toHaveAttribute("href", "race.html");
  // The bar's controls are the same ones as the landing's.
  for (const name of ["Privacy", "Mute", "Settings"]) await expect(page.getByRole("button", { name })).toBeVisible();
  // Its own chevron: back, to the landing.
  await expect(page.locator("#brand .brand-back")).toBeVisible();
  // The hero is the game's picture full-bleed, from the top of the window (measured once the view has settled in).
  await page.locator("#arcade").evaluate((view) => Promise.all(view.getAnimations().map((a) => a.finished)));
  const art = (await page.locator("#feature-frame").boundingBox())!;
  expect(art.x).toBeLessThanOrEqual(0);
  expect(art.y).toBeLessThanOrEqual(0);
  expect(art.width).toBeGreaterThanOrEqual(1440);
  // Grip Prix, from the bar: its own page.
  await spaces.getByRole("link", { name: "Grip Prix" }).click();
  await expect(page).toHaveURL(/\/race\.html$/);
  await expect(page.getByRole("heading", { name: "Grip Prix" })).toBeVisible();
});

test("Grip Prix, and the way home from it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returningVisitor(page);
  await page.goto("/");
  await page.locator("#tile-grip").getByRole("link", { name: "Race" }).click();
  await expect(page).toHaveURL(/\/race\.html$/);
  await expect(page.getByRole("heading", { name: "Grip Prix" })).toBeVisible();

  // Its Nintenthropic link: the landing, Grip Prix's tile in hand (by its address, or by what the page remembers of where you were).
  await page.getByRole("link", { name: "Nintenthropic" }).click();
  await expect(page).toHaveURL(/\/(index\.html)?(#grip-prix)?$/);
  await expect(page.locator("#landing")).toBeVisible();
  await expect(page.locator("#arcade")).toBeHidden();
  await expect(page.locator("#tile-grip").getByRole("link", { name: "Race" })).toBeFocused();

  // The same by address: the landing, not a game card, and the arcade's own cards untouched.
  for (const address of ["/#grip-prix", "/?game=grip-prix"]) {
    await page.evaluate(() => localStorage.removeItem("handy.space.v1"));
    await page.goto(address);
    await expect(page.locator("#landing")).toBeVisible();
    await expect(page.locator("#tile-grip").getByRole("link", { name: "Race" })).toBeFocused();
  }
  // And the arcade, once visited, is where the landing stands next time.
  await page.goto("/#arcade");
  await page.getByRole("link", { name: "Nintenthropic" }).click();
  await expect(page.locator("#tile-arcade").getByRole("link", { name: "Play" })).toBeFocused();
  expect(errors).toEqual([]);
});

test("How It Plays: each tile names its gesture and its steps, in a sheet, with no drawing", async ({ page }) => {
  await returningVisitor(page);
  await page.goto("/");
  const how = page.getByRole("dialog");
  await page.locator("#tile-grip").getByRole("button", { name: "How It Plays" }).click();
  await expect(how).toBeVisible();
  await expect(how.getByRole("heading", { name: "Grip the Wheel" })).toBeVisible();
  await expect(how).toContainText("fists up like a wheel");
  await expect(how.locator(".gesture-steps li")).toHaveText(["Grip", "Turn left", "Turn right"]);
  await expect(how.locator("svg")).toHaveCount(0);
  await how.getByRole("button", { name: "Done" }).click();
  await expect(how).toBeHidden();
  // Back to the button that opened it.
  await expect(page.locator("#tile-grip").getByRole("button", { name: "How It Plays" })).toBeFocused();

  await page.locator("#tile-arcade").getByRole("button", { name: "How It Plays" }).click();
  await expect(how.getByRole("heading", { name: "Finger Pistol" })).toBeVisible();
  await expect(how.locator(".gesture-steps li")).toHaveText(["Point", "Fold your thumb", "Fire"]);
  await expect(how.locator("svg")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(how).toBeHidden();
  // It did not start anything: still the landing.
  await expect(page.locator("#landing")).toBeVisible();
});

test("the landing keeps Privacy, the sound and Settings, and answers M", async ({ page }) => {
  await returningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Privacy" }).click();
  await expect(page.getByRole("dialog", { name: "Your Camera Stays Here" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  // The sound toggle, by the button and by M (the browser itself is muted for the tests).
  const sound = page.locator("#mute");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("m");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#landing")).toBeVisible();
});

test("a first visit lands straight on the landing; How It Plays lists the steps, with no drawing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("handy.muted.v1", "true"));
  await page.goto("/");
  await expect(page.locator("#landing")).toBeVisible();
  await expect(page.locator("#nav")).toBeVisible();
  await expect(page.locator("#welcome")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Games you play with your hands.");
  // How It Plays: the words and the steps, lit one after another; no hand is drawn.
  const how = page.getByRole("dialog");
  await page.locator("#tile-arcade").getByRole("button", { name: "How It Plays" }).click();
  await expect(how.locator(".gesture-steps li")).toHaveText(["Point", "Fold your thumb", "Fire"]);
  await expect(how.locator("svg")).toHaveCount(0);
  await how.getByRole("button", { name: "Done" }).click();
  await page.locator("#tile-grip").getByRole("button", { name: "How It Plays" }).click();
  await expect(how.locator(".gesture-steps li")).toHaveText(["Grip", "Turn left", "Turn right"]);
  await expect(how.locator("svg")).toHaveCount(0);
  await how.getByRole("button", { name: "Done" }).click();
  expect(errors).toEqual([]);
});

test("a first visit by a link to a game goes straight to it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("handy.muted.v1", "true"));
  await page.goto("/#dead-of-night");
  await expect(page.locator("#arcade")).toBeVisible();
  await expect(page.locator("#feature-title")).toHaveText("Dead of Night");
});

test("the posters turn in the Finger Guns tile, and hold still with Reduce Motion", async ({ page }) => {
  test.setTimeout(60_000);
  await returningVisitor(page);
  await page.goto("/");
  const showing = page.locator('#tile-arcade-art img[data-game].on.loaded');
  await expect(showing.first()).toHaveAttribute("data-game", "high-noon");
  // The next of the four takes its turn (slowly: a poster stays for several seconds).
  await expect(page.locator('#tile-arcade-art img[data-game="dead-of-night"].on')).toHaveCount(1, { timeout: 15_000 });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");
  await page.locator("#tile-grip").hover();
  // The picture neither swells nor leans, and How It Plays' steps do not light one after another.
  expect(await page.locator("#tile-grip .tile-art").evaluate((art) => getComputedStyle(art).transform)).toBe("none");
  await page.locator("#tile-grip").getByRole("button", { name: "How It Plays" }).click();
  expect(await page.locator("#how .gesture-steps li").first().evaluate((step) => getComputedStyle(step).animationName)).toBe("none");
});

test("the landing and the arcade at every size", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returningVisitor(page);
  const sizes = [
    [1280, 720],
    [1440, 900],
    [1512, 945],
    [1920, 1080],
    [2560, 1440],
    [390, 844],
  ] as const;
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    // The landing: side by side, whole in the window; stacked on a phone, wide as the page.
    await page.goto("/");
    await expect(page.locator("#landing")).toBeVisible();
    await page.mouse.move(1, 1);
    const [a, g] = [(await page.locator("#tile-arcade").boundingBox())!, (await page.locator("#tile-grip").boundingBox())!];
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width > 860) {
      expect(Math.abs(a.y - g.y)).toBeLessThan(2);
      expect(Math.abs(a.width - g.width)).toBeLessThan(2);
      expect(a.y + a.height).toBeLessThanOrEqual(height);
    } else {
      expect(g.y).toBeGreaterThan(a.y + a.height - 1);
      expect(a.width).toBeGreaterThan(width - 40);
    }
    await page.waitForTimeout(700);
    await shot(page, info, `landing-${width}x${height}`, 0);

    for (const game of ["high-noon", "overwatch-ridge"]) {
      await page.goto(`/#${game}`);
      await expect(page.locator("#arcade")).toBeVisible();
      await page.mouse.move(1, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const last = (await card(page, "Overwatch Ridge").boundingBox())!;
      if (width > 860) {
        // The four shooters sit side by side, whole in the window, below the hero.
        expect(last.x + last.width).toBeLessThanOrEqual(width);
        expect(last.y + last.height).toBeLessThanOrEqual(height);
        const first = (await card(page, "High Noon").boundingBox())!;
        expect(Math.abs(first.y - last.y)).toBeLessThan(2);
      } else {
        // On a phone the row scrolls and snaps; the last is one arrow away.
        const row = page.getByRole("radiogroup", { name: "Games" });
        expect(await row.evaluate((node) => getComputedStyle(node).scrollSnapType)).toContain("mandatory");
        expect(await row.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
        await card(page, "High Noon").focus();
        await page.keyboard.press("End");
        await expect(card(page, "Overwatch Ridge")).toBeFocused();
        await expect.poll(async () => (await card(page, "Overwatch Ridge").boundingBox())!.x + (await card(page, "Overwatch Ridge").boundingBox())!.width).toBeLessThanOrEqual(width + 1);
        await page.keyboard.press("Home");
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await page.waitForTimeout(700);
      await shot(page, info, `arcade-${width}x${height}-${game}`, 0);
    }
  }
  expect(errors).toEqual([]);
});
