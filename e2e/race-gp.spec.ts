// Grip Prix's Grand Prix and Mirror mode, with real rooms: a host and a guest in tabs of ONE browser (that is
// what ?net=local makes a room), the real net, the real sim and the real renderer, racing by keyboard (e2e/kart.ts).
// Muted, like every test here. The pictures of the standings and the podium go to src/kart/app/shots/ (ignored by git).
import { expect, test, type Page } from "@playwright/test";
import { TrackGeometry } from "../src/kart/track/geometry";
import { trackByRaceId } from "../src/kart/track/mirror";
import { KeyboardDriver, host, join, onScreen, open, state } from "./kart";

const SHOTS = "src/kart/app/shots";

// Sound off, and the first cup already won: winning the second one will open the secret track.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
    } catch {
      // no storage: the page decides
    }
  });
});

const startButton = (page: Page, name = "Start Race") => page.getByRole("button", { name });
const unlocks = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("grip-prix.unlocks") ?? "{}") as { cups?: string[] });

/** The points on the standings screen once its count-up has finished: what the rows add up to. */
async function pointsOnShow(page: Page): Promise<number[]> {
  return page.locator("#gp-rows .st-total").evaluateAll((cells) => cells.map((cell) => Number(cell.textContent)));
}

test("a host and a guest run a whole Grand Prix: four one-lap races, standings between, the podium at the end", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const errors: string[] = [];
  const context = page.context();
  const gus = await context.newPage();
  const late = await context.newPage();
  for (const [who, p] of [["host", page], ["gus", gus]] as const) p.on("pageerror", (error) => errors.push(`${who}: ${error.message}`));
  // The Comet Cup is already won on this device: the Acorn Cup is the second, and opens the secret track.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("grip-prix.unlocks", JSON.stringify({ ducks: [], cups: ["comet"], konami: false }));
    } catch {
      // no storage: the page decides
    }
  });

  const code = await host(page, "Hana");
  await join(gus, code, "Gus");
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(2);

  // The host chooses a Grand Prix: the cups show their four tracks, the Acorn Cup is chosen, laps are per race.
  await page.getByRole("radio", { name: "Grand Prix" }).click();
  await expect(page.locator("#row-cup")).toBeVisible();
  await expect(page.locator("#row-track")).toBeHidden();
  await expect(page.getByRole("radio", { name: /Acorn Cup/ })).toContainText("Canyon Run");
  await expect(page.getByRole("radio", { name: /Comet Cup/ })).toContainText("Starlight Ribbon");
  await page.getByRole("radio", { name: /Acorn Cup/ }).click();
  await expect(page.getByRole("radio", { name: /Acorn Cup/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#label-laps")).toHaveText("Laps per Race");
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("switch", { name: "Bots" }).click();
  await expect(gus.locator("#lobby-waiting")).toContainText("Acorn Cup");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/gp-lobby.png` });
  await startButton(page, "Start Grand Prix").click();

  const tracks = ["Meadow Loop", "Kitchen Rally", "Harbour Lights", "Canyon Run"];
  const drivers = [new KeyboardDriver(page).start(), new KeyboardDriver(gus).start()];
  const seen: { names: string[]; colours: string[] }[] = [];
  for (let race = 0; race < 4; race++) {
    await onScreen(page, "race", 60_000);
    await onScreen(gus, "race", 30_000);
    await expect.poll(async () => (await state(page)).race?.trackId, { timeout: 30_000 }).toBe(["meadow-loop", "kitchen-rally", "harbour-lights", "canyon-run"][race]);
    await expect.poll(async () => (await state(gus)).race?.trackId, { timeout: 30_000 }).toBe((await state(page)).race?.trackId);

    // The race's results, with the points each place earned.
    await onScreen(page, "results", 240_000);
    await onScreen(gus, "results", 60_000);
    for (const p of [page, gus]) {
      await expect(p.locator("#results-eyebrow")).toContainText(`Acorn Cup · Race ${race + 1} of 4 · ${tracks[race]}`);
      await expect(p.locator("#standings-body tr")).toHaveCount(2);
      await expect(p.locator("#th-points")).toBeVisible();
      await expect(p.locator("#standings-body .c-points").first()).toHaveText("+15");
      await expect(p.locator("#standings-body .c-points").last()).toHaveText("+12");
    }
    // Only the host moves things on, and the guest is told the standings are coming.
    await expect(page.locator("#results-next")).toBeVisible();
    await expect(gus.locator("#results-next")).toBeHidden();
    await expect(gus.locator("#results-again")).toBeHidden();
    await expect(gus.locator("#results-wait")).toContainText("The standings come up in a moment.");

    if (race === 0) {
      await page.screenshot({ path: `${SHOTS}/gp-results.png` });
      // A latecomer is turned away: the cup has begun.
      await open(late);
      await late.getByLabel("Race code").fill(code);
      await late.getByRole("button", { name: "Join a Race" }).click();
      await expect(late.locator("#trouble")).toContainText("That race has already started.");
      await late.getByRole("button", { name: "Back to Start" }).click();
      // Nobody presses anything: the standings come up by themselves, and so does the next race.
      await onScreen(page, "standings", 40_000);
    } else {
      await page.locator("#results-next").click();
      await onScreen(page, "standings", 20_000);
    }
    await onScreen(gus, "standings", 20_000);

    // The standings count up to the points so far (15 and 12 a race), the same on both screens.
    for (const p of [page, gus]) {
      await expect(p.locator("#gp-title")).toHaveText(race === 3 ? "Final Standings" : "Standings");
      await expect(p.locator("#gp-eyebrow")).toContainText(`Acorn Cup · After Race ${race + 1} of 4`);
      await expect(p.locator("#gp-rows .st-row")).toHaveCount(2);
      await expect.poll(async () => (await pointsOnShow(p)).reduce((a, b) => a + b, 0), { timeout: 12_000 }).toBe(27 * (race + 1));
      await expect(p.locator("#gp-rows .st-row.mine")).toHaveCount(1);
      await expect(p.locator("#gp-rows .st-row").first()).toHaveClass(/leader/);
    }
    // Nobody is asked to get ready again, and the host alone has the button.
    await expect(page.locator("#gp-next")).toBeVisible();
    await expect(gus.locator("#gp-next")).toBeHidden();
    await expect(page.locator("#gp-next")).toHaveText(race === 3 ? "See the Podium" : "Next Race");
    if (race === 1) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/gp-standings.png` });
    }
    const lobby = (await state(page)).lobby!;
    seen.push({
      names: lobby.grandPrix!.points.map((row) => row.name).sort(),
      colours: lobby.grandPrix!.points.map((row) => row.colour).sort(),
    });
    expect(lobby.grandPrix).toMatchObject({ cup: "acorn", race });
    expect(lobby.players.map((p) => p.ready)).toEqual([true, true]);

    if (race === 0) {
      // The room moves on by itself after a few seconds; the later standings are skipped by the host.
      await onScreen(page, "race", 40_000);
    } else {
      await page.locator("#gp-next").click();
    }
  }
  // The same drivers, in the same colours, all cup long.
  for (const each of seen) expect(each).toEqual(seen[0]);

  // The podium, on both devices: the cup's name, the final standings, the ceremony drawn.
  await onScreen(page, "podium", 20_000);
  await onScreen(gus, "podium", 20_000);
  for (const p of [page, gus]) {
    await expect(p.locator("#podium-title")).toHaveText("Acorn Cup");
    await expect(p.locator("#podium-rows li")).toHaveCount(2);
    await expect(p.locator("canvas.podium-canvas")).toBeVisible();
    await expect(p.locator("#podium-sub")).toContainText(`Acorn Cup, with ${(await state(p)).lobby!.grandPrix!.points[0]!.points} points.`);
  }
  await expect(page.locator("#podium-again")).toBeVisible();
  await expect(gus.locator("#podium-again")).toBeHidden();
  await expect(gus.locator("#podium-wait")).toContainText("Hana can play the Acorn Cup again.");

  // Whoever won the cup has it written down, and, the Comet Cup being won already, is told the secret track is open.
  const final = (await state(page)).lobby!;
  const winner = final.grandPrix!.points[0]!;
  expect(final.grandPrix!.points.map((row) => row.points).sort((a, b) => b - a)).toEqual(final.grandPrix!.points.map((row) => row.points));
  const winnerPage = final.players.find((p) => p.slot === winner.player)?.device === (await state(page)).device ? page : gus;
  const otherPage = winnerPage === page ? gus : page;
  await expect(winnerPage.locator("#podium-unlock")).toBeVisible();
  await expect(winnerPage.locator("#podium-unlock")).toHaveText("You unlocked a secret track!");
  await expect(otherPage.locator("#podium-unlock")).toBeHidden();
  expect((await unlocks(winnerPage)).cups).toEqual(expect.arrayContaining(["acorn", "comet"]));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/gp-podium.png` });
  await winnerPage.screenshot({ path: `${SHOTS}/gp-podium-winner.png` });

  // Play Again: the same cup from its first race, the points back to nothing.
  await page.getByRole("button", { name: "Play Again" }).click();
  await onScreen(page, "race", 60_000);
  await onScreen(gus, "race", 30_000);
  await expect.poll(async () => (await state(page)).lobby!.grandPrix).toMatchObject({ cup: "acorn", race: 0 });
  expect((await state(page)).lobby!.grandPrix!.points.map((row) => row.points)).toEqual([0, 0]);
  await expect.poll(async () => (await state(page)).race?.trackId, { timeout: 30_000 }).toBe("meadow-loop");
  await Promise.all(drivers.map((driver) => driver.stop()));
  expect(errors).toEqual([]);
});

test("a mirrored race: the same road flipped, on the host and on the guest, driven to the finish", async ({ page }, info) => {
  test.setTimeout(10 * 60_000);
  const errors: string[] = [];
  const gus = await page.context().newPage();
  page.on("pageerror", (error) => errors.push(`host: ${error.message}`));
  gus.on("pageerror", (error) => errors.push(`gus: ${error.message}`));

  const code = await host(page, "Hana");
  await join(gus, code, "Gus");
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("switch", { name: "Mirror Mode" }).click();
  await expect(page.getByRole("switch", { name: "Mirror Mode" })).toHaveAttribute("aria-checked", "true");
  await expect(gus.locator("#lobby-waiting")).toContainText("Every track is mirrored.");
  await startButton(page).click();

  await onScreen(page, "race", 60_000);
  await onScreen(gus, "race", 30_000);
  for (const p of [page, gus]) {
    await expect.poll(async () => (await state(p)).race?.trackId, { timeout: 30_000 }).toBe("meadow-loop-mirror");
    // The karts stand on the flipped road: on the mirrored track every one is inside the road's edges.
    const { race } = await state(p);
    const geometry = TrackGeometry.build(trackByRaceId(race!.trackId));
    for (const kart of race!.karts) expect(Math.abs(geometry.project(kart.x, kart.z).offset), `kart ${kart.id}`).toBeLessThan(geometry.at(0).width / 2);
  }
  await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe("racing");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/mirror-race.png` });

  const drivers = [new KeyboardDriver(page).start(), new KeyboardDriver(gus).start()];
  await onScreen(page, "results", 240_000);
  await onScreen(gus, "results", 60_000);
  await Promise.all(drivers.map((driver) => driver.stop()));
  await expect(page.locator("#results-eyebrow")).toContainText("Meadow Loop · 1 lap");
  await expect(page.locator("#standings-body tr")).toHaveCount(6);
  expect(errors).toEqual([]);
  void info;
});

