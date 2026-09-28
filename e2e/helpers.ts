/** Shared steps for the end-to-end tests. */
import { expect, type Page, type TestInfo } from "@playwright/test";
import type { HandPose } from "../src/input/synthetic";

/** The environment, without depending on Node's type definitions. */
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * A picture of the page, in HANDY_SHOTS (or the test's own output folder),
 * under the project's size. By default it waits for entrance animations (450
 * ms springs) to settle; `settle` 0 catches a moment as it happens.
 */
export async function shot(page: Page, info: TestInfo, name: string, settle = 550): Promise<void> {
  const folder = env.HANDY_SHOTS ?? info.outputDir;
  if (settle) await page.waitForTimeout(settle);
  await page.screenshot({ path: `${folder}/${info.project.name}/${name}.png` });
}

/** A returning visitor: the welcome has been seen. */
export async function skipWelcome(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((items) => {
    try {
      localStorage.setItem("handy.welcomed.v1", "true");
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage refused: the welcome shows, and the test will say so
    }
  }, extra);
}

export type Snapshot = {
  view: string;
  phase: string | null;
  paused: boolean;
  /** The round frozen, waiting for the hand. */
  held: boolean;
  /** The round frozen under a camera trouble's sheet. */
  troubled: boolean;
  /** The world stopped drawing under the results. */
  idle: boolean;
  /** What the hold shows: "wait", "lost", "count", or null. */
  hold: string | null;
  /** The world's loop is running. */
  running: boolean;
  /** Frames are being read from the camera (or the script). */
  tracking: boolean;
  /** How the current game is played, which may change mid-round. */
  input: string | null;
  control: string;
  lit: { id: string; x: number; y: number; radius: number } | null;
  score: number | null;
  shots: number;
  checkDone: boolean;
  lastCheck: { score: number | null; shots: number; ended: "ready" | "anyway" } | null;
  tracker: { where: string; delegate: string; stats: { frames: number; framesWithHand: number; inference: { p50: number; p95: number }; delay: { p50: number; p95: number }; pageCost: { p50: number } } } | null;
  frames: { frames: number; interval: { mean: number; p50: number; p95: number }; work: { mean: number; p50: number; p95: number } } | null;
  quality: { scale: number; tier: string; gpu: string } | null;
};

export function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => window.handyTest!.snapshot() as unknown as Snapshot);
}

export function pose(page: Page, value: HandPose | null): Promise<void> {
  if (value?.indexTip) aimedAt.set(page, aimOf(value.indexTip));
  else aimedAt.delete(page);
  return page.evaluate((p) => window.handyTest!.pose(p), value);
}

/** The point of the view a fingertip aims at: fingertipFor, the other way. */
function aimOf([tipX, tipY]: readonly [number, number]): [number, number] {
  const [a, b] = [tipX - 0.3, tipY - 0.26];
  const det = 0.4 * 0.38 + 0.03 * 0.02;
  return [(a * 0.38 - 0.03 * b) / det, (0.4 * b + 0.02 * a) / det];
}

/** Where each page's scripted hand last aimed, in view fractions, for moving it on from there. */
const aimedAt = new WeakMap<Page, [number, number]>();

/**
 * Moves the scripted hand to aim at a point of the view the way a hand
 * moves - through the space between, a frame or two apart - rather than
 * teleporting there, which the page rightly takes for someone else's hand.
 */
export async function moveTo(page: Page, x: number, y: number): Promise<void> {
  const from = aimedAt.get(page);
  if (from) {
    const steps = Math.ceil(Math.hypot(x - from[0], y - from[1]) / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      await page.evaluate((p) => window.handyTest!.pose(p), handAt(from[0] + (x - from[0]) * t, from[1] + (y - from[1]) * t));
      await page.waitForTimeout(30);
    }
  }
  await page.evaluate((p) => window.handyTest!.pose(p), handAt(x, y));
  aimedAt.set(page, [x, y]);
}

/**
 * Where this player's fingertip is, as they see it in the mirrored picture,
 * when aiming at a point of the view: a camera above the screen, a little
 * turned - the placement the aim check has to discover.
 */
export function fingertipFor(x: number, y: number): [number, number] {
  return [0.3 + 0.4 * x + 0.03 * y, 0.26 + 0.38 * y - 0.02 * x];
}

/** The scripted hand aiming at a point of the view: the whole hand moves
 * with the fingertip, as a real one does, so its picture looks like a hand. */
export function handAt(x: number, y: number, thumbDegrees = 18): HandPose {
  const indexTip = fingertipFor(x, y);
  return { thumbDegrees, indexTip, wrist: [indexTip[0] + 0.03, indexTip[1] + 0.3], scale: 0.9 };
}

/** One shot with the scripted hand: aim with the thumb up, fold it, raise it again. */
export async function shoot(page: Page, x: number, y: number): Promise<void> {
  await moveTo(page, x, y);
  await page.waitForTimeout(420);
  await pose(page, handAt(x, y, 72));
  await page.waitForTimeout(160);
  await pose(page, handAt(x, y));
}

/** A game with the scripted hand, through the aim check and into play, the hand held up mid-view. */
export async function playWithHand(page: Page, url = "/?input=script"): Promise<void> {
  await skipWelcome(page);
  await page.goto(url);
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe("check");
  await passAimCheck(page);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("play");
  await pose(page, handAt(0.5, 0.5));
}

/** The game's own view, for the tests that need to know where things are (dev and test builds). */
export function gameDebug(page: Page, script: string): Promise<unknown> {
  return page.evaluate(`(() => { const debug = window.handyTest.internals().session.game.debug; return ${script}; })()`);
}

/**
 * Plays the aim check through with the scripted hand until it hands over to
 * the game. A narrow window can show a game fewer targets than a first check
 * needs; if they run out, the player plays on with the aim they have.
 */
export async function passAimCheck(page: Page, onShot?: (shot: number) => Promise<void>): Promise<number> {
  let shots = 0;
  for (; shots < 14; shots++) {
    const state = await snapshot(page);
    if (state.checkDone || state.phase === "play") break;
    if (!state.lit && (await page.getByRole("button", { name: "Play Anyway" }).isVisible())) {
      await page.getByRole("button", { name: "Play Anyway" }).click();
      break;
    }
    expect(state.lit, "a target is lit to shoot").not.toBeNull();
    await shoot(page, state.lit!.x, state.lit!.y);
    await page.waitForTimeout(120);
    await onShot?.(shots + 1);
  }
  return shots;
}
