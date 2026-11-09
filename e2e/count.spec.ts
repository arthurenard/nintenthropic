// Auto, the first choice for the players on the camera: the camera comes on and counts everyone holding up their fists,
// then the drivers are chosen for that many. The hands here are scripted (?input=script) and read by the real app; the
// real tracker counting real pictures of hands is in seats.spec.ts. Muted, like every test.
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers";
import { chooseDrivers, onScreen, open, pastHowTo, state } from "./kart";

/** A returning player: the wheel check done once, the camera already opened. */
const returning = async (page: Page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
      localStorage.setItem("handy.kart.checked.v1", "true");
      localStorage.setItem("handy.camera-opened.v1", "true");
    } catch {
      // no storage: the page decides
    }
  });
};

type Pose = Parameters<NonNullable<Window["gripTest"]>["wheel"]>[0];
const wheels = (page: Page, pose: Pose) => page.evaluate((p) => window.gripTest!.wheel(p), pose);
/** `n` wheels side by side, one in each of n columns of the picture. */
const side = (n: number): Pose => Array.from({ length: n }, (_, i) => ({ angle: 0, centre: [(i + 0.5) / n, 0.5] as const, span: 0.6 / n }));

test("Auto counts two players on the camera, and the drivers and the wheel check are for two", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returning(page);
  await open(page, "&input=script");
  await wheels(page, side(2));
  await page.getByRole("button", { name: "Practice" }).click();
  const players = page.getByRole("radiogroup", { name: "Players on This Camera" });
  await expect(players.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Name", { exact: true }).fill("Maya");
  await shot(page, info, "count-1-you-auto", 300);
  await page.getByRole("button", { name: "Continue" }).click();

  // Counted: the picture split for two, and the count moves on by itself.
  await expect(page.locator("#count-title")).toHaveText("2 Players");
  await expect(page.locator("#count-picture canvas")).toBeVisible();
  await shot(page, info, "count-2-two", 300);
  await expect(page.locator("#count-detail")).toHaveText("Next, choose your drivers.", { timeout: 5_000 });
  await onScreen(page, "driver", 5_000);

  // Two seats to choose for, then two wheels checked side by side: the second named as last time.
  await expect(page.locator("#driver-seats button")).toHaveCount(2);
  await chooseDrivers(page);
  await expect(page.locator(".check-picture")).toHaveCount(2);
  await pastHowTo(page);
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(2);
  expect((await state(page)).wheels).toHaveLength(2);

  // Auto stays the choice: the count is not taken for one.
  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(players.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("Auto waits for fists, counts a friend who comes late, and Back goes back to the choice", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returning(page);
  await open(page, "&input=script");
  await wheels(page, null);
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Nobody yet: the count asks for fists, and offers no way on.
  await expect(page.locator("#count-title")).toHaveText("Fists up, everyone driving");
  await expect(page.locator("#count-continue")).toBeHidden();
  await page.waitForTimeout(2_500);
  await onScreen(page, "count");
  await shot(page, info, "count-3-nobody", 100);

  // One player, then a second before the count has settled: two.
  await wheels(page, side(1));
  await expect(page.locator("#count-title")).toHaveText("1 Player");
  await expect(page.locator("#count-detail")).toHaveText("Anyone else driving? Fists up now.");
  await page.waitForTimeout(600);
  await wheels(page, side(2));
  await expect(page.locator("#count-title")).toHaveText("2 Players");
  await onScreen(page, "driver", 6_000);
  await expect(page.locator("#driver-seats button")).toHaveCount(2);

  // Back from the drivers is the You screen, Auto still chosen; Continue counts again, and Back from the count too.
  await page.locator("#driver-back").click();
  await onScreen(page, "you");
  await wheels(page, side(3));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#count-title")).toHaveText("3 Players");
  await shot(page, info, "count-4-three", 200);
  await page.locator("#count-back").click();
  await onScreen(page, "you");
  await expect(page.getByRole("radiogroup", { name: "Players on This Camera" }).getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");

  // Continue on the count goes on at once with the players counted so far.
  await wheels(page, side(1));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#count-title")).toHaveText("1 Player");
  await page.locator("#count-continue").click();
  await onScreen(page, "driver", 2_000);
  await expect(page.locator("#driver-seats")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a number chosen is the count: no camera count, and the friends named", async ({ page }) => {
  await returning(page);
  await open(page, "&input=script");
  await wheels(page, side(2));
  await page.getByRole("button", { name: "Practice" }).click();
  const players = page.getByRole("radiogroup", { name: "Players on This Camera" });
  await players.getByRole("radio", { name: "2", exact: true }).click();
  await expect(page.getByLabel("Second Driver")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await onScreen(page, "driver");
  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(players.getByRole("radio", { name: "2", exact: true })).toHaveAttribute("aria-checked", "true");
});
