// Grip Prix's finish-line photos on the real page: a wheel player's camera (Chrome's fake one, its still picture of a
// hand: ?camera=real behind the scripted hands that steer) is photographed as their kart crosses the line, and the
// photo is on the results with their place and time, and Share makes one picture of it; two on one camera each get their
// own half of the picture, the better placed the bigger; and in a room a guest's photo, taken on their device, comes to
// the host's big screen. Muted, like every test here.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { shot } from "./helpers";
import { chooseDrivers, host, KeyboardDriver, onScreen, open, pastHowTo, state, WheelDrivers } from "./kart";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
      // A returning wheel player: the check asks only for the level.
      localStorage.setItem("handy.kart.checked.v1", "true");
      localStorage.setItem("handy.camera-opened.v1", "true");
    } catch {
      // no storage: the page decides
    }
  });
});

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name });

/** A photo card's picture: decoded, its shape, and how much it varies (a flat colour is no photo of a camera). */
async function picture(card: Locator): Promise<{ src: string; aspect: number; spread: number }> {
  return card.locator("img.shot-photo").evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let low = 255;
    let high = 0;
    for (let i = 0; i < data.length; i += 4 * 53) {
      const grey = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      low = Math.min(low, grey);
      high = Math.max(high, grey);
    }
    return { src: img.src, aspect: img.naturalWidth / img.naturalHeight, spread: high - low };
  });
}

/** How many sampled pixels of a card's effects canvas have something drawn on them. */
async function painted(card: Locator): Promise<number> {
  return card.locator("canvas.shot-fx").evaluate(async (canvas: HTMLCanvasElement) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4 * 7) if (data[i]! > 0) count++;
    return count;
  });
}

/**
 * Share, on a browser with no share sheet (as headless Chrome may or may not have one, the test takes it away): the
 * picture is saved as a download, and the toast says so. Returns the picture's file name and size.
 */
async function shareSaved(page: Page): Promise<{ name: string; size: [number, number] }> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    const make = URL.createObjectURL.bind(URL);
    const keep = window as unknown as { shared: Blob | null };
    keep.shared = null;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob) keep.shared = blob;
      return make(blob);
    };
  });
  const share = page.getByRole("button", { name: "Share" });
  await expect(share).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), share.click()]);
  await expect(page.locator("#toast")).toHaveText("Saved to your Downloads.");
  const size = await page.evaluate(async () => {
    const picture = await createImageBitmap((window as unknown as { shared: Blob }).shared);
    return [picture.width, picture.height] as [number, number];
  });
  return { name: download.suggestedFilename(), size };
}

