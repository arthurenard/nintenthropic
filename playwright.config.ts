import { defineConfig } from "@playwright/test";
import { FIXTURE } from "./e2e/fixture";

/**
 * End to end, in the installed Google Chrome, headless and always muted:
 * nothing a test runs may make a sound. The browser's camera is a fake one
 * playing a still picture of a hand (made by e2e/global-setup.ts), and its
 * permission prompt answers yes by itself.
 *
 * The site under test is a build in "e2e" mode - the production build plus
 * the test hooks (?input=script, ?fail=...) - served by vite preview.
 */
/** The environment, without depending on Node's type definitions. */
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** HANDY_E2E_PORT lets two checkouts run their tests side by side, each on its own build. */
const PORT = Number(env.HANDY_E2E_PORT) || 4174;
const OUT = "node_modules/.cache/handy-e2e/dist";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: env.CI ? 1 : 0,
  reporter: env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--mute-audio",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${FIXTURE}`,
        // CI machines have no GPU: let WebGL fall back to software there.
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  projects: [
    {
      name: "flows",
      testMatch: /(mouse|camera|scripted|settings|resilience)\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "states-1440",
      testMatch: /states\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "states-1440@2x",
      testMatch: /states\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
    },
    {
      name: "states-900",
      testMatch: /states\.spec\.ts/,
      use: { viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `npx vite build --mode e2e --outDir ${OUT} --emptyOutDir && npx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !env.CI,
    timeout: 240_000,
  },
});
