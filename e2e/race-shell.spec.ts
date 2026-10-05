// Grip Prix's screens (race.html), run against the stand-ins in
// src/kart/app/fakes.ts until the real net, input and render parts are wired
// in: start, you, the wheel check, the lobby, the race, the results, the
// troubles. The fake wheel is the keyboard (arrows turn, Down opens the
// hands, H takes them away), the fake room runs a race round a circle.
// Photographed at the two sizes the design must hold at (desktop and phone).
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers";

/** A returning player: the wheel check done once, the camera already opened. */
const returning = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem("handy.kart.checked.v1", "true");
    localStorage.setItem("handy.camera-opened.v1", "true");
  });
};

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name });
const start = (page: Page) => page.getByRole("button", { name: "Start Race" });

/** Practice with the keyboard, down to the lobby. */
async function practiceToLobby(page: Page, laps = 1) {
  await page.goto("/race.html");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "Ready to Race")).toBeVisible();
  await page.getByRole("radio", { name: String(laps), exact: true }).click();
}

test("the start screen: the title, three ways in, a code field that tidies what is typed", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/race.html");
  await expect(heading(page, "Grip Prix")).toBeVisible();
  await expect(page.getByText("Grip the wheel. Race your friends.")).toBeVisible();
  for (const name of ["Host a Race", "Practice"]) await expect(page.getByRole("button", { name })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Handy" })).toHaveAttribute("href", "index.html#grip-prix");
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

test("practice with the keyboard: you, the lobby, the race, the results, and round again", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/race.html");
  await page.getByRole("button", { name: "Practice" }).click();

  // You: a friendly name already there, remembered, the wheel by default.
  await expect(heading(page, /Driving/)).toBeVisible();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).not.toHaveValue("");
  await expect(page.getByRole("radio", { name: "Wheel" })).toHaveAttribute("aria-checked", "true");
  await shot(page, info, "race-2-you", 500);
  await name.fill("Maya");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  // Keys and pads have no steering to set and no second player.
  await expect(page.getByText("Steering", { exact: true })).toBeHidden();
  await expect(page.getByRole("switch", { name: "Two on This Camera" })).toBeHidden();
  await shot(page, info, "race-2b-you-keyboard", 300);
  await page.getByRole("button", { name: "Continue" }).click();

  // The lobby for practice: no code, the players, the race to set.
  await expect(heading(page, "Ready to Race")).toBeVisible();
  await expect(page.locator("#lobby-code")).toBeHidden();
  await expect(page.locator("#lobby-players")).toContainText("Maya");
  await expect(page.locator("#lobby-players")).toContainText("Keyboard");
  await shot(page, info, "race-4-lobby-practice", 500);
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await expect(page.getByRole("radio", { name: "1", exact: true })).toHaveAttribute("aria-checked", "true");
  await start(page).click();

  // The race: the canvas, the pause control, the place; the countdown first.
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator("#race-loading")).toBeHidden();
  await expect(page.locator("#screen-race")).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, info, "race-5-countdown", 100);
  await page.keyboard.down("ArrowUp");
  await expect(page.locator(".fake-hud-top")).toContainText("Lap 1/1", { timeout: 15_000 });
  await page.keyboard.down("ArrowRight");
  await shot(page, info, "race-5b-race", 700);
  await page.keyboard.up("ArrowRight");

  // The results: six karts, one of them ours.
  await expect(page.locator("#screen-results")).toBeVisible({ timeout: 60_000 });
  await page.keyboard.up("ArrowUp");
  await expect(page.locator("#standings-body tr")).toHaveCount(6);
  await expect(page.locator("#standings-body tr.mine")).toHaveCount(1);
  await expect(page.locator("#standings-body tr.mine")).toContainText("Maya");
  await expect(page.locator("#standings-body tr").first()).toContainText("1st");
  await expect(page.locator("#results-eyebrow")).toHaveText("Meadow Loop · 1 lap");
  await shot(page, info, "race-6-results", 700);

  // Race Again goes straight off, Back to Lobby comes back to the lobby.
  await page.getByRole("button", { name: "Race Again" }).click();
  await expect(page.locator("#screen-race")).toBeVisible();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Leave Race" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();
  expect(errors).toEqual([]);
});

test("pausing: Escape and the button open a sheet; practice waits, Resume carries on", async ({ page }, info) => {
  await practiceToLobby(page);
  await start(page).click();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator("#race-loading")).toBeHidden();
  await page.keyboard.press("Escape");
  const sheet = page.locator("#pause-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("The race waits for you.");
  // Practice is the host's own: it can restart.
  await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
  await shot(page, info, "race-5d-pause", 500);
  const before = await page.locator(".fake-hud-top").textContent();
  await page.waitForTimeout(1200);
  expect(await page.locator(".fake-hud-top").textContent()).toBe(before);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(sheet).toBeHidden();
  // The pause button does the same as Escape.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Restart begins the race afresh.
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator(".fake-hud-centre")).toHaveText(/Ready|3|2|1/);
});