test("the secret track is in the host's track list only once both cups are won", async ({ page, context }) => {
  // Not yet won: the eight tracks of the cups, and no more.
  await host(page, "Hana");
  const tracksOf = (p: Page) => p.getByRole("radiogroup", { name: "Track" }).getByRole("radio");
  await expect(tracksOf(page)).toHaveCount(8);
  expect((await tracksOf(page).allTextContents()).join()).not.toContain("Five Finger Circuit");

  // Both cups won on this device: the secret track joins the list, and can be raced.
  const second = await context.newPage();
  await second.addInitScript(() => {
    localStorage.setItem("grip-prix.unlocks", JSON.stringify({ ducks: [], cups: ["acorn", "comet"], konami: false }));
  });
  await host(second, "Hana");
  await expect(tracksOf(second)).toHaveCount(9);
  await expect(tracksOf(second).last()).toContainText("Five Finger Circuit");
  await expect(tracksOf(second).last()).toContainText("Secret");
  await tracksOf(second).last().click();
  await second.getByRole("radio", { name: "1", exact: true }).click();
  await second.getByRole("button", { name: "Start Race" }).click();
  await onScreen(second, "race", 60_000);
  await expect.poll(async () => (await state(second)).race?.trackId, { timeout: 30_000 }).toBe("five-finger-circuit");
});
