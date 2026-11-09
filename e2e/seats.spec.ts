// Two players on one camera, with real hands read by the real tracker: Chrome's fake camera plays a video with a
// hand in some columns of the picture (e2e/seatsFixture.ts, or clips of real hands made by tools/seats/clips.sh
// when SEATS_CLIPS names their folder) and the wheel check must show each seat only its own column's hands. A seat
// whose column is empty must see no hand at all: a phantom hand in an empty seat (what Safari's ignored VideoFrame
// cut once made, see src/tracking/cut.ts) ticked its wheel green on a blank wall. Muted, like every test.
import { chromium, expect, test, type Page } from "@playwright/test";
import { SEATS_CAMERAS, seatsFixture, type SeatsCamera } from "./seatsFixture";
import { chooseDrivers, onScreen, open, state } from "./kart";

/** Where clips of real hands are kept (never in the repository), or "" for none: alone-left.y4m, alone-right.y4m, pair.y4m. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const CLIPS = env.SEATS_CLIPS ?? "";

/** A page whose fake camera plays this video (the video is a launch switch, so each camera has a browser of its own). */
async function withCamera(video: string, baseURL: string, use: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`, "--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
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
    await use(await context.newPage());
  } finally {
    await browser.close();
  }
}

/** The practice flow for two on this camera, up to the wheel check. */
async function toTheCheck(page: Page, cut: "auto" | "worker"): Promise<void> {
  await open(page, cut === "worker" ? "&cut=worker" : "");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("heading", { name: /Driving/ })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Tilly");
  await page.getByRole("radiogroup", { name: "Players on This Camera" }).getByRole("radio", { name: "2", exact: true }).click();
  await page.getByLabel("Second Driver").fill("Finn");
  await page.getByRole("button", { name: "Continue" }).click();
  await chooseDrivers(page);
  await onScreen(page, "check", 90_000);
}

/** What each seat's wheel saw over `ms`: the most hands, and where they were (the mirrored picture's x). */
async function watch(page: Page, ms: number): Promise<{ most: number[]; xs: number[][] }> {
  const most = [0, 0];
  const xs: number[][] = [[], []];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { wheels } = await state(page);
    wheels.forEach((wheel, seat) => {
      most[seat] = Math.max(most[seat]!, wheel.hands);
      for (const hand of [wheel.left, wheel.right]) if (hand) xs[seat]!.push(hand.x);
    });
    await page.waitForTimeout(100);
  }
  return { most, xs };
}

/** Hands in each seat: a player holds one hand up (the pictures hold one hand a player), or two with real clips. */
const cases: { camera: SeatsCamera; seats: [boolean, boolean] }[] = [
  // The player sees the picture mirrored, so the camera's right column is the first seat's.
  { camera: "alone-right", seats: [true, false] },
  { camera: "alone-left", seats: [false, true] },
  { camera: "pair", seats: [true, true] },
];

// Chrome cuts each column out of the frame as the page asks; `worker` makes the workers cut it themselves, the path Safari
// takes (it ignores the page's cut), so both are driven here.
for (const real of CLIPS ? [false, true] : [false]) {
  for (const cut of ["auto", "worker"] as const) {
    for (const { camera, seats } of cases) {
      const what = SEATS_CAMERAS[camera].map((on) => (on ? "a player" : "an empty seat")).join(" and ");
      test(`${real ? "real hands, " : ""}${cut === "worker" ? "columns cut in the workers, " : ""}${what} on the camera: each seat's wheel sees only its own column`, async ({ baseURL }) => {
        await withCamera(real ? `${CLIPS}/${camera}.y4m` : seatsFixture(camera), baseURL!, async (page) => {
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await toTheCheck(page, cut);
          // Let the tracker settle, then watch for several seconds.
          await expect.poll(async () => (await state(page)).wheels.some((wheel) => wheel.hands > 0), { timeout: 60_000 }).toBe(true);
          const seen = await watch(page, 8_000);
          seats.forEach((player, seat) => {
            if (!player) expect(seen.most[seat], `seat ${seat} saw a hand in an empty column`).toBe(0);
            else expect(seen.most[seat], `seat ${seat} saw its player's hand`).toBeGreaterThanOrEqual(1);
          });
          // Every hand a seat saw is in its own half of the mirrored picture.
          seen.xs.forEach((xs, seat) => {
            for (const x of xs) {
              expect(x, `seat ${seat}'s hand at ${x}`).toBeGreaterThan(seat === 0 ? 0 : 0.5);
              expect(x, `seat ${seat}'s hand at ${x}`).toBeLessThan(seat === 0 ? 0.5 : 1);
            }
          });
          // The empty seat is never ticked: it is still asked to hold its wheel level.
          const figures = page.locator("#check-pictures figure.check-picture");
          await expect(figures).toHaveCount(2);
          for (const [seat, player] of seats.entries()) if (!player) await expect(figures.nth(seat)).not.toHaveAttribute("data-step", "ready");
          expect(errors).toEqual([]);
        });
      });
    }
  }
}

// Auto: the real tracker, reading the whole picture for counting, finds every fist and counts two to a player. "pair"
// (one fist in each half of the picture) is one player's two fists; "two-players" is two players' four.
for (const { camera, players } of [
  { camera: "pair", players: 1 },
  { camera: "two-players", players: 2 },
] as const) {
  test(`Auto counts ${players} ${players === 1 ? "player" : "players"} from ${players * 2} fists on a real camera`, async ({ baseURL }) => {
    await withCamera(seatsFixture(camera), baseURL!, async (page) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await open(page);
      await page.getByRole("button", { name: "Practice" }).click();
      await expect(page.getByRole("radiogroup", { name: "Players on This Camera" }).getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.locator("#count-title")).toHaveText(players === 1 ? "1 Player" : `${players} Players`, { timeout: 90_000 });
      await onScreen(page, "driver", 10_000);
      if (players === 1) await expect(page.locator("#driver-seats")).toBeHidden();
      else await expect(page.locator("#driver-seats button")).toHaveCount(players);
      expect(errors).toEqual([]);
    });
  });
}
