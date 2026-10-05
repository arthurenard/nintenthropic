/**
 * Shared steps for Grip Prix's end-to-end tests: getting into a room by the
 * screens, and a keyboard driver that races a kart round a track by pressing
 * the real keys - it looks at where the kart is (the page's `gripTest.state()`)
 * and steers the way a person watching the road would.
 */
import { expect, type Page } from "@playwright/test";
import type { KartAppSnapshot } from "../src/kart/app/app";
import { TrackGeometry } from "../src/kart/track/geometry";
import { trackByRaceId } from "../src/kart/track/mirror";

export const state = (page: Page): Promise<KartAppSnapshot> =>
  page.evaluate(() => window.gripTest!.state()) as Promise<KartAppSnapshot>;

/** The race's name, when the page is on a screen. */
export const screenOf = async (page: Page): Promise<string> => (await state(page)).screen;

/** Opens Grip Prix over the in-browser network (tabs of one browser are the room). */
export async function open(page: Page, extra = ""): Promise<void> {
  await page.goto(`/race.html?net=local${extra}`);
}

/** The You screen, filled in for a keyboard driver, and on to what comes next. */
export async function keyboardPlayer(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { name: /Driving/ })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("radio", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Hosts a room as a keyboard driver; the room's code. */
export async function host(page: Page, name: string): Promise<string> {
  await open(page);
  await page.getByRole("button", { name: "Host a Race" }).click();
  await keyboardPlayer(page, name);
  await expect(page.locator("#lobby-code")).toHaveText(/^[A-Z]{4}$/);
  return (await page.locator("#lobby-code").textContent())!;
}

/** Joins a room by typing its code, as a keyboard driver; `bigScreen` shares the host's screen. */
export async function join(page: Page, code: string, name: string, bigScreen = false): Promise<void> {
  await open(page);
  await page.getByLabel("Race code").fill(code);
  await page.getByRole("button", { name: "Join a Race" }).click();
  await keyboardPlayer(page, name);
  await expect(page.locator("#lobby-waiting")).toBeVisible();
  if (bigScreen) await page.getByRole("radio", { name: "Big Screen" }).click();
}

/**
 * A keyboard driver: presses the arrow keys to follow a track's centre line.
 * It reads where the kart is from the page about twenty times a second,
 * aims at a point a little way ahead, and turns the wheel the way keys can -
 * held, or tapped in proportion, for the part of a second it takes.
 */
export class KeyboardDriver {
  private running = false;
  private done: Promise<void> = Promise.resolve();
  private readonly held = new Set<string>();
  private geometry: { id: string; geometry: TrackGeometry } | null = null;
  /** Counts the loop's turns, so a test can tell it is alive. */
  turns = 0;

  constructor(
    private readonly page: Page,
    /** Which of this device's players to drive (the first). */
    private readonly which = 0,
  ) {}

  start(): this {
    this.running = true;
    this.done = this.loop();
    return this;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.done;
    await this.release();
  }

  private async press(keys: readonly string[]): Promise<void> {
    const want = new Set(keys);
    for (const key of [...this.held]) {
      if (!want.has(key)) {
        this.held.delete(key);
        await this.page.keyboard.up(key);
      }
    }
    for (const key of want) {
      if (!this.held.has(key)) {
        this.held.add(key);
        await this.page.keyboard.down(key);
      }
    }
  }

  private async release(): Promise<void> {
    await this.press([]).catch(() => {});
  }

  private async loop(): Promise<void> {
    let owed = 0;
    while (this.running) {
      let snapshot: KartAppSnapshot | null = null;
      try {
        snapshot = await state(this.page);
      } catch {
        // The page is between screens.
      }
      this.turns++;
      const race = snapshot?.race;
      const id = snapshot?.mine[this.which];
      const kart = race && id !== null && id !== undefined ? race.karts.find((candidate) => candidate.id === id) : undefined;
      if (!race || !kart || snapshot?.screen !== "race" || race.phase === "finished") {
        await this.release();
        await this.page.waitForTimeout(100);
        continue;
      }
      if (race.phase === "countdown") {
        // Hands off the throttle until the lights go out: an early start floods the engine.
        await this.release();
        await this.page.waitForTimeout(40);
        continue;
      }
      if (kart.finished !== null) {
        // Over the line: the kart drives itself on.
        await this.release();
        await this.page.waitForTimeout(100);
        continue;
      }
      if (this.geometry?.id !== race.trackId) this.geometry = { id: race.trackId, geometry: TrackGeometry.build(trackByRaceId(race.trackId)) };
      const road = this.geometry.geometry;
      const at = road.project(kart.x, kart.z);
      // Aim at a point on the centre line a little way ahead, further when faster.
      const ahead = road.point(at.s + 8 + Math.max(0, kart.speed) * 0.55);
      const wanted = Math.atan2(ahead.x - kart.x, ahead.z - kart.z);
      let error = wanted - kart.heading;
      error = Math.atan2(Math.sin(error), Math.cos(error));
      // Steering right turns the heading down, so a wanted heading below ours is a turn to the right.
      const turn = Math.max(-1, Math.min(1, -error * 1.6));
      owed += Math.abs(turn);
      const tap = owed >= 0.5;
      if (tap) owed -= 1;
      owed = Math.max(-1, owed);
      const keys = ["ArrowUp"];
      if (tap) keys.push(turn > 0 ? "ArrowRight" : "ArrowLeft");
      await this.press(keys);
      await this.page.waitForTimeout(35);
    }
  }
}

/** Waits for the page to be on this screen. */
export async function onScreen(page: Page, screen: KartAppSnapshot["screen"], timeout = 20_000): Promise<void> {
  await expect.poll(() => screenOf(page), { timeout }).toBe(screen);
}

/**
 * Scripted wheels (?input=script) for players sharing a camera, steered round
 * the track the way KeyboardDriver does: each player's two fists sit in their
 * own column of the picture and are turned towards the road. Hands are taken
 * away during the countdown (fists would flood the engine) and come back when
 * the lights go out.
 */
export class WheelDrivers {
  private running = false;
  private done: Promise<void> = Promise.resolve();
  private geometry: { id: string; geometry: TrackGeometry } | null = null;
  turns = 0;

  constructor(
    private readonly page: Page,
    private readonly players: number,
    /** Degrees of wheel for full steer (Normal is 40). */
    private readonly lock = 40,
  ) {}

  start(): this {
    this.running = true;
    this.done = this.loop();
    return this;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.done;
  }

  private async set(angles: readonly number[] | null): Promise<void> {
    const poses =
      angles === null
        ? null
        : angles.map((angle, i) => ({ angle, centre: [(i + 0.5) / this.players, 0.5] as const, span: 0.2 }));
    await this.page.evaluate((p) => window.gripTest!.wheel(p), poses).catch(() => {});
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let snapshot: KartAppSnapshot | null = null;
      try {
        snapshot = await state(this.page);
      } catch {
        // The page is between screens.
      }
      this.turns++;
      const race = snapshot?.race;
      if (!race || snapshot?.screen !== "race" || race.phase === "countdown") {
        await this.set(race?.phase === "countdown" ? null : Array.from({ length: this.players }, () => 0));
        await this.page.waitForTimeout(80);
        continue;
      }
      if (this.geometry?.id !== race.trackId) this.geometry = { id: race.trackId, geometry: TrackGeometry.build(trackByRaceId(race.trackId)) };
      const road = this.geometry.geometry;
      const angles = Array.from({ length: this.players }, (_, i) => {
        const id = snapshot!.mine[i];
        const kart = id === null || id === undefined ? undefined : race.karts.find((candidate) => candidate.id === id);
        if (!kart) return 0;
        const at = road.project(kart.x, kart.z);
        const ahead = road.point(at.s + 8 + Math.max(0, kart.speed) * 0.55);
        let error = Math.atan2(ahead.x - kart.x, ahead.z - kart.z) - kart.heading;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        // Steering right turns the heading down; the wheel's angle is + with the right hand lower, which steers right.
        return Math.max(-1, Math.min(1, -error * 1.6)) * this.lock;
      });
      await this.set(angles);
      await this.page.waitForTimeout(50);
    }
  }
}