test("hosting with the wheel: the check, the code and its QR code, the race, and Show Both Hands", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/race.html?net=local");
  await page.getByRole("button", { name: "Host a Race" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await expect(page.locator("#you-eyebrow")).toHaveText("Host a Race");
  // The wheel is the default, with its steering and a second player on offer.
  await expect(page.getByRole("radio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Quick" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Before the browser asks for the camera, we say why.
  await expect(page.locator("#prime")).toBeVisible();
  await expect(page.locator("#prime")).toContainText("The picture stays on this device.");
  await shot(page, info, "race-3a-prime", 400);
  await page.locator("#prime").getByRole("button", { name: "Continue" }).click();

  // The wheel check, one idea at a time.
  const title = page.locator("#check-title");
  await expect(title).toHaveText("Hold your fists up, like a wheel");
  await shot(page, info, "race-3b-check-fists", 200);
  await expect(title).toHaveText("Hold it level", { timeout: 5_000 });
  await expect(page.locator(".check-picture")).toHaveAttribute("data-step", "level");
  await shot(page, info, "race-3c-check-level", 500);
  await expect(title).toHaveText("Turn it", { timeout: 5_000 });
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowLeft");
  await expect(page.locator("#check-detail")).toHaveText("Now the other way.");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowRight");
  await expect(title).toHaveText("Open your hands to brake");
  await shot(page, info, "race-3d-check-brake", 200);
  await page.keyboard.down("ArrowDown");
  await expect(title).toHaveText("Ready");
  await page.keyboard.up("ArrowDown");
  await shot(page, info, "race-3e-check-ready", 300);

  // The lobby: the code large, a QR code of the join address, the players.
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
  // ?net=local reached the room-maker.
  expect(await page.evaluate(() => window.__fakeSessionOptions)).toEqual({ how: "host", options: { net: "local" } });
  // Who is here: us (ready, on this screen), and a friend who joins.
  await expect(page.locator("#lobby-players")).toContainText("You");
  await expect(page.locator("#lobby-players .row")).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator("#lobby-players")).toContainText("Sam");
  await expect(page.locator("#lobby-players")).toContainText("This screen");
  await shot(page, info, "race-4-lobby-host", 400);
  // The race to set: laps and bots.
  await page.getByRole("radio", { name: "2", exact: true }).click();
  await page.getByRole("switch", { name: "Bots" }).click();
  await expect(page.locator("#foot-bots")).toHaveText("Only the players race.");
  await page.getByRole("switch", { name: "Bots" }).click();
  await expect(start(page)).toBeEnabled();
  await start(page).click();

  // The race: the wheel's picture in the corner, and Show Both Hands when the hands go.
  await expect(page.locator("canvas.race-canvas")).toBeVisible();
  await expect(page.locator(".corner-preview")).toHaveCount(1);
  await expect(page.locator("#lost-hands")).toBeHidden();
  await page.keyboard.down("KeyH");
  await expect(page.locator("#lost-hands")).toBeVisible();
  await expect(page.locator("#lost-hands")).toHaveText("Show Both Hands");
  await shot(page, info, "race-5c-lost-hands", 200);
  await page.keyboard.up("KeyH");
  await expect(page.locator("#lost-hands")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a returning wheel player is asked only to hold it level", async ({ page }, info) => {
  await returning(page);
  await page.goto("/race.html");
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // No prime for a camera that has opened here before; only the level.
  await expect(page.locator("#screen-check")).toBeVisible();
  await expect(page.locator("#check-title")).toHaveText("Hold it level");
  await expect(page.locator("#check-steps")).toBeHidden();
  await shot(page, info, "race-3f-check-returning", 300);
  await expect(page.locator("#check-title")).toHaveText("Ready", { timeout: 5_000 });
  await expect(heading(page, "Ready to Race")).toBeVisible({ timeout: 10_000 });
});

test("two on one camera: a second name, and each checked in their own picture", async ({ page }, info) => {
  await returning(page);
  await page.goto("/race.html");
  await page.getByRole("button", { name: "Practice" }).click();
  const second = page.getByRole("switch", { name: "Two on This Camera" });
  await second.click();
  await expect(second).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Second Driver").fill("Finn");
  await shot(page, info, "race-2c-you-two", 400);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".check-picture")).toHaveCount(2);
  await expect(page.locator(".check-name").nth(1)).toHaveText("Finn");
  await shot(page, info, "race-3g-check-two", 400);
  await expect(heading(page, "Ready to Race")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#lobby-players .row")).toHaveCount(2);
  await expect(page.locator("#lobby-players")).toContainText("Finn");
  // Both wheels race: a corner picture each.
  await start(page).click();
  await expect(page.locator(".corner-preview")).toHaveCount(2);
});

test("joining: by code, straight in from a link, and what a guest sees", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // By code, typed.
  await page.goto("/race.html");
  await page.getByLabel("Race code").fill("krtz");
  await page.getByRole("button", { name: "Join a Race" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await expect(page.locator("#you-eyebrow")).toHaveText("Join a Race");

  // From a link (a scanned QR code), straight to joining.
  await page.goto("/race.html?join=krtz");
  await expect(heading(page, /Driving/)).toBeVisible();
  await expect(page.locator("#you-eyebrow")).toHaveText("Join a Race");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // A guest's lobby: the code, who is here, and waiting for the host.
  await expect(heading(page, /Maya.s Race/)).toBeVisible();
  await expect(page.locator("#lobby-code")).toHaveText("KRTZ");
  await expect(page.locator("#lobby-waiting")).toHaveText("Waiting for Maya to start.");
  await expect(page.locator("#lobby-players")).toContainText("Host");
  await expect(page.locator("#lobby-players")).toContainText("You");
  await expect(page.locator("#lobby-qr")).toBeHidden();
  await expect(start(page)).toBeHidden();
  await expect(page.locator("#group-race")).toBeHidden();
  await shot(page, info, "race-4b-lobby-guest", 400);
  // Show Me On: This Screen or the Big Screen.
  const bigScreen = page.getByRole("radio", { name: "Big Screen" });
  await expect(page.getByRole("radio", { name: "This Screen" })).toHaveAttribute("aria-checked", "true");
  await bigScreen.click();
  await expect(bigScreen).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#lobby-players")).toContainText("Big screen");
  await shot(page, info, "race-4c-lobby-guest-big", 300);

  // The host starts: this device has no viewport, so it is a controller (place and lap).
  await expect(page.locator("#controller")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("canvas.race-canvas")).toHaveCount(0);
  await expect(page.locator(".controller-card")).toContainText(/\d(st|nd|rd|th)/);
  await expect(page.locator(".controller-card")).toContainText("Lap 1/3");
  await shot(page, info, "race-5e-controller", 500);
  expect(errors).toEqual([]);
});

test("a guest who keeps the race on their own screen sees it there", async ({ page }) => {
  await page.goto("/race.html?join=KRTZ");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#lobby-waiting")).toBeVisible();
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
  // A code with no race.
  await page.goto("/race.html?join=zzzz");
  const trouble = page.locator("#trouble");
  await expect(trouble).toBeVisible();
  await expect(trouble).toContainText("There’s no race with that code. Check it and try again.");
  await shot(page, info, "race-7a-not-found", 400);
  await trouble.getByRole("button", { name: "Try Again" }).click();
  await expect(trouble).toBeHidden();
  const field = page.getByLabel("Race code");
  await expect(field).toHaveValue("ZZZZ");
  await expect(field).toBeFocused();

  // A race that is full.
  await field.fill("FULL");
  await page.getByRole("button", { name: "Join a Race" }).click();
  await expect(trouble).toContainText("This race is full.");
  await shot(page, info, "race-7b-full", 400);
  await trouble.getByRole("button", { name: "Back to Start" }).click();
  await expect(trouble).toBeHidden();
  await expect(page.getByRole("button", { name: "Host a Race" })).toBeVisible();

  // A host who leaves.
  await page.goto("/race.html?join=LEFT");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(trouble).toContainText("The host left the race.", { timeout: 10_000 });
  await shot(page, info, "race-7c-host-left", 300);
  await trouble.getByRole("button", { name: "Back to Start" }).click();
  await expect(heading(page, "Grip Prix")).toBeVisible();

  // A connection that drops.
  await page.goto("/race.html?join=DROP");
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(trouble).toContainText("Lost the connection to the race.", { timeout: 10_000 });
  await trouble.getByRole("button", { name: "Back to Start" }).click();

  // A camera the browser refuses: try again, or drive with the keyboard.
  await page.goto("/race.html?fail=camera");
  await page.getByRole("button", { name: "Practice" }).click();
  // (The keyboard was chosen above and is remembered: back to the wheel.)
  await page.getByRole("radio", { name: "Wheel" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(trouble).toContainText("Your browser is blocking the camera for this page.");
  await shot(page, info, "race-7d-camera", 400);
  await trouble.getByRole("button", { name: "Drive With Keyboard" }).click();
  await expect(heading(page, "Ready to Race")).toBeVisible();
  await expect(page.locator("#lobby-players")).toContainText("Keyboard");
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
  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Otto");
});
