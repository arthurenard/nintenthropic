// Grip Prix's screens (race.html) on the real parts: start, you, the wheel
// check, the lobby, the race, the results, the troubles. The wheel is read by
// the real WheelReader from hands that a script moves (?input=script), or
// from Chrome's fake camera with MediaPipe finding the one hand in its
// picture; the room is the real net over ?net=local, the race the real sim
// and renderer. Photographed at the two sizes the design must hold at
// (desktop and phone). Rooms with several people are in race-room.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers";
import { chooseDrivers, host, join, onScreen, open, pastHowTo, state, WheelDrivers } from "./kart";

// The site's sound preference is off in these tests, as Chrome is muted too: no music is made, nothing plays. The sound test turns it on.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
    } catch {
      // no storage: the page decides
    }
  });
});

/** A returning player: the wheel check done once, the camera already opened. */
const returning = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem("handy.kart.checked.v1", "true");
    localStorage.setItem("handy.camera-opened.v1", "true");
  });
};

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name });
const start = (page: Page) => page.getByRole("button", { name: "Start Race" });
const raceState = async (page: Page) => (await state(page)).race;
const phase = async (page: Page) => (await raceState(page))?.phase;

/** Practice with the keyboard, down to the lobby. */
async function practiceToLobby(page: Page, laps = 1) {
  await open(page);
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page);
  await expect(heading(page, "Ready to Race")).toBeVisible();
  await page.getByRole("radio", { name: String(laps), exact: true }).click();
}

/** Into a practice race and past the loading screen. */
async function practiceRace(page: Page) {
  await practiceToLobby(page);
  await start(page).click();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
}

test("the start screen: the title, three ways in, a code field that tidies what is typed", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(heading(page, "Grip Prix")).toBeVisible();
  await expect(page.getByText("Grip the wheel. Race your friends.")).toBeVisible();
  for (const name of ["Host a Race", "Practice"]) await expect(page.getByRole("button", { name })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Super Claude Bros." })).toHaveAttribute("href", "./");
  await shot(page, info, "race-1-start", 400);

  // Capitals, letters only, four at most; Join waits for all four.
  const field = page.getByLabel("Race code");
  const join = page.getByRole("button", { name: "Join a Race" });
  await expect(join).toBeDisabled();
  await field.pressSequentially("ab1cdef");
  await expect(field).toHaveValue("ABCD");
  await expect(join).toBeEnabled();
  await field.press("Backspace");
  await expect(field).toHaveValue("ABC");
  await expect(join).toBeDisabled();
  expect(errors).toEqual([]);
});

test("practice with the keyboard: you, the lobby, the race, and its pause and restart", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.getByRole("button", { name: "Practice" }).click();

  // You: a friendly name already there, remembered, the wheel by default.
  await expect(heading(page, /Driving/)).toBeVisible();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).not.toHaveValue("");
  await expect(page.getByRole("radio", { name: "Wheel" })).toHaveAttribute("aria-checked", "true");
  await shot(page, info, "race-2-you", 500);
  await name.fill("Maya");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  // Keys and pads have no steering to set and no friends on the camera.
  await expect(page.getByText("Steering", { exact: true })).toBeHidden();
  await expect(page.getByRole("radiogroup", { name: "Players on This Camera" })).toBeHidden();
  await shot(page, info, "race-2b-you-keyboard", 300);
  await page.getByRole("button", { name: "Continue" }).click();

  // Choose Your Driver: a stage with the driver in their kart, their weight class and bars, the nine drivers to choose from.
  await expect(heading(page, "Choose Your Driver")).toBeVisible();
  await expect(page.locator("#driver-name")).not.toHaveText("");
  await expect(page.locator("#driver-stats .stat")).toHaveCount(4);
  await expect(page.getByRole("radiogroup", { name: "Drivers" }).getByRole("radio")).toHaveCount(9);
  await shot(page, info, "race-2e-driver", 800);
  await chooseDrivers(page);

  // How to Drive, for the keys: a card lights while its key is down.
  await expect(heading(page, "How to Drive")).toBeVisible();
  await expect(page.locator(".move")).toHaveCount(6);
  await expect(page.locator('.move[data-move="drift"] kbd')).toHaveText("Space");
  await page.keyboard.down("ArrowUp");
  await expect(page.locator('.move[data-move="go"]')).toHaveClass(/\bon\b/);
  await shot(page, info, "race-2f-howto-keys", 300);
  await page.keyboard.up("ArrowUp");
  await expect(page.locator('.move[data-move="go"]')).not.toHaveClass(/\bon\b/);
  await page.keyboard.press("KeyH");
  await expect(page.locator('.move[data-move="honk"]')).toHaveClass(/\bon\b/);
  await pastHowTo(page);

  // The lobby for practice: no code, no choice of where to watch, the players, the race to set.
  await expect(heading(page, "Ready to Race")).toBeVisible();
  await expect(page.locator("#lobby-code")).toBeHidden();
  await expect(page.locator("#row-display")).toBeHidden();
  await expect(page.locator("#lobby-players")).toContainText("Maya");
  await expect(page.locator("#lobby-players")).toContainText("Keyboard");
  await shot(page, info, "race-4-lobby-practice", 500);
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await expect(page.getByRole("radio", { name: "1", exact: true })).toHaveAttribute("aria-checked", "true");
  await start(page).click();

  // The race: the canvas, the pause control, the countdown first, then Go.
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  // The loading screen said what was loading: the track, its cup and the laps.
  await expect(page.locator("#loading-track")).toHaveText("Meadow Loop");
  await expect(page.locator("#loading-cup")).toHaveText("Acorn Cup · 1 lap");
  await expect(page.locator("#screen-race")).toBeVisible();
  await expect.poll(() => phase(page)).toBe("countdown");
  await shot(page, info, "race-5-countdown", 300);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe("racing");
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("ArrowRight");
  await shot(page, info, "race-5b-race", 1500);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("ArrowUp");
  // Six karts on the grid: us and five bots.
  expect((await raceState(page))!.karts).toHaveLength(6);
  expect((await state(page)).mine).toHaveLength(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave Race" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();
  expect(errors).toEqual([]);
});

