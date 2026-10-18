// What the HUD offers beyond High Noon's cylinder: a rifle's magazine and a
// laser's heat in the weapon's corner (and the gold of the golden weapon on
// each), a timed round's clock, and a stage of the shape a game's art can
// hold - each photographed in every state, on the Test Range.
import { expect, test, type Page } from "@playwright/test";
import { shot, returningVisitor, snapshot } from "./helpers";

async function range(page: Page, weapon: string): Promise<void> {
  await returningVisitor(page, { "handy.control.v1": "mouse" });
  await page.goto(`/?range=1&weapon=${weapon}#test-range`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  await page.mouse.move(700, 300);
}

/** Stages the HUD through the page's own HudSink (the game's next frame may redraw the weapon, so the game is paused first). */
const hud = (page: Page, script: string) => page.evaluate(`(() => { const hud = window.arcadeTest.hud(); ${script} })()`);
const corner = { x: 1440 - 260, y: 900 - 150, width: 260, height: 150 };

test("a rifle's magazine: ready, working the action, open and empty, reloading, and gold", async ({ page }, info) => {
  await range(page, "magazine");
  await page.evaluate(() => window.arcadeTest!.internals().host!.pause());
  const states: [string, string, RegExp][] = [
    ["ready", `hud.ammo(8, 8, false, { kind: "magazine", action: "ready" })`, /^8 of 8 rounds$/],
    ["cycling", `hud.ammo(7, 8, false, { kind: "magazine", action: "cycling" })`, /working the action/],
    ["five", `hud.ammo(3, 5, false, { kind: "magazine" })`, /^3 of 5 rounds$/],
    ["open-empty", `hud.ammo(0, 5, false, { kind: "magazine", action: "open" })`, /action open/],
    ["reloading", `hud.ammo(2, 5, true, { kind: "magazine", action: "open" })`, /^Reloading$/],
    ["gold", `hud.weaponFinish("gold"); hud.ammo(4, 5, false, { kind: "magazine" })`, /^4 of 5 rounds$/],
  ];
  for (const [name, script, label] of states) {
    await hud(page, script);
    await expect(page.locator("#magazine")).toHaveAttribute("aria-label", label);
    await expect(page.locator("#cylinder")).toBeHidden();
    await shot(page, info, `hud-magazine-${name}`, 300, corner);
    if (name === "ready") await shot(page, info, "hud-01-magazine", 0);
  }
});

test("a laser's heat: cold, warm, near the top, venting, and gold", async ({ page }, info) => {
  await range(page, "heat");
  await page.evaluate(() => window.arcadeTest!.internals().host!.pause());
  const states: [string, string, RegExp][] = [
    ["cold", `hud.heat(0, false)`, /^Heat 0%$/],
    ["warm", `hud.heat(0.4, false)`, /^Heat 40%$/],
    ["hot", `hud.heat(0.86, false)`, /^Heat 86%$/],
    ["venting", `hud.heat(0.7, true)`, /^Overheated, cooling: 70%$/],
    ["gold", `hud.weaponFinish("gold"); hud.heat(0.5, false)`, /^Heat 50%$/],
  ];
  for (const [name, script, label] of states) {
    await hud(page, script);
    await expect(page.locator("#heat")).toHaveAttribute("aria-label", label);
    await shot(page, info, `hud-heat-${name}`, 300, corner);
    if (name === "hot") await shot(page, info, "hud-02-heat", 0);
  }
  // Back to rounds: one corner at a time.
  await hud(page, `hud.ammo(6, 6, false)`);
  await expect(page.locator("#heat")).toBeHidden();
  await expect(page.locator("#cylinder")).toBeVisible();
});

test("a timed round's clock, and the gold cylinder", async ({ page }, info) => {
  await range(page, "cylinder");
  await expect(page.locator("#clock")).toHaveText(/^[01]:\d\d$/);
  await page.evaluate(() => window.arcadeTest!.internals().host!.pause());
  await hud(page, `hud.clock(48); hud.weaponFinish("gold"); hud.ammo(4, 6, false); hud.secret("The Bell", 1, 8)`);
  await expect(page.locator("#clock")).toHaveText("0:48");
  await expect(page.locator("#clock")).toHaveAttribute("role", "timer");
  await page.waitForTimeout(500);
  await shot(page, info, "hud-03-clock-gold", 0);
  // The secret's toast comes in under the clock, not over it.
  const clock = (await page.locator("#clock").boundingBox())!;
  const secret = (await page.locator(".secret").boundingBox())!;
  expect(secret.y).toBeGreaterThanOrEqual(clock.y + clock.height);
  await hud(page, `hud.clock(7, "warning")`);
  await expect(page.locator("#clock")).toHaveText("0:07");
  await expect(page.locator("#clock")).toHaveClass(/warning/);
  await shot(page, info, "hud-clock-warning", 100, { x: 520, y: 0, width: 400, height: 110 });
  await hud(page, `hud.clock(null)`);
  await expect(page.locator("#clock")).toBeHidden();
});

test("the stage keeps the shape the game's art can hold", async ({ page }) => {
  await returningVisitor(page, { "handy.control.v1": "mouse" });
  // The Test Range holds 1.25 : 1 at its tallest and 2.2 : 1 at its widest.
  await page.setViewportSize({ width: 420, height: 860 });
  await page.goto("/?range=1#test-range");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
  let box = (await page.locator("#stage").boundingBox())!;
  expect(box.width).toBeCloseTo(420, 0);
  expect(box.height).toBeCloseTo(420 / 1.25, 0);
  await page.setViewportSize({ width: 2000, height: 700 });
  await expect.poll(async () => (await page.locator("#stage").boundingBox())!.width).toBeCloseTo(700 * 2.2, 0);
  box = (await page.locator("#stage").boundingBox())!;
  expect(box.height).toBeCloseTo(700, 0);
  expect(box.x + box.width / 2).toBeCloseTo(1000, 0);
});

// Reduce Motion (the player's own, or the system's): what moves in play only
// fades, and nothing goes on moving without end. The probe lists every running
// animation that moves something or never stops; with motion allowed it must
// find them (so the probe can see), and with Reduce Motion on, none.
const movers = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .map((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const properties = new Set<string>();
        for (const frame of effect?.getKeyframes() ?? []) {
          for (const property of Object.keys(frame)) if (!["offset", "easing", "composite", "computedOffset"].includes(property)) properties.add(property);
        }
        const endless = effect?.getComputedTiming().iterations === Infinity;
        const moves = ["transform", "translate", "scale", "rotate", "strokeDashoffset"].some((property) => properties.has(property));
        return moves || endless ? (animation as CSSAnimation).animationName : null;
      })
      .filter((name): name is string => name !== null)
      .sort(),
  );

for (const reduce of [false, true]) {
  test(`${reduce ? "Reduce Motion: a rifle's action stands still, and a hit, a popup and a card only fade" : "with motion allowed the same moments do move (the probe sees them)"}`, async ({ page }) => {
    await returningVisitor(page, { "handy.control.v1": "mouse", "handy.settings.v1": { reduceMotion: reduce } });
    await page.goto("/?range=1&weapon=magazine#test-range");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("play");
    await page.evaluate(() => window.arcadeTest!.internals().host!.pause());
    await hud(
      page,
      `hud.ammo(7, 8, false, { kind: "magazine", action: "cycling" });
       hud.hitMarker(0.5, 0.5, "headshot"); hud.popup(0.5, 0.4, "+150 Headshot", "gold");
       hud.banner("Wave 3", "Runners cross the street."); hud.score(1240);`,
    );
    const names = await movers(page);
    if (reduce) {
      expect(names).toEqual([]);
    } else {
      expect(names).toEqual(expect.arrayContaining(["cycling", "marker-pop", "popup", "banner-in"]));
    }
  });
}