/** Practice on the scripted wheel with the real (fake) camera behind it, `players` on it, down to the lobby, one lap. */
async function practiceOnTheWheel(page: Page, players: 1 | 2): Promise<void> {
  await open(page, "&input=script&camera=real");
  if (players === 2) {
    await page.evaluate(() =>
      window.gripTest!.wheel([
        { angle: 0, centre: [0.25, 0.45], span: 0.3 },
        { angle: 0, centre: [0.75, 0.45], span: 0.3 },
      ]),
    );
  }
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(heading(page, /Driving/)).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Maya");
  if (players === 2) {
    await page.getByRole("radiogroup", { name: "Players on This Camera" }).getByRole("radio", { name: "2", exact: true }).click();
    await page.getByLabel("Second Driver").fill("Finn");
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await pastHowTo(page, 60_000);
  await expect(heading(page, "Ready to Race")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("radio", { name: "1", exact: true }).click();
}

test("a wheel player's photo is taken at the line and shown on the results with their place and time", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await practiceOnTheWheel(page, 1);
  await page.getByRole("button", { name: "Start Race" }).click();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  // The corner picture is the camera's: the photo will be too.
  await expect(page.locator(".corner-preview canvas")).toBeVisible();
  const drivers = new WheelDrivers(page, 1).start();
  await onScreen(page, "results", 170_000);
  await drivers.stop();

  const photos = page.locator("#finish-photos");
  await expect(photos).toBeVisible();
  const card = photos.locator(".shot");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveClass(/has-photo/);
  // Their place, name and time, as the table has them.
  const row = page.locator("#standings-body tr.mine");
  await expect(card.locator(".medal")).toHaveText((await row.locator(".medal").textContent())!);
  await expect(card.locator(".shot-who")).toHaveText("Maya");
  await expect(card.locator(".shot-time")).toHaveText((await row.locator(".c-time").textContent())!);
  await expect(card.locator("img.shot-photo")).toHaveAttribute("alt", "Maya at the finish line");
  // A small JPEG of the camera's picture, mirrored and cut to 3:4 (the fake camera's picture is 2:3).
  const photo = await picture(card);
  expect(photo.src.startsWith("data:image/jpeg;base64,")).toBe(true);
  expect(photo.src.length).toBeLessThan(48_000);
  expect(photo.aspect).toBeCloseTo(3 / 4, 1);
  expect(photo.spread).toBeGreaterThan(40);
  // The track's look on it: a stamp with the track and the place, the winner's effects canvas drawing something.
  await expect(card).toHaveAttribute("data-look", /.+/);
  await expect(card.locator(".shot-stamp")).toHaveText(/ · /);
  await expect(card.locator("canvas.shot-fx")).toBeVisible();
  expect(await painted(card)).toBeGreaterThan(30);
  // Beside the table on a wide screen, inside the window.
  const box = (await photos.boundingBox())!;
  const table = (await page.locator("#results-card").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(table.x);
  await shot(page, info, "photo-1-results", 1600);
  // Share: one picture of the photos with the place and time on them, Grip Prix's, the size link previews use.
  const shared = await shareSaved(page);
  expect(shared.name).toMatch(/^nintenthropic-grip-prix-[a-z0-9-]+\.png$/);
  expect(shared.size).toEqual([1200, 630]);
  expect(errors).toEqual([]);
});

test("two on one camera: each their own half of the picture", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await practiceOnTheWheel(page, 2);
  await page.getByRole("button", { name: "Start Race" }).click();
  await expect(page.locator("#race-loading")).toBeHidden({ timeout: 30_000 });
  const drivers = new WheelDrivers(page, 2).start();
  await onScreen(page, "results", 170_000);
  await drivers.stop();

  const cards = page.locator("#finish-photos .shot");
  await expect(cards).toHaveCount(2);
  await expect(page.locator("#finish-photos .shot.has-photo")).toHaveCount(2);
  const names = await cards.locator(".shot-who").allTextContents();
  expect(names.sort()).toEqual(["Finn", "Maya"]);
  const [a, b] = [await picture(cards.nth(0)), await picture(cards.nth(1))];
  // Each a column of the 2:3 picture (1:3), cut to 3:4: two different pictures.
  for (const photo of [a, b]) {
    expect(photo.aspect).toBeCloseTo(3 / 4, 1);
    expect(photo.spread).toBeGreaterThan(20);
  }
  expect(a.src).not.toBe(b.src);
  // The better placed leads, the bigger: these tall photos side by side, the other beside it.
  await expect(cards.first()).toHaveClass(/lead/);
  const [lead, other] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
  expect(lead.height).toBeGreaterThan(other.height * 1.3);
  expect(other.x).toBeGreaterThanOrEqual(lead.x + lead.width);
  await shot(page, info, "photo-2-results-two", 1600);
  expect(errors).toEqual([]);
});

test("in a room, a guest's photo comes to the host's big screen; a keyboard player has their driver instead", async ({ page }, info) => {
  const errors: string[] = [];
  const gus = await page.context().newPage();
  for (const [who, p] of [["host", page], ["gus", gus]] as const) p.on("pageerror", (error) => errors.push(`${who}: ${error.message}`));

  const code = await host(page, "Hana");
  // Gus drives with his hands, his phone only his wheel: his race is on the host's screen.
  await open(gus, "&input=script&camera=real");
  await gus.getByLabel("Race code").fill(code);
  await gus.getByRole("button", { name: "Join a Race" }).click();
  await expect(heading(gus, /Driving/)).toBeVisible();
  await gus.getByLabel("Name", { exact: true }).fill("Gus");
  await gus.getByRole("radio", { name: "Wheel" }).click();
  await gus.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(gus);
  await pastHowTo(gus, 60_000);
  await expect(gus.locator("#lobby-waiting")).toBeVisible({ timeout: 20_000 });
  await gus.getByRole("radio", { name: "Big Screen" }).click();
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start Race" })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "Start Race" }).click();
  await onScreen(page, "race");
  await onScreen(gus, "race");
  await expect(gus.locator("#controller")).toBeVisible({ timeout: 30_000 });
  const hana = new KeyboardDriver(page).start();
  const wheel = new WheelDrivers(gus, 1).start();
  await onScreen(page, "results", 170_000);
  await hana.stop();
  await wheel.stop();

  // On the big screen: Gus's photo, sent from his device once the race was decided, and Hana's driver in her colour.
  const cards = page.locator("#finish-photos .shot");
  await expect(cards).toHaveCount(2);
  const gusCard = cards.filter({ hasText: "Gus" });
  await expect(gusCard).toHaveClass(/has-photo/, { timeout: 15_000 });
  const photo = await picture(gusCard);
  expect(photo.src.startsWith("data:image/jpeg;base64,")).toBe(true);
  expect(photo.spread).toBeGreaterThan(40);
  const hanaCard = cards.filter({ hasText: "Hana" });
  await expect(hanaCard).not.toHaveClass(/has-photo/);
  await expect(hanaCard.locator(".shot-stand-in")).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  await shot(page, info, "photo-3-room-host", 1600);
  // Gus's own device has it too, the same picture.
  await onScreen(gus, "results", 30_000);
  await expect(gus.locator("#finish-photos .shot.has-photo")).toHaveCount(1);
  expect((await picture(gus.locator("#finish-photos .shot.has-photo"))).src).toBe(photo.src);
  expect((await state(page)).screen).toBe("results");
  expect(errors).toEqual([]);
});

/** The results of a made-up race of four on `track`, each with a photo (a picture from the page itself), put up by hand. */
async function previewResults(page: Page, track: string): Promise<void> {
  await page.evaluate(async (track) => {
    const source = await createImageBitmap(await (await fetch("assets/kart/title.webp")).blob());
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 400;
    const side = source.height;
    canvas.getContext("2d")!.drawImage(source, (source.width - side * 0.75) / 2, 0, side * 0.75, side, 0, 0, 300, 400);
    const photo = canvas.toDataURL("image/jpeg", 0.85);
    const names = ["Maya", "Finn", "Gus", "Hana"];
    const colours = ["#ff5f5f", "#5fa8ff", "#8be36a", "#ffd60a"];
    window.gripTest!.preview(
      "results",
      {
        code: null,
        host: "preview",
        players: names.map((name, slot) => ({ slot, name, colour: colours[slot]!, device: "preview", screen: "preview", control: "wheel" as const, ready: true })),
        settings: { track, laps: 3, bots: false, racers: 4 },
        phase: "results",
        result: { standings: names.map((name, kart) => ({ kart, place: kart + 1, time: 62.3 + kart * 3.1, bestLap: 20.1 + kart, name, colour: colours[kart] })) },
        karts: { 0: 0, 1: 1, 2: 2, 3: 3 },
        race: Math.floor(Math.random() * 1e6),
      },
      { 0: photo, 1: photo, 2: photo, 3: photo },
    );
  }, track);
}

const TRACK_IDS = ["meadow-loop", "kitchen-rally", "harbour-lights", "canyon-run", "fun-fair", "glacier-pass", "volcano-rush", "starlight-ribbon", "five-finger-circuit"];

test("every track gives the photos its own look, and the place its own flourish", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await host(page, "Hana");
  for (const track of TRACK_IDS) {
    await previewResults(page, track);
    const cards = page.locator("#finish-photos .shot");
    await expect(cards).toHaveCount(4);
    await expect(page.locator("#finish-photos .shot.has-photo")).toHaveCount(4);
    for (const card of await cards.all()) await expect(card).toHaveAttribute("data-look", track);
    // The stamp names the track and each place.
    await expect(cards.first().locator(".shot-stamp")).toHaveText(/ · 1st$/i);
    expect(await painted(cards.first())).toBeGreaterThan(30);
    await shot(page, info, `photo-look-${track}`, 300);
  }
  expect(errors).toEqual([]);
});

test("with Reduce Motion the effects show one frame, still, and a clip is offered only where the browser can record one", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await host(page, "Hana");
  await previewResults(page, "harbour-lights");
  const card = page.locator("#finish-photos .shot").first();
  await expect(card.locator("canvas.shot-fx")).toBeVisible();
  const frame = () => card.locator("canvas.shot-fx").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(800);
  const first = await frame();
  await page.waitForTimeout(700);
  expect(await frame()).toBe(first);
  expect(first.length).toBeGreaterThan(2000);
  const clip = page.getByRole("button", { name: "Share Clip" });
  const can = await page.evaluate(() => typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function");
  if (can) await expect(clip).toBeVisible();
  else await expect(clip).toBeHidden();
});