test("pausing: Escape and the button open a sheet; practice waits, Resume counts 3-2-1 and carries on", async ({ page }, info) => {
  await practiceRace(page);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe("racing");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  const sheet = page.locator("#pause-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("The race waits for you.");
  // Practice is the host's own: it can restart.
  await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
  await shot(page, info, "race-5d-pause", 500);

  // Graphics: Auto until chosen; a choice is kept on the device for the next race. The frame-rate readout is off until switched on.
  const graphics = sheet.getByRole("radiogroup", { name: "Graphics" });
  await expect(graphics.getByRole("radio")).toHaveCount(4);
  await expect(graphics.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#graphics-note")).toContainText(/Auto uses (Low|Medium|High) on this device/);
  await graphics.getByRole("radio", { name: "Low" }).click();
  await expect(graphics.getByRole("radio", { name: "Low" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#graphics-note")).toHaveText("Low graphics from the next race.");
  expect(await page.evaluate(() => localStorage.getItem("handy.kart.graphics.v1"))).toBe('"low"');
  await expect(page.locator("#race-fps")).toBeHidden();
  await sheet.getByRole("switch", { name: "Frame Rate" }).click();
  await expect(page.locator("#race-fps")).toBeVisible();
  await shot(page, info, "race-5d2-pause-graphics", 300);
  await sheet.getByRole("switch", { name: "Frame Rate" }).click();
  await expect(page.locator("#race-fps")).toBeHidden();
  await graphics.getByRole("radio", { name: "Auto" }).click();
  expect(await page.evaluate(() => localStorage.getItem("handy.kart.graphics.v1"))).toBe('"auto"');
  const stopped = (await raceState(page))!.time;
  await page.waitForTimeout(1200);
  expect((await raceState(page))!.time).toBe(stopped);

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(sheet).toBeHidden();
  // Three, two, one: nothing moves until they are done.
  await expect(page.locator("#pause-veil")).toBeVisible();
  await expect(page.locator("#pause-veil")).toContainText("Get Ready");
  await expect(page.locator("#pause-count")).toHaveText(/^[123]$/);
  await shot(page, info, "race-5e-resuming", 100);
  expect((await raceState(page))!.time).toBe(stopped);
  await expect(page.locator("#pause-veil")).toBeHidden({ timeout: 6000 });
  await expect.poll(async () => (await raceState(page))!.time, { timeout: 5000 }).toBeGreaterThan(stopped + 0.5);

  // The pause button does the same as Escape, and so does P.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.keyboard.press("p");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("p");
  await expect(sheet).toBeHidden();
  await page.keyboard.up("ArrowUp");

  // Restart begins the race afresh: the countdown again.
  await expect(page.locator("#pause-veil")).toBeHidden({ timeout: 6000 });
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe("countdown");
});

test("the loading screen: the track's name, its bar and the tip each in their own place, from the first frame", async ({ page }) => {
  await practiceToLobby(page);
  const lobby = (await state(page)).lobby!;
  await page.evaluate((room) => window.gripTest!.loading(room, 0.4), lobby);
  // At once, while the card is still rising (its rise once carried the tip up over the bar), and when it has settled.
  for (const wait of [50, 1200]) {
    await page.waitForTimeout(wait);
    const status = (await page.locator("#race-loading-title").boundingBox())!;
    const tip = (await page.locator("#loading-tip").boundingBox())!;
    expect(tip.y, `the tip, ${wait} ms in`).toBeGreaterThanOrEqual(status.y + status.height);
    expect(tip.y + tip.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
});

test("the host's lobby, Grand Prix and Mirror included, is never wider than the screen, and its long choices stay in their track", async ({ page }) => {
  await host(page, "Maya");
  await page.getByRole("radio", { name: "Grand Prix" }).click();
  await expect(page.locator("#row-cup")).toBeVisible();
  await page.getByRole("switch", { name: "Mirror Mode" }).click();
  await page.waitForTimeout(600);
  // Nothing sideways to scroll to (at 390 px this was 457 wide once).
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // The segmented control that says where the race shows: both of its choices inside it.
  const track = (await page.locator("#pick-display").boundingBox())!;
  for (const name of ["On Everyone’s Own Screen", "On This Screen"]) {
    const choice = (await page.getByRole("radio", { name }).boundingBox())!;
    expect(choice.x).toBeGreaterThanOrEqual(track.x - 1);
    expect(choice.x + choice.width).toBeLessThanOrEqual(track.x + track.width + 1);
  }
});

test("on a phone on its side the pause sheet shows all its buttons", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await practiceRace(page);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe("racing");
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await page.waitForTimeout(600);
  for (const name of ["Resume", "Restart", "Leave Race"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.y, name).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, name).toBeLessThanOrEqual(390);
  }
});

test("hosting with the wheel: the check, the code and its QR code, and the wheel's picture in the race", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "&input=script&camera=ask");
  await page.getByRole("button", { name: "Host a Race" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await expect(page.locator("#you-eyebrow")).toHaveText("Host a Race");
  // The wheel is the default, with its steering and a second player on offer.
  await expect(page.getByRole("radio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Quick" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);

  // Before the browser asks for the camera, we say why.
  await expect(page.locator("#prime")).toBeVisible();
  await expect(page.locator("#prime")).toContainText("The picture stays on this device; only your photo at the finish line goes to the friends you race.");
  await shot(page, info, "race-3a-prime", 400);
  await page.locator("#prime").getByRole("button", { name: "Continue" }).click();

  // The wheel check, one idea at a time, on the real reader: fists, held level, turned both ways, opened to brake.
  const title = page.locator("#check-title");
  const wheel = (pose: Parameters<NonNullable<Window["gripTest"]>["wheel"]>[0]) => page.evaluate((p) => window.gripTest!.wheel(p), pose);
  await expect(title).toHaveText("Hold your fists up, like a wheel");
  await wheel(null);
  await page.waitForTimeout(500);
  await shot(page, info, "race-3a-check-no-hands", 100);
  await wheel({ angle: 0 });
  await expect(title).toHaveText("Hold it level", { timeout: 5_000 });
  await expect(page.locator(".check-picture")).toHaveAttribute("data-step", "level");
  await shot(page, info, "race-3c-check-level", 500);
  await expect(title).toHaveText("Turn it", { timeout: 5_000 });
  await wheel({ angle: -30 });
  await expect(page.locator("#check-detail")).toHaveText("Now the other way.", { timeout: 5_000 });
  await wheel({ angle: 30 });
  await expect(title).toHaveText("Open your hands to brake", { timeout: 5_000 });
  await shot(page, info, "race-3d-check-brake", 200);
  await wheel({ angle: 0, fingers: "open" });
  await expect(title).toHaveText("Ready", { timeout: 5_000 });
  await wheel({ angle: 0 });
  await shot(page, info, "race-3e-check-ready", 300);

  // How to Drive, for hands: fists on the wheel light Go; turning it lights Steer; raising both open hands goes on.
  await expect(heading(page, "How to Drive")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#howto-cheer")).toBeVisible();
  await expect(page.locator('.move[data-move="go"]')).toHaveClass(/\bon\b/, { timeout: 5_000 });
  await wheel({ angle: 30 });
  await expect(page.locator('.move[data-move="steer"]')).toHaveClass(/\bon\b/, { timeout: 5_000 });
  await shot(page, info, "race-3f-howto-hands", 300);
  await wheel({ angle: 0 });
  await pastHowTo(page);

  // The lobby: the code large, a QR code of the join address, the players, and where the race shows.
  await expect(heading(page, "Your Race")).toBeVisible({ timeout: 10_000 });
  const code = (await page.locator("#lobby-code").textContent())!;
  expect(code).toMatch(/^[A-Z]{4}$/);
  await expect(page.locator("#lobby-url")).toContainText(`race.html?join=${code}&net=local`);
  await expect(page.locator("#qr-canvas")).toBeVisible();
  const dark = await page.locator("#qr-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 64) count++;
    return count;
  });
  expect(dark).toBeGreaterThan(500);
  await expect(page.locator("#lobby-players")).toContainText("You");
  await expect(page.locator("#lobby-players")).toContainText("This screen");
  await expect(page.locator("#lobby-players")).toContainText("Wheel");
  await shot(page, info, "race-4-lobby-host", 400);
  // The race to set: laps, bots, and where it shows.
  await page.getByRole("radio", { name: "2", exact: true }).click();
  await page.getByRole("switch", { name: "Bots" }).click();
  await expect(page.locator("#foot-bots")).toHaveText("Only the players race.");
  await page.getByRole("switch", { name: "Bots" }).click();
  await expect(page.getByRole("radio", { name: "On Everyone’s Own Screen" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "On This Screen" }).click();
  await expect(page.locator("#foot-display")).toContainText("split screen");
  await page.getByRole("radio", { name: "On Everyone’s Own Screen" }).click();
  await expect(start(page)).toBeEnabled();
  await start(page).click();

  // The race: the wheel's picture in the corner, and Show Both Hands in the viewport when the hands go.
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator(".corner-preview")).toHaveCount(1);
  await expect(page.locator(".corner-preview canvas")).toBeVisible();
  await expect(page.locator(".view-note")).toHaveCount(0);
  await wheel(null);
  await expect(page.locator(".view-note")).toHaveText("Show Both Hands", { timeout: 5_000 });
  await shot(page, info, "race-5c-lost-hands", 200);
  await wheel({ angle: 0 });
  await expect(page.locator(".view-note")).toHaveCount(0, { timeout: 5_000 });
  // Drifting to the right of the camera's view: the way back in, before a hand is lost.
  await wheel({ angle: 0, centre: [0.86, 0.45] });
  await expect(page.locator(".view-note.edge-note")).toHaveText("Move Left", { timeout: 5_000 });
  await shot(page, info, "race-5d-edge", 200);
  await wheel({ angle: 0 });
  await expect(page.locator(".view-note")).toHaveCount(0, { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test("a returning wheel player is asked only to hold it level", async ({ page }, info) => {
  await returning(page);
  await open(page, "&input=script");
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  // No prime for a camera that has opened here before; only the level.
  await expect(page.locator("#screen-check")).toBeVisible();
  await expect(page.locator("#check-title")).toHaveText("Hold it level");
  await expect(page.locator("#check-steps")).toBeHidden();
  await shot(page, info, "race-3f-check-returning", 300);
  await expect(page.locator("#check-title")).toHaveText("Ready", { timeout: 5_000 });
  await pastHowTo(page);
  await expect(heading(page, "Ready to Race")).toBeVisible({ timeout: 10_000 });
});

test("two on one camera: a second name, and each checked in their own picture", async ({ page }, info) => {
  await returning(page);
  await open(page, "&input=script");
  await page.evaluate(() =>
    window.gripTest!.wheel([
      { angle: 0, centre: [0.25, 0.45], span: 0.3 },
      { angle: 0, centre: [0.75, 0.45], span: 0.3 },
    ]),
  );
  await page.getByRole("button", { name: "Practice" }).click();
  const players = page.getByRole("radiogroup", { name: "Players on This Camera" });
  await expect(players.getByRole("radio", { name: "1", exact: true })).toHaveAttribute("aria-checked", "true");
  await players.getByRole("radio", { name: "2", exact: true }).click();
  await expect(players.getByRole("radio", { name: "2", exact: true })).toHaveAttribute("aria-checked", "true");
  // The first name is chosen too: a random default that happened to be Finn would make the second one change (two with one name).
  await page.getByLabel("Name", { exact: true }).fill("Maya");
  await page.getByLabel("Second Driver").fill("Finn");
  await shot(page, info, "race-2c-you-two", 400);
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await expect(page.locator(".check-picture")).toHaveCount(2);
  await expect(page.locator(".check-name").nth(1)).toHaveText("Finn");
  await shot(page, info, "race-3g-check-two", 400);
  await pastHowTo(page);
  await expect(heading(page, "Ready to Race")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(2);
  await expect(page.locator("#lobby-players")).toContainText("Finn");
  // Both wheels race: a corner picture each, and a viewport each.
  await start(page).click();
  await expect(page.locator(".corner-preview")).toHaveCount(2);
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect.poll(async () => (await state(page)).views.length).toBe(2);
});

test("four on one camera: names and drivers for each, one picture with four columns, a 4-view race, the results", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await returning(page);
  await open(page, "&input=script");
  // Four wheels, one in each quarter of the picture.
  const quarters = [0, 1, 2, 3].map((i) => ({ angle: [20, -15, 0, 25][i]!, centre: [0.125 + 0.25 * i, 0.5] as const, span: 0.2 }));
  await page.evaluate((poses) => window.gripTest!.wheel(poses), quarters);
  await page.getByRole("button", { name: "Practice" }).click();
  const players = page.getByRole("radiogroup", { name: "Players on This Camera" });
  await players.getByRole("radio", { name: "4", exact: true }).click();
  await expect(players.getByRole("radio", { name: "4", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Name", { exact: true }).fill("Maya");
  await page.getByLabel("Second Driver").fill("Finn");
  await page.getByLabel("Third Driver").fill("Ada");
  await page.getByLabel("Fourth Driver").fill("Kit");
  await page.locator("#group-second").scrollIntoViewIfNeeded();
  await shot(page, info, "race-2d-you-four", 500);

  // Every seat picks its driver, in turn: four chips say whose turn it is.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "Choose Your Driver")).toBeVisible();
  await expect(page.locator("#driver-seats button")).toHaveCount(4);
  const picks = ["Pepper", "Moss", "Kit", "Juniper"];
  for (const [i, pick] of picks.entries()) {
    await page.getByRole("radiogroup", { name: "Drivers" }).getByRole("radio", { name: new RegExp("^" + pick) }).click();
    await expect(page.locator("#driver-name")).toHaveText(pick);
    await shot(page, info, "race-2f-driver-seat-" + (i + 1), i === 0 ? 800 : 200);
    await page.locator("#driver-continue").click();
  }
  // One picture of the whole camera with the columns marked, and a chip for each player under it.
  await expect(page.locator(".check-shared")).toBeVisible();
  await expect(page.locator(".check-shared canvas")).toHaveCount(1);
  await expect(page.locator(".check-chip")).toHaveCount(4);
  await expect(page.locator(".check-chip .check-name")).toHaveText(["Maya", "Finn", "Ada", "Kit"]);
  await shot(page, info, "race-3h-check-four", 700);
  await pastHowTo(page);
  await expect(heading(page, "Ready to Race")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#lobby-players .racer:not(.empty)")).toHaveCount(4);
  for (const name of ["Maya", "Finn", "Ada", "Kit"]) await expect(page.locator("#lobby-players")).toContainText(name);
  // Each of the four is driving the driver their seat chose.
  expect((await state(page)).lobby!.players.map((player) => player.character)).toEqual(["pepper", "moss", "kit", "juniper"]);
  await page.getByRole("radio", { name: "1", exact: true }).click();

  // Four viewports and one shared picture of the camera in the corner.
  await start(page).click();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator(".corner-preview")).toHaveCount(1);
  await expect(page.locator(".corner-preview.shared canvas")).toHaveCount(1);
  await expect.poll(async () => (await state(page)).views.length).toBe(4);
  expect((await state(page)).mine.every((kart) => kart !== null)).toBe(true);
  expect((await raceState(page))!.karts).toHaveLength(6);
  const drivers = new WheelDrivers(page, 4).start();
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe("racing");
  await shot(page, info, "race-5f-race-four", 4000);
  await onScreen(page, "results", 170_000);
  await drivers.stop();
  await expect(page.locator("#standings-body tr")).toHaveCount(6);
  await expect(page.locator("#standings-body tr.mine")).toHaveCount(4);
  // The top three wear their medals.
  await expect(page.locator("#standings-body tr[data-place='1'] .medal")).toHaveText("1st");
  await shot(page, info, "race-6-results-four", 400);
  expect(errors).toEqual([]);
});

test("the real camera: asked politely, opened, and the hand tracker looks for two fists", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  // A fake-camera Chrome may already allow the camera (the page explains first only when the browser will ask).
  const prime = page.locator("#prime");
  const check = page.locator("#check-title");
  await expect.poll(async () => (await prime.isVisible()) || (await check.isVisible()), { timeout: 20_000 }).toBe(true);
  if (await prime.isVisible()) await prime.getByRole("button", { name: "Continue" }).click();
  // The camera is a still picture of one hand: the check waits for two fists, with the camera in its picture.
  await expect(page.locator("#check-title")).toHaveText("Hold your fists up, like a wheel", { timeout: 90_000 });
  const picture = page.locator(".check-picture canvas");
  await expect(picture).toBeVisible();
  await expect
    .poll(
      () =>
        picture.evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          // The panel is flat dark grey until the camera's picture is drawn into it.
          const first = data[0]!;
          let different = 0;
          for (let i = 0; i < data.length; i += 4 * 97) if (Math.abs(data[i]! - first) > 24) different++;
          return different;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(20);
  await shot(page, info, "race-3b-check-camera", 300);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(heading(page, "Choose Your Driver")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the real camera with four players: eight hands, a tracker per column, and the camera's picture in the shared check", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // MediaPipe's own start-up notes (glog lines, one for each landmarker, and TensorFlow Lite's INFO line for each one
    // on the CPU, as players sharing a camera are read) are not the page's.
    if ((message.type() === "warning" || message.type() === "error") && !/^([WI]\d{4} |INFO: )/.test(message.text())) errors.push(message.text());
  });
  await returning(page);
  await page.addInitScript(() => localStorage.setItem("handy.kart.you.v1", JSON.stringify({ name: "Maya", drive: "wheel", players: 4 })));
  await open(page);
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("radiogroup", { name: "Players on This Camera" }).getByRole("radio", { name: "4", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  // The camera is a still picture of one hand: the check waits for four wheels, with the camera in its one shared picture.
  await expect(page.locator("#check-title")).toHaveText(/Hold it level|Hold your fists up/, { timeout: 90_000 });
  await expect(page.locator(".check-chip")).toHaveCount(4);
  const picture = page.locator(".check-shared canvas");
  await expect(picture).toBeVisible();
  await expect
    .poll(
      () =>
        picture.evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          const first = data[0]!;
          let different = 0;
          for (let i = 0; i < data.length; i += 4 * 97) if (Math.abs(data[i]! - first) > 24) different++;
          return different;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(20);
  await shot(page, info, "race-3i-check-four-camera", 500);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(heading(page, "Choose Your Driver")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("joining: a link with no race behind it says so, and a real room's guests see its lobby", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A code nobody has opened.
  await page.goto("/race.html?net=local&join=zzzz");
  const trouble = page.locator("#trouble");
  await expect(trouble).toContainText("There’s no race with that code. Check it and try again.");
  await shot(page, info, "race-7a-not-found", 400);
  await trouble.getByRole("button", { name: "Try Again" }).click();
  await expect(trouble).toBeHidden();
  const field = page.getByLabel("Race code");
  await expect(field).toHaveValue("ZZZZ");
  await expect(field).toBeFocused();

  // A room that exists: by its code, typed, and then the guest's lobby.
  const hostPage = await page.context().newPage();
  const code = await host(hostPage, "Maya");
  await field.fill(code.toLowerCase());
  await page.getByRole("button", { name: "Join a Race" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await expect(page.locator("#you-eyebrow")).toHaveText("Join a Race");
  await page.getByLabel("Name", { exact: true }).fill("Sam");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page);
  await expect(heading(page, /Maya.s Race/)).toBeVisible();
  await expect(page.locator("#lobby-code")).toHaveText(code);
  await expect(page.locator("#lobby-waiting")).toHaveText("Waiting for Maya to start.");
  await expect(page.locator("#lobby-players")).toContainText("Host");
  await expect(page.locator("#lobby-players")).toContainText("You");
  await expect(page.locator("#lobby-qr")).toBeHidden();
  await expect(start(page)).toBeHidden();
  // The race is the host's to set: the guest sees it, read-only.
  await expect(page.locator("#group-race")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Grand Prix" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Bots" })).toBeDisabled();
  await expect(page.locator("#foot-guest")).toHaveText("Maya sets the race.");
  await shot(page, info, "race-4b-lobby-guest", 400);
  // Show Me On: This Screen or the Big Screen.
  const bigScreen = page.getByRole("radio", { name: "Big Screen" });
  await expect(page.getByRole("radio", { name: "This Screen" })).toHaveAttribute("aria-checked", "true");
  await bigScreen.click();
  await expect(bigScreen).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#lobby-players")).toContainText("Big screen");
  await expect(hostPage.locator("#lobby-players")).toContainText("Big screen");
  await shot(page, info, "race-4c-lobby-guest-big", 300);

  // The host starts: this device has no viewport, so it is a controller (place, lap and item).
  await hostPage.getByRole("radio", { name: "1", exact: true }).click();
  await hostPage.getByRole("button", { name: "Start Race" }).click();
  await expect(page.locator("#controller")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("canvas.race-canvas")).toHaveCount(0);
  await expect(page.locator(".controller-card")).toContainText(/\d(st|nd|rd|th)/);
  await expect(page.locator(".controller-card")).toContainText("Lap 1/1");
  await expect(page.locator(".controller-item")).toBeVisible();
  await expect.poll(async () => (await state(page)).race?.phase).toBe("countdown");
  await expect(page.locator("#controller-banner")).toHaveText(/^(Ready|3|2|1)$/);
  await shot(page, info, "race-5e-controller", 200);
  // The pause sheet on a controller: it can only leave, and says the race goes on.
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-sheet")).toContainText("The race keeps going for everyone else.");
  await expect(page.getByRole("button", { name: "Restart" })).toBeHidden();
  await page.getByRole("button", { name: "Leave Race" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a guest who keeps the race on their own screen sees it there", async ({ page }) => {
  const hostPage = await page.context().newPage();
  const code = await host(hostPage, "Maya");
  await join(page, code, "Sam");
  await hostPage.getByRole("radio", { name: "1", exact: true }).click();
  await hostPage.getByRole("button", { name: "Start Race" }).click();
  await expect(page.locator("canvas.race-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#controller")).toBeHidden();
  // A guest cannot restart anyone's race, only leave it.
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-sheet")).toContainText("The race keeps going for everyone else.");
  await expect(page.getByRole("button", { name: "Restart" })).toBeHidden();
  await page.getByRole("button", { name: "Leave Race" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();
});

test("troubles say what happened and give the way back", async ({ page }, info) => {
  const trouble = page.locator("#trouble");
  const toWheel = async (extra: string) => {
    await open(page, extra);
    await page.getByRole("button", { name: "Practice" }).click();
    // (The keyboard may be remembered from before: back to the wheel.)
    await page.getByRole("radio", { name: "Wheel" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await chooseDrivers(page);
  };

  // A camera the browser refuses: try again, or drive with the keyboard.
  await toWheel("&fail=camera-denied");
  await expect(trouble).toContainText("Your browser is blocking the camera for this page.");
  await shot(page, info, "race-7d-camera", 400);
  await trouble.getByRole("button", { name: "Drive With Keyboard" }).click();
  await pastHowTo(page);
  await expect(heading(page, "Ready to Race")).toBeVisible();
  await expect(page.locator("#lobby-players")).toContainText("Keyboard");

  // A camera another app has, and no camera at all.
  await toWheel("&fail=camera-busy");
  await expect(trouble).toContainText("Your camera is being used by another app.");
  await trouble.getByRole("button", { name: "Drive With Keyboard" }).click();
  await toWheel("&fail=camera-missing");
  await expect(trouble).toContainText("Connect a camera");
  await shot(page, info, "race-7e-no-camera", 300);
  await trouble.getByRole("button", { name: "Try Again" }).click();
  await expect(trouble).toContainText("Connect a camera");
  await trouble.getByRole("button", { name: "Drive With Keyboard" }).click();

  // The hand tracker that does not arrive.
  await toWheel("&fail=model");
  await expect(trouble).toContainText("The part that sees your hands didn’t arrive.");
  await shot(page, info, "race-7f-model", 300);
  await trouble.getByRole("button", { name: "Drive With Keyboard" }).click();

  // A page that cannot draw the race (the keyboard is remembered now).
  await open(page, "&fail=webgl");
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page);
  await start(page).click();
  await expect(trouble).toContainText("Your browser can’t draw 3D graphics right now.");
  await shot(page, info, "race-7g-webgl", 300);
  await trouble.getByRole("button", { name: "Leave Race" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();
});

test("sound: off by the arcade's preference, on with the speaker; music on the menus, engines and the race's tune in a race", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sound = async () => (await state(page)).sound;
  // With the preference off nothing is made: not the engine, not the music.
  await open(page);
  await page.getByRole("button", { name: "Practice" }).click();
  expect(await sound()).toMatchObject({ awake: false, muted: true, music: null });
  await expect(page.locator("#sound-button")).toHaveAttribute("aria-pressed", "true");

  // The speaker turns it on (the same preference the arcade keeps), and the menus have their tune.
  await page.locator("#sound-button").click();
  await expect(page.locator("#sound-button")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("handy.muted.v1"))).toBe("false");
  await expect.poll(async () => (await sound()).awake, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await sound()).music, { timeout: 90_000 }).toBe("menu");
  await shot(page, info, "race-8a-sound-corner", 200);

  // M does the same from the keyboard, anywhere.
  await page.keyboard.press("m");
  await expect(page.locator("#sound-button")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("m");
  await expect(page.locator("#sound-button")).toHaveAttribute("aria-pressed", "false");

  // A race: the engine runs, and at Go the track's own tune.
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page);
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await start(page).click();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await sound()).engines, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe("racing");
  await expect.poll(async () => (await sound()).music, { timeout: 90_000 }).toBe("meadow");

  // The pause sheet: the engines are still, and the sliders are there.
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await sound()).paused).toBe(true);
  await expect(page.locator("#pause-music")).toBeEnabled();
  await page.locator("#pause-music").fill("40");
  await page.locator("#pause-effects").fill("70");
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("handy.kart.sound.v1"))) ?? "null")).toEqual({ music: 0.4, effects: 0.7 });
  await shot(page, info, "race-8b-sound-sheet", 300);
  await page.locator("#sheet-sound").click();
  await expect(page.locator("#pause-music")).toBeDisabled();
  await expect(page.locator("#sheet-sound")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#sheet-sound").click();
  await expect(page.locator("#pause-music")).toBeEnabled();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await sound()).paused, { timeout: 10_000 }).toBe(false);

  // The tab put away: no frames come to say so, so the engines are stilled at once rather than humming on behind other tabs.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await sound()).paused).toBe(true);
  // Back again: practice waited behind its sheet, and Resume brings the sound back.
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await sound()).paused, { timeout: 10_000 }).toBe(false);
  expect(errors).toEqual([]);
});

test("a gamepad alone gets from the start screen into a race, with the focus ring showing, and its Start pauses", async ({ page }, info) => {
  // The sofa and the TV: the pad's path through the menus is a desktop's layout.
  test.skip(info.project.name === "kart-phone", "a pad on a phone held upright is not the case");
  // Headless Chrome has no pad: a stand-in the page reads as the first one connected.
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: "stand-in", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    navigator.getGamepads = () => [pad as unknown as Gamepad, null, null, null];
    (window as unknown as { pad: typeof pad }).pad = pad;
  });
  const BUTTON = { a: 0, b: 1, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;
  const press = async (name: keyof typeof BUTTON) => {
    const set = (down: boolean) =>
      page.evaluate(([i, on]) => ((window as unknown as { pad: { buttons: object[] } }).pad.buttons[i as number] = { pressed: on, touched: on, value: on ? 1 : 0 }), [BUTTON[name], down] as const);
    await set(true);
    await page.waitForTimeout(150);
    await set(false);
    await page.waitForTimeout(150);
  };
  /** The focused element's id or value, and whether its ring shows. */
  const focused = () =>
    page.evaluate(() => {
      const at = document.activeElement as HTMLElement | null;
      return { name: at?.id || at?.dataset.value || "", ring: at?.matches(":focus-visible") ?? false };
    });
  /** Presses one way until the focus is on `name`, as a player would watch the ring. */
  const reach = async (name: string, key: keyof typeof BUTTON) => {
    for (let i = 0; i < 8 && (await focused()).name !== name; i++) await press(key);
    expect((await focused()).name).toBe(name);
  };
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));

  // The first press puts the focus on the screen's main button, ringed; down walks the menu in order.
  await press("down");
  expect(await focused()).toEqual({ name: "start-host", ring: true });
  await press("down");
  expect((await focused()).name).toBe("join-code");
  await press("down");
  expect((await focused()).name).toBe("start-practice");
  await press("a");
  await expect(heading(page, /Driving/)).toBeVisible();
  // B goes back from You (it loses nothing), and A comes in again.
  await press("b");
  await expect(heading(page, "Grip Prix")).toBeVisible();
  await press("down");
  await reach("start-practice", "down");
  await press("a");
  await expect(heading(page, /Driving/)).toBeVisible();

  // You: up from Continue to the ways to drive, along to the gamepad, chosen with A, and down to Continue.
  await press("down");
  expect((await focused()).name).toBe("you-continue");
  await reach("gamepad", "up");
  await press("a");
  await expect(page.getByRole("radio", { name: /Gamepad/ })).toHaveAttribute("aria-checked", "true");
  await reach("you-continue", "down");
  await press("a");
  // The driver stage reads the pad itself: A goes on.
  await expect(heading(page, "Choose Your Driver")).toBeVisible();
  await press("a");
  // How to Drive: the first press lands on Continue, A goes on.
  await expect(heading(page, "How to Drive")).toBeVisible();
  await press("down");
  expect((await focused()).name).toBe("howto-continue");
  await press("a");
  await expect(heading(page, "Ready to Race")).toBeVisible();
  await expect(page.locator("#lobby-players")).toContainText("Gamepad");

  // The lobby: the first press is on Start, A starts.
  await press("down");
  expect(await focused()).toEqual({ name: "lobby-start", ring: true });
  await press("a");
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe("racing");

  // Start opens the pause sheet on Resume; down reaches Leave Race; B resumes; Start twice is open and shut.
  const sheet = page.locator("#pause-sheet");
  await press("start");
  await expect(sheet).toBeVisible();
  expect(await focused()).toEqual({ name: "pause-resume", ring: true });
  await reach("pause-leave", "down");
  await press("b");
  await expect(sheet).toBeHidden();
  await press("start");
  await expect(sheet).toBeVisible();
  await press("start");
  await expect(sheet).toBeHidden();
});

test("leaving puts everything down and starts again", async ({ page }) => {
  await practiceToLobby(page);
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();
  await expect(page.getByRole("button", { name: "Practice" })).toBeEnabled();
  // The name is remembered across visits.
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Otto");
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Otto");
});
